import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  OnInit,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize } from 'rxjs';
import { ProfileService } from './profile.service';
import { AuthService } from '../../auth/auth.service';
import { BuilderLoaderService } from '../../core/builder-loader.service';
import { ChatLoaderService } from '../../core/chat-loader.service';
import { NotifyService } from '../../shared/services/notify.service';
import { environment } from '../../../environments/environment';
import { ProfileDocument, emptyDocument } from '../../shared/models/profile.model';

// Custom element exposed by the profile-builder web component.
interface ProfileBuilderElement extends HTMLElement {
  document: ProfileDocument;
  // Apply an AI chat edit (US-AI-9). Atomic: returns ok:false on an invalid patch.
  applyEdit(patchJson: string): { ok: boolean; errors: string[] };
}

// Custom element exposed by the chat web component (in-editor edit mode).
interface ChatWidgetElement extends HTMLElement {
  document: unknown;
  addAssistantNote(text: string): void;
}

@Component({
  selector: 'app-profile',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './profile.component.html',
})
export class ProfileComponent implements OnInit {
  private profileService = inject(ProfileService);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private notify = inject(NotifyService);
  private builderLoader = inject(BuilderLoaderService);
  private chatLoader = inject(ChatLoaderService);
  readonly router = inject(Router);

  // Signal query: resolves once the @if(widgetReady()) branch renders the element.
  private readonly builderRef = viewChild<ElementRef<ProfileBuilderElement>>('builder');
  private readonly chatRef = viewChild<ElementRef<ChatWidgetElement>>('chat');

  profileId = '';
  readonly loading = signal(false);
  readonly loadError = signal(false);
  readonly saving = signal(false);
  readonly extracting = signal(false);
  readonly widgetReady = signal(false);
  readonly widgetError = signal(false);
  readonly chatReady = signal(false);

  readonly apiBase = environment.apiUrl.replace(/\/api$/, '') + '/api';
  get authToken(): string {
    return this.auth.getToken() ?? '';
  }

  readonly profileName = signal('Job Profile');

  // The document to push into the builder — the source of truth for save/PDF.
  // Held as a signal so an effect can (re)seed the element whenever either the
  // document (load/extract/chat-edit) or the element (lazy render) changes, in
  // any order. User edits arrive via `documentchange` and update it in place.
  private readonly documentToSeed = signal<ProfileDocument>(emptyDocument());

  // Latest document as edited in the builder. Diverges from documentToSeed once
  // the user edits; converges again whenever we push a new document. A signal so
  // the in-editor chat is always given the live (possibly unsaved) document.
  private readonly currentDocument = signal<ProfileDocument>(emptyDocument());

  constructor() {
    // Seed the element whenever both it and a document are available.
    effect(() => {
      const el = this.builderRef()?.nativeElement;
      const doc = this.documentToSeed();
      if (el) el.document = doc;
    });

    // Keep the chat widget's context in sync with the live document (US-AI-9
    // §6.2) so an edit is computed against unsaved changes too.
    effect(() => {
      const chat = this.chatRef()?.nativeElement;
      const doc = this.currentDocument();
      if (chat) chat.document = doc;
    });
  }

  ngOnInit() {
    this.profileId = this.route.snapshot.paramMap.get('id') ?? '';
    this.builderLoader
      .load()
      .then(() => this.widgetReady.set(true))
      .catch(() => this.widgetError.set(true));
    this.chatLoader
      .load()
      .then(() => this.chatReady.set(true))
      .catch(() => this.chatReady.set(false));
    this.loadProfile();
  }

  // Pushes a document into the builder (via the seeding effect) and resets the
  // edit baseline to it.
  private setBuilderDocument(doc: ProfileDocument) {
    this.currentDocument.set(doc);
    this.documentToSeed.set(doc);
  }

  onDocumentChange(event: Event) {
    this.currentDocument.set((event as CustomEvent<ProfileDocument>).detail);
  }

  // An edit proposed by the in-editor chat. Apply it live to the builder
  // (unsaved); on rejection surface a note back into the chat thread (F-CHAT-6.10).
  onChatEdit(event: Event) {
    const detail = (event as CustomEvent<{ patchJson: string; description?: string }>).detail;
    const builder = this.builderRef()?.nativeElement;
    const chat = this.chatRef()?.nativeElement;
    if (!builder || !detail?.patchJson) return;

    const result = builder.applyEdit(detail.patchJson);
    if (!result.ok) {
      chat?.addAssistantNote(
        "Sorry — I couldn't apply that edit, so your profile is unchanged. Could you rephrase it?",
      );
    }
  }

  private loadProfile() {
    this.loading.set(true);
    this.loadError.set(false);
    this.profileService
      .getProfile(this.profileId)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (profile) => {
          this.profileName.set(profile.name || 'Job Profile');
          // The seeding effect pushes this into the builder once the element
          // is available (it may not have rendered yet).
          this.setBuilderDocument(profile.document ?? emptyDocument());
        },
        error: (err: HttpErrorResponse) => {
          if (err.status === 401) {
            this.auth.logout();
          } else {
            this.loadError.set(true);
          }
        },
      });
  }

  retryLoad() {
    this.loadProfile();
  }

  save() {
    this.saving.set(true);
    this.profileService
      .updateProfile(this.profileId, { name: this.profileName(), document: this.currentDocument() })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: () => this.notify.success('Profile saved successfully!'),
        error: () => this.notify.error('Failed to save profile.'),
      });
  }

  onExtractFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;

    this.extracting.set(true);
    this.profileService
      .extractFromCv(this.profileId, file)
      .pipe(finalize(() => this.extracting.set(false)))
      .subscribe({
        next: (result) => {
          if (result.name) this.profileName.set(result.name);
          this.setBuilderDocument(result.document);
          this.notify.success('CV imported! Review the changes and save when ready.');
        },
        error: () => this.notify.error('Failed to import CV. Please try again.'),
      });
  }

  // Opens the current on-screen profile (including unsaved edits) as a PDF
  // directly via the draft-pdf endpoint (US-CV-7) — no AI generation.
  openPdf() {
    const header = this.currentDocument().header;
    const title = [header.fullName, header.title].filter(Boolean).join(' — ') || this.profileName();
    this.router.navigate(['/job-profiles', this.profileId, 'pdf'], {
      state: {
        draft: { name: this.profileName(), document: this.currentDocument() },
        title,
      },
    });
  }
}
