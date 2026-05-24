import { Directive, HostListener, inject } from '@angular/core';
import { DropdownComponent } from './dropdown.component';

/**
 * Apply to every item inside <app-dropdown>.
 * Provides base item layout and auto-closes the menu on click.
 * Add color/hover classes directly on the element to customise appearance.
 *
 * Example:
 *   <button dropdownItem class="text-red-600 hover:bg-red-50" (click)="delete()">Delete</button>
 */
@Directive({
  selector: '[dropdownItem]',
  standalone: true,
  host: {
    class:
      'flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-4 py-3 text-left text-sm transition-colors',
  },
})
export class DropdownItemDirective {
  private readonly dropdown = inject(DropdownComponent);

  @HostListener('click')
  onClick() {
    this.dropdown.close();
  }
}
