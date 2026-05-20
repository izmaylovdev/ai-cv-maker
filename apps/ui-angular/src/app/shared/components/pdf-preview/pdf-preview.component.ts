import { Component, input, output } from '@angular/core';
import { SafeResourceUrl } from '@angular/platform-browser';

@Component({
  selector: 'app-pdf-preview',
  standalone: true,
  templateUrl: './pdf-preview.component.html',
})
export class PdfPreviewComponent {
  readonly title = input('');
  readonly safeUrl = input<SafeResourceUrl | null>(null);
  readonly loading = input(false);
  readonly closed = output<void>();
  readonly download = output<void>();
}
