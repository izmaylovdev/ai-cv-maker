import { Injectable, inject } from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { Observable } from 'rxjs';
import { GenerateCvDialogComponent } from '../dialogs/generate-cv-dialog.component';
import { OptimizeDialogComponent } from '../dialogs/optimize-dialog.component';
import { ReorderDialogComponent } from '../dialogs/reorder-dialog.component';

@Injectable({ providedIn: 'root' })
export class DialogService {
  private readonly dialog = inject(Dialog);

  openDownloadCv(): Observable<string | undefined> {
    return this.dialog.open<string>(GenerateCvDialogComponent, {
      backdropClass: 'dialog-backdrop',
    }).closed;
  }

  openOptimize(): Observable<string | undefined> {
    return this.dialog.open<string>(OptimizeDialogComponent, {
      backdropClass: 'dialog-backdrop',
    }).closed;
  }

  openReorder(sections: string[]): Observable<string[] | undefined> {
    return this.dialog.open<string[], { sections: string[] }>(ReorderDialogComponent, {
      backdropClass: 'dialog-backdrop',
      data: { sections },
    }).closed;
  }
}
