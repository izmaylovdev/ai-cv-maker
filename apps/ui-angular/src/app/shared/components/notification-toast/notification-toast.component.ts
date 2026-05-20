import { Component, inject } from '@angular/core';
import { NotifyService } from '../../services/notify.service';

@Component({
  selector: 'app-notification-toast',
  standalone: true,
  template: `
    @if (notify.current(); as n) {
      <div
        [class]="n.type === 'success'
          ? 'fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg bg-green-50 dark:bg-green-900/40 border border-green-200 dark:border-green-700 text-green-800 dark:text-green-300 text-sm'
          : 'fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg bg-red-50 dark:bg-red-900/40 border border-red-200 dark:border-red-700 text-red-800 dark:text-red-300 text-sm'">
        <span class="material-icons text-base shrink-0">
          {{ n.type === 'success' ? 'check_circle' : 'error_outline' }}
        </span>
        <span>{{ n.message }}</span>
        <button type="button" (click)="notify.dismiss()"
          class="ml-2 flex items-center justify-center text-current opacity-50 hover:opacity-100 transition-opacity cursor-pointer bg-transparent border-0 p-0">
          <span class="material-icons text-base">close</span>
        </button>
      </div>
    }
  `,
})
export class NotificationToastComponent {
  readonly notify = inject(NotifyService);
}
