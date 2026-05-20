import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { finalize } from 'rxjs';
import { CvService } from '../cv/cv.service';
import { NotifyService } from '../../shared/services/notify.service';
import { PdfPreviewComponent } from '../../shared/components/pdf-preview/pdf-preview.component';

interface PdfNavState {
  notes?: string;
  title?: string;
}

@Component({
  selector: 'app-pdf-preview-page',
  standalone: true,
  imports: [PdfPreviewComponent],
  template: `
    <app-pdf-preview
      [title]="title()"
      [safeUrl]="safeUrl()"
      [loading]="loading()"
      (closed)="back()"
      (download)="download()" />
  `,
})
export class PdfPreviewPageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly cvService = inject(CvService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly notify = inject(NotifyService);

  readonly loading = signal(true);
  readonly safeUrl = signal<SafeResourceUrl | null>(null);
  readonly title = signal('');

  private profileId = '';
  private rawBlobUrl: string | null = null;

  ngOnInit() {
    this.profileId = this.route.snapshot.paramMap.get('id') ?? '';
    const state = this.router.lastSuccessfulNavigation()?.extras.state as PdfNavState | null;
    this.title.set(state?.title ?? 'CV Preview');
    this.generate(state?.notes ?? '');
  }

  ngOnDestroy() {
    this.revokeBlob();
  }

  back() {
    this.router.navigate(['/job-profiles', this.profileId]);
  }

  download() {
    if (!this.rawBlobUrl) return;
    const a = document.createElement('a');
    a.href = this.rawBlobUrl;
    a.download = `${this.title().replace(/[\s/\\:*?"<>|]/g, '_')}.pdf`;
    a.click();
  }

  private generate(notes: string) {
    this.cvService.create(this.profileId, notes.trim() || null).subscribe({
      next: (cv) => {
        this.cvService.getPdf(this.profileId, cv.id)
          .pipe(finalize(() => this.loading.set(false)))
          .subscribe({
            next: (blob) => {
              this.revokeBlob();
              this.rawBlobUrl = URL.createObjectURL(blob);
              this.safeUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.rawBlobUrl));
            },
            error: () => this.notify.error('Failed to load PDF.'),
          });
      },
      error: () => {
        this.loading.set(false);
        this.notify.error('Failed to generate CV. Please try again.');
      },
    });
  }

  private revokeBlob() {
    if (this.rawBlobUrl) {
      URL.revokeObjectURL(this.rawBlobUrl);
      this.rawBlobUrl = null;
    }
  }
}
