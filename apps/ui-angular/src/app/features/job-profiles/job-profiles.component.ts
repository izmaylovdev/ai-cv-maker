import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { ProfileService } from '../profile/profile.service';
import { CvService } from '../cv/cv.service';
import { JobProfileListItem } from '../../shared/models/profile.model';
import { PdfPreviewComponent } from '../../shared/components/pdf-preview/pdf-preview.component';

@Component({
  selector: 'app-job-profiles',
  standalone: true,
  imports: [FormsModule, PdfPreviewComponent],
  templateUrl: './job-profiles.component.html',
})
export class JobProfilesComponent implements OnInit, OnDestroy {
  private profileService = inject(ProfileService);
  private cvService = inject(CvService);
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
    const name = this.newName.trim() || 'My Profile';
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
            this.profileService.updateProfile(profile.id, { ...extracted, name }).pipe(
              finalize(() => this.saving.set(false))
            ).subscribe({
              next: () => this.router.navigate(['/job-profiles', profile.id]),
              error: () => this.router.navigate(['/job-profiles', profile.id]),
            });
          },
          error: () => {
            this.saving.set(false);
            this.router.navigate(['/job-profiles', profile.id]);
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

  private revokeBlob() {
    if (this.rawBlobUrl) { URL.revokeObjectURL(this.rawBlobUrl); this.rawBlobUrl = null; }
  }
}
