import { Directive, HostListener, inject } from '@angular/core';
import { DropdownComponent } from './dropdown.component';

/** Marks the element that opens/closes the dropdown when clicked. */
@Directive({ selector: '[appDropdownTrigger]', standalone: true })
export class DropdownTriggerDirective {
  private readonly dropdown = inject(DropdownComponent);

  @HostListener('click')
  @HostListener('keydown.enter')
  @HostListener('keydown.space', ['$event'])
  toggle(event?: Event) {
    event?.preventDefault();
    this.dropdown.toggle();
  }
}
