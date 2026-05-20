import { Directive, ElementRef, HostListener, inject } from '@angular/core';
import { NgControl } from '@angular/forms';

@Directive({
  selector: '[appPhoneMask]',
  standalone: true,
})
export class PhoneMaskDirective {
  private el = inject(ElementRef);
  private control = inject(NgControl, { optional: true });

  @HostListener('input')
  onInput() {
    const input = this.el.nativeElement as HTMLInputElement;
    const digits = input.value.replace(/\D/g, '').slice(0, 12);
    const formatted = this.format(digits);
    input.value = formatted;
    this.control?.control?.setValue(formatted, { emitEvent: true });
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent) {
    const input = this.el.nativeElement as HTMLInputElement;
    if (event.key === 'Backspace' && input.selectionStart === input.selectionEnd) {
      const pos = input.selectionStart ?? 0;
      if (pos > 0 && /\D/.test(input.value[pos - 1])) {
        event.preventDefault();
        const newPos = pos - 1;
        input.setSelectionRange(newPos, newPos);
      }
    }
  }

  private format(digits: string): string {
    if (!digits) return '';
    // Pattern: +XX (XXX) XX-XXX-XX
    let result = '+' + digits.slice(0, Math.min(2, digits.length));
    if (digits.length > 2) result += ' (' + digits.slice(2, Math.min(5, digits.length));
    if (digits.length >= 5) result += ') ' + digits.slice(5, Math.min(7, digits.length));
    if (digits.length >= 7) result += '-' + digits.slice(7, Math.min(10, digits.length));
    if (digits.length >= 10) result += '-' + digits.slice(10, 12);
    return result;
  }
}
