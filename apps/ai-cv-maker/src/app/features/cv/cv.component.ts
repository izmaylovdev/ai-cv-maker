import { Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { CvService } from '../../core/cv.service';

type GenerationState = 'idle' | 'loading' | 'done' | 'error';

@Component({
  selector: 'app-cv',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './cv.component.html',
})
export class CvComponent {
  private cvService = inject(CvService);
  private sanitizer = inject(DomSanitizer);

  state: GenerationState = 'idle';
  pdfSafeUrl: SafeResourceUrl | null = null;
  private rawBlobUrl: string | null = null;
  errorMessage = '';

  generate() {
    this.state = 'loading';
    this.pdfSafeUrl = null;
    this.errorMessage = '';
    if (this.rawBlobUrl) URL.revokeObjectURL(this.rawBlobUrl);

    this.cvService.generate().subscribe({
      next: (blob: Blob) => {
        this.rawBlobUrl = URL.createObjectURL(blob);
        this.pdfSafeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.rawBlobUrl);
        this.state = 'done';
      },
      error: (err) => {
        this.errorMessage =
          err.status === 400
            ? 'Please complete your profile before generating a CV.'
            : 'CV generation failed. Please try again later.';
        this.state = 'error';
      },
    });
  }

  download() {
    if (!this.rawBlobUrl) return;
    const a = document.createElement('a');
    a.href = this.rawBlobUrl;
    a.download = 'my_cv.pdf';
    a.click();
  }
}
