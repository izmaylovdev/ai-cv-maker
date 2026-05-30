import { Component, ElementRef, HostListener, computed, inject, input, signal } from '@angular/core';

/**
 * Reusable dropdown menu similar to MatMenu.
 *
 * Usage:
 *   <app-dropdown>
 *     <button appDropdownTrigger class="...">⋮</button>
 *
 *     <button appDropdownItem class="text-gray-700 hover:bg-gray-50 dark:text-zinc-300 dark:hover:bg-zinc-700"
 *             (click)="action()">
 *       <span class="material-icons text-base">edit</span> Edit
 *     </button>
 *
 *     <hr class="my-0.5 border-gray-100 dark:border-zinc-700">
 *
 *     <button appDropdownItem class="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
 *             (click)="delete()">
 *       <span class="material-icons text-base">delete</span> Delete
 *     </button>
 *   </app-dropdown>
 *
 * Inputs:
 *   align — 'right' (default) | 'left'  — which edge of the trigger to align the panel to
 */
@Component({
  selector: 'app-dropdown',
  standalone: true,
  host: { class: 'relative inline-block' },
  template: `
    <ng-content select="[appDropdownTrigger]"></ng-content>

    @if (open()) {
      <div [class]="panelClass()">
        <ng-content></ng-content>
      </div>
    }
  `,
})
export class DropdownComponent {
  readonly align = input<'left' | 'right'>('right');
  readonly open = signal(false);

  private readonly el = inject(ElementRef<HTMLElement>);

  readonly panelClass = computed(() => {
    const side = this.align() === 'left' ? 'left-0' : 'right-0';
    return `absolute top-full ${side} z-50 mt-1 min-w-[11rem] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg dark:border-zinc-600 dark:bg-zinc-800`;
  });

  toggle() {
    this.open.update((v) => !v);
  }

  close() {
    this.open.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(e: MouseEvent) {
    if (!this.el.nativeElement.contains(e.target as Node)) {
      this.open.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.open.set(false);
  }
}
