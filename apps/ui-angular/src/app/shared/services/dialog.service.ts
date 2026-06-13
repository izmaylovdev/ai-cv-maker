import { Injectable, inject } from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { Observable } from 'rxjs';
import { OptimizeDialogComponent } from '../dialogs/optimize-dialog.component';
import { ReorderDialogComponent } from '../dialogs/reorder-dialog.component';
import { OptimizeProfileResponse } from '../../features/profile/profile.service';

@Injectable({ providedIn: 'root' })
export class DialogService {
  private readonly dialog = inject(Dialog);

  openOptimize(profileId: string): Observable<OptimizeProfileResponse | undefined> {
    return this.dialog.open<OptimizeProfileResponse, { profileId: string }>(OptimizeDialogComponent, {
      backdropClass: 'dialog-backdrop',
      data: { profileId },
    }).closed;
  }

  openReorder(sections: string[]): Observable<string[] | undefined> {
    return this.dialog.open<string[], { sections: string[] }>(ReorderDialogComponent, {
      backdropClass: 'dialog-backdrop',
      data: { sections },
    }).closed;
  }
}
