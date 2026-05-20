import { Component, inject } from '@angular/core';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';

@Component({
  selector: 'app-reorder-dialog',
  standalone: true,
  imports: [DragDropModule],
  template: `
    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6 w-72 flex flex-col gap-4">
      <h2 class="text-base font-semibold text-gray-900 dark:text-white">Reorder Sections</h2>
      <div cdkDropList (cdkDropListDropped)="drop($event)" class="flex flex-col gap-2">
        @for (key of draft; track key) {
          <div cdkDrag cdkDragLockAxis="y"
            class="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700">
            <div *cdkDragPlaceholder class="h-10 rounded-lg border-2 border-dashed border-blue-200 dark:border-blue-700 bg-blue-50/30 dark:bg-blue-900/10"></div>
            <span cdkDragHandle class="material-icons text-[20px] text-gray-400 dark:text-gray-500 cursor-grab active:cursor-grabbing select-none">drag_indicator</span>
            <span class="text-sm font-medium text-gray-700 dark:text-gray-200">{{ label(key) }}</span>
          </div>
        }
      </div>
      <div class="flex gap-2">
        <button type="button" (click)="ref.close(draft)"
          class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg px-4 py-2 text-sm transition-colors cursor-pointer border-0">
          Apply
        </button>
        <button type="button" (click)="ref.close()"
          class="flex-1 border border-gray-300 dark:border-gray-600 bg-white dark:bg-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium rounded-lg px-4 py-2 text-sm transition-colors cursor-pointer">
          Cancel
        </button>
      </div>
    </div>
  `,
})
export class ReorderDialogComponent {
  readonly ref = inject(DialogRef<string[]>);
  private readonly data = inject<{ sections: string[] }>(DIALOG_DATA);

  draft: string[];

  private readonly labels: Record<string, string> = {
    workExperiences: 'Work Experience',
    educations: 'Education',
    skills: 'Skills',
  };

  constructor() {
    this.draft = [...this.data.sections];
  }

  label(key: string): string {
    return this.labels[key] ?? key;
  }

  drop(event: CdkDragDrop<string[]>): void {
    moveItemInArray(this.draft, event.previousIndex, event.currentIndex);
  }
}
