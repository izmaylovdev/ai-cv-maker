import { Component, ElementRef, OnDestroy, OnInit, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { ProfileService } from '../profile/profile.service';
import { CvService } from '../cv/cv.service';
import { JobProfileListItem } from '../../shared/models/profile.model';
import { PdfPreviewComponent } from '../../shared/components/pdf-preview/pdf-preview.component';
import { NotifyService } from '../../shared/services/notify.service';
import { cvImportErrorMessage } from './cv-import-error';

@Component({
  selector: 'app-job-profiles',
  standalone: true,
  imports: [FormsModule, PdfPreviewComponent],
  templateUrl: './job-profiles.component.html',
})
export class JobProfilesComponent implements OnInit, OnDestroy {
  private profileService = inject(ProfileService);
  private cvService = inject(CvService);
  private notify = inject(NotifyService);
  private sanitizer = inject(DomSanitizer);
  readonly router = inject(Router);

  readonly profiles = signal<JobProfileListItem[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal(false);
  readonly creating = signal(false);
  readonly saving = signal(false);
  readonly deletingId = signal<string | null>(null);
  readonly openingPdfId = signal<string | null>(null);
  readonly cvFile = signal<File | null>(null);

  readonly pdfOpen = signal(false);
  readonly pdfLoading = signal(false);
  readonly pdfSafeUrl = signal<SafeResourceUrl | null>(null);
  pdfTitle = '';
  pdfFilename = '';
  private rawBlobUrl: string | null = null;

  newName = '';

  // US-PROF-7: which row is in inline rename mode, and its draft name.
  readonly editingId = signal<string | null>(null);
  private readonly renameInput = viewChild<ElementRef<HTMLInputElement>>('renameInput');
  editName = '';

  ngOnInit() {
    this.load();
  }

  ngOnDestroy() {
    this.revokeBlob();
  }

  load() {
    this.loading.set(true);
    this.loadError.set(false);
    this.profileService.listProfiles().pipe(finalize(() => this.loading.set(false))).subscribe({
      next: (data) => this.profiles.set(data),
      error: () => this.loadError.set(true),
    });
  }

  toggleCreate() {
    this.creating.set(!this.creating());
    if (!this.creating()) {
      this.newName = '';
      this.cvFile.set(null);
    }
  }

  onFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.cvFile.set(file);
    input.value = '';
  }

  clearFile() {
    this.cvFile.set(null);
  }

  create() {
    const typedName = this.newName.trim();
    const name = typedName || 'My Profile';
    const file = this.cvFile();
    this.saving.set(true);
    this.profileService.createProfile(name).subscribe({
      next: (profile) => {
        if (!file) {
          this.saving.set(false);
          this.router.navigate(['/job-profiles', profile.id]);
          return;
        }
        this.profileService.extractFromCv(profile.id, file).subscribe({
          next: (extracted) => {
            // A typed name wins; a blank one is derived from the CV (US-PROF-8).
            const finalName = typedName || extracted.name?.trim() || 'My Profile';
            this.profileService.updateProfile(profile.id, { name: finalName, document: extracted.document }).pipe(
              finalize(() => this.saving.set(false))
            ).subscribe({
              next: () => this.router.navigate(['/job-profiles', profile.id]),
              error: () => this.router.navigate(['/job-profiles', profile.id]),
            });
          },
          // A failed import creates nothing: remove the template-only profile and
          // keep the form (name + file) so the user can retry with one click.
          error: (err) => {
            this.notify.error(`Couldn't import your CV. ${cvImportErrorMessage(err)}`);
            this.profileService.deleteProfile(profile.id).pipe(finalize(() => this.saving.set(false))).subscribe({
              // The profile survived, so show it rather than pretend it's gone.
              error: () => this.load(),
            });
          },
        });
      },
      error: () => this.saving.set(false),
    });
  }

  openDefaultPdf(profile: JobProfileListItem, event: Event) {
    event.stopPropagation();
    const clean = (s: string) => (s ?? '').trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
    this.pdfTitle = profile.fullName ? `${profile.fullName} — ${profile.title}` : profile.name;
    this.pdfFilename = `${clean(profile.fullName)}_${clean(profile.title)}.pdf`;
    this.pdfSafeUrl.set(null);
    this.pdfOpen.set(true);
    this.pdfLoading.set(true);
    this.openingPdfId.set(profile.id);
    this.revokeBlob();

    this.cvService.getDefaultPdf(profile.id)
      .pipe(finalize(() => { this.pdfLoading.set(false); this.openingPdfId.set(null); }))
      .subscribe({
        next: (blob) => {
          this.rawBlobUrl = URL.createObjectURL(blob);
          this.pdfSafeUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.rawBlobUrl));
        },
        error: () => this.pdfOpen.set(false),
      });
  }

  closePdf() {
    this.pdfOpen.set(false);
    this.pdfSafeUrl.set(null);
    this.revokeBlob();
  }

  downloadPdf() {
    if (!this.rawBlobUrl) return;
    const a = document.createElement('a');
    a.href = this.rawBlobUrl;
    a.download = this.pdfFilename;
    a.click();
  }

  subtitle(profile: JobProfileListItem): string {
    return [profile.fullName, profile.title].filter((s) => !!s).join(' · ');
  }

  delete(id: string, event: Event) {
    event.stopPropagation();
    this.deletingId.set(id);
    this.profileService.deleteProfile(id).pipe(finalize(() => this.deletingId.set(null))).subscribe({
      next: () => this.profiles.update((list) => list.filter((p) => p.id !== id)),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      error: () => {},
    });
  }

  // US-PROF-7: inline rename on the dashboard row.
  startRename(profile: JobProfileListItem, event: Event) {
    event.stopPropagation();
    this.editingId.set(profile.id);
    this.editName = profile.name;
    setTimeout(() => this.renameInput()?.nativeElement.focus());
  }

  cancelRename() {
    this.editingId.set(null);
  }

  commitRename(profile: JobProfileListItem) {
    // Guard: the input's removal fires a final blur after Enter/Escape.
    if (this.editingId() !== profile.id) return;
    this.editingId.set(null);
    const name = this.editName.trim();
    // Blank or unchanged → cancel client-side, no API call (F-PROF-7.5).
    if (!name || name === profile.name) return;
    this.profileService.renameProfile(profile.id, name).subscribe({
      next: (updated) => this.profiles.update((list) => list.map((p) => (p.id === updated.id ? updated : p))),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      error: () => {},
    });
  }

  private revokeBlob() {
    if (this.rawBlobUrl) { URL.revokeObjectURL(this.rawBlobUrl); this.rawBlobUrl = null; }
  }
}
