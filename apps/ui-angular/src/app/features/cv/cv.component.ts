import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { finalize } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { CvService, type CvListItem } from './cv.service';

@Component({
  selector: 'app-cv',
  standalone: true,
  imports: [RouterModule, FormsModule],
  templateUrl: './cv.component.html',
})
export class CvComponent implements OnInit, OnDestroy {
  private cvService = inject(CvService);
  private sanitizer = inject(DomSanitizer);

  readonly cvs = signal<CvListItem[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal(false);
  readonly creating = signal(false);
  readonly generating = signal(false);
  readonly mode = signal<'list' | 'pdf'>('list');
  readonly selectedCv = signal<CvListItem | null>(null);
  readonly pdfSafeUrl = signal<SafeResourceUrl | null>(null);
  readonly pdfLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  optimizationNotes = '';
  private rawBlobUrl: string | null = null;
  private errorTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit() {
    this.loadCvs();
  }

  ngOnDestroy() {
    if (this.rawBlobUrl) URL.revokeObjectURL(this.rawBlobUrl);
    if (this.errorTimer) clearTimeout(this.errorTimer);
  }

  loadCvs() {
    this.loading.set(true);
    this.loadError.set(false);
    this.cvService.list().pipe(finalize(() => this.loading.set(false))).subscribe({
      next: (cvs) => this.cvs.set(cvs),
      error: () => this.loadError.set(true),
    });
  }

  toggleCreate() {
    this.creating.set(!this.creating());
    if (!this.creating()) this.optimizationNotes = '';
  }

  generate() {
    this.generating.set(true);
    this.cvService.create(this.optimizationNotes.trim() || null)
      .pipe(finalize(() => this.generating.set(false)))
      .subscribe({
        next: (cv) => {
          this.cvs.update((list) => [cv, ...list]);
          this.creating.set(false);
          this.optimizationNotes = '';
        },
        error: () => {},
      });
  }

  openDefaultPdf() {
    this.selectedCv.set(null);
    this.mode.set('pdf');
    this.pdfSafeUrl.set(null);
    this.pdfLoading.set(true);
    if (this.rawBlobUrl) { URL.revokeObjectURL(this.rawBlobUrl); this.rawBlobUrl = null; }

    this.cvService.getDefaultPdf().pipe(finalize(() => this.pdfLoading.set(false))).subscribe({
      next: (blob) => {
        this.rawBlobUrl = URL.createObjectURL(blob);
        this.pdfSafeUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.rawBlobUrl));
      },
      error: (err: HttpErrorResponse) => {
        this.mode.set('list');
        const msg = err.status === 404
          ? 'Please save your profile before viewing the default CV.'
          : 'Failed to load the CV. Please try again.';
        this.showError(msg);
      },
    });
  }

  openPdf(cv: CvListItem) {
    this.selectedCv.set(cv);
    this.mode.set('pdf');
    this.pdfSafeUrl.set(null);
    this.pdfLoading.set(true);
    if (this.rawBlobUrl) { URL.revokeObjectURL(this.rawBlobUrl); this.rawBlobUrl = null; }

    this.cvService.getPdf(cv.id).pipe(finalize(() => this.pdfLoading.set(false))).subscribe({
      next: (blob) => {
        this.rawBlobUrl = URL.createObjectURL(blob);
        this.pdfSafeUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.rawBlobUrl));
      },
      error: () => this.mode.set('list'),
    });
  }

  closePdf() {
    this.mode.set('list');
    this.selectedCv.set(null);
    this.pdfSafeUrl.set(null);
    if (this.rawBlobUrl) { URL.revokeObjectURL(this.rawBlobUrl); this.rawBlobUrl = null; }
  }

  deleteCv(id: string, event: Event) {
    event.stopPropagation();
    this.cvService.deleteCv(id).subscribe({
      next: () => this.cvs.update((list) => list.filter((c) => c.id !== id)),
      error: () => {},
    });
  }

  private showError(message: string) {
    if (this.errorTimer) clearTimeout(this.errorTimer);
    this.errorMessage.set(message);
    this.errorTimer = setTimeout(() => this.errorMessage.set(null), 5000);
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  downloadPdf() {
    if (!this.rawBlobUrl) return;
    const a = document.createElement('a');
    a.href = this.rawBlobUrl;
    a.download = this.selectedCv() ? `${this.selectedCv()!.title.replace(/\s+/g, '_')}_CV.pdf` : 'Default_CV.pdf';
    a.click();
  }
}
