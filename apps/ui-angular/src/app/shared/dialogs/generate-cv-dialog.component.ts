import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DialogRef } from '@angular/cdk/dialog';

@Component({
  selector: 'app-generate-cv-dialog',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6 w-[480px] flex flex-col gap-4">
      <h3 class="text-base font-semibold text-gray-900 dark:text-white">Preview CV</h3>
      <div class="flex flex-col gap-1">
        <label for="cv-notes" class="text-sm font-medium text-gray-700 dark:text-gray-300">
          Optimization notes
          <span class="font-normal text-gray-400 dark:text-gray-500">(optional)</span>
        </label>
        <textarea id="cv-notes" rows="4" [(ngModel)]="notes"
          placeholder="e.g. Targeting a senior backend role at a fintech startup. Emphasize Go and distributed systems."
          class="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y">
        </textarea>
      </div>
      <div class="flex gap-2">
        <button type="button" (click)="ref.close(notes)"
          class="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg px-4 py-2 text-sm transition-colors cursor-pointer border-0">
          <span class="material-icons text-base">picture_as_pdf</span> Open PDF
        </button>
        <button type="button" (click)="ref.close()"
          class="flex items-center gap-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium rounded-lg px-4 py-2 text-sm transition-colors cursor-pointer">
          Cancel
        </button>
      </div>
    </div>
  `,
})
export class GenerateCvDialogComponent {
  readonly ref = inject(DialogRef<string>);
  notes = '';
}
