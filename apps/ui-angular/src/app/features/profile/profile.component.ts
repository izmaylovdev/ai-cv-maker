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
import { NotifyService } from '../../shared/services/notify.service';
import { isUsageLimitError, usageLimitMessage } from '../../core/usage-limit';
import { ProfileDocument, emptyDocument } from '../../shared/models/profile.model';

// Custom element exposed by the profile-builder web component.
interface ProfileBuilderElement extends HTMLElement {
  document: ProfileDocument;
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
  readonly router = inject(Router);

  // Signal query: resolves once the @if(widgetReady()) branch renders the element.
  private readonly builderRef = viewChild<ElementRef<ProfileBuilderElement>>('builder');

  profileId = '';
  readonly loading = signal(false);
  readonly loadError = signal(false);
  readonly saving = signal(false);
  readonly optimizing = signal(false);
  readonly extracting = signal(false);
  readonly widgetReady = signal(false);
  readonly widgetError = signal(false);

  readonly profileName = signal('Job Profile');

  // The document to push into the builder — the source of truth for save/PDF.
  // Held as a signal so an effect can (re)seed the element whenever either the
  // document (load/optimize/extract) or the element (lazy render) changes, in
  // any order. User edits arrive via `documentchange` and update it in place.
  private readonly documentToSeed = signal<ProfileDocument>(emptyDocument());

  // Latest document as edited in the builder. Diverges from documentToSeed once
  // the user edits; converges again whenever we push a new document.
  private currentDocument: ProfileDocument = emptyDocument();

  constructor() {
    // Seed the element whenever both it and a document are available.
    effect(() => {
      const el = this.builderRef()?.nativeElement;
      const doc = this.documentToSeed();
      if (el) el.document = doc;
    });
  }

  ngOnInit() {
    this.profileId = this.route.snapshot.paramMap.get('id') ?? '';
    this.builderLoader
      .load()
      .then(() => this.widgetReady.set(true))
      .catch(() => this.widgetError.set(true));
    this.loadProfile();
  }

  // Pushes a document into the builder (via the seeding effect) and resets the
  // edit baseline to it.
  private setBuilderDocument(doc: ProfileDocument) {
    this.currentDocument = doc;
    this.documentToSeed.set(doc);
  }

  onDocumentChange(event: Event) {
    this.currentDocument = (event as CustomEvent<ProfileDocument>).detail;
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
      .updateProfile(this.profileId, { name: this.profileName(), document: this.currentDocument })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: () => this.notify.success('Profile saved successfully!'),
        error: () => this.notify.error('Failed to save profile.'),
      });
  }

  // Optimize: AI rewrites the whole document; we load the result into the
  // builder for the user to review and save (no auto-save).
  optimize() {
    const message = window.prompt(
      'Describe the role or goal to optimize for (or paste a job posting URL):',
    );
    if (message == null) return;
    const trimmed = message.trim();
    if (!trimmed) return;

    this.optimizing.set(true);
    this.profileService
      .optimizeProfile(this.profileId, trimmed)
      .pipe(finalize(() => this.optimizing.set(false)))
      .subscribe({
        next: (result) => {
          this.setBuilderDocument(result.document);
          this.notify.success('Profile optimized! Review the changes and save when ready.');
        },
        error: (err: unknown) => {
          if (isUsageLimitError(err)) {
            this.notify.error(usageLimitMessage(err));
            return;
          }
          const apiError =
            err instanceof HttpErrorResponse
              ? (err.error as { error?: string } | null)?.error
              : null;
          this.notify.error(apiError ?? 'Failed to optimize profile. Please try again.');
        },
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
    const header = this.currentDocument.header;
    const title = [header.fullName, header.title].filter(Boolean).join(' — ') || this.profileName();
    this.router.navigate(['/job-profiles', this.profileId, 'pdf'], {
      state: {
        draft: { name: this.profileName(), document: this.currentDocument },
        title,
      },
    });
  }
}
