import { Directive } from '@angular/core';

/** Marks the element that opens/closes the dropdown when clicked. */
@Directive({ selector: '[dropdownTrigger]', standalone: true })
export class DropdownTriggerDirective {}
