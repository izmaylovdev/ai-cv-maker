import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DialogRef } from '@angular/cdk/dialog';

@Component({
  selector: 'app-optimize-dialog',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6 w-[calc(100vw-2rem)] max-w-[480px] flex flex-col gap-4">
      <h3 class="text-base font-semibold text-gray-900 dark:text-white">Optimize with AI</h3>
      <p class="text-sm text-gray-500 dark:text-gray-400">Describe the role or goal you're optimizing for</p>
      <textarea rows="4" [(ngModel)]="message"
        placeholder="e.g. Senior React developer at a fintech startup, Staff engineer focused on distributed systems..."
        class="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y">
      </textarea>
      <div class="flex gap-2">
        <button type="button" (click)="ref.close(message)" [disabled]="!message.trim()"
          class="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-medium rounded-lg px-4 py-2 text-sm transition-colors cursor-pointer border-0">
          <span class="material-icons text-base">auto_fix_high</span> Apply
        </button>
        <button type="button" (click)="ref.close()"
          class="flex items-center gap-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium rounded-lg px-4 py-2 text-sm transition-colors cursor-pointer">
          Cancel
        </button>
      </div>
    </div>
  `,
})
export class OptimizeDialogComponent {
  readonly ref = inject(DialogRef<string>);
  message = '';
}
