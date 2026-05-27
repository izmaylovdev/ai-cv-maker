import {
  Component,
  Input,
  OnDestroy,
  forwardRef,
  inject,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ProfileService } from '../../../features/profile/profile.service';
import { NotifyService } from '../../services/notify.service';

@Component({
  selector: 'app-enhanced-textarea',
  standalone: true,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => EnhancedTextareaComponent),
      multi: true,
    },
  ],
  template: `
    <div class="relative">
      <textarea
        [id]="inputId || null"
        [rows]="rows"
        [class]="textareaClass"
        [placeholder]="placeholder"
        [value]="value"
        [disabled]="disabled"
        (input)="onInput($event)"
        (focus)="focused.set(true)"
        (blur)="onBlur()"
      ></textarea>

      @if (focused() || enhancing()) {
        <div class="group absolute bottom-4 right-2">
          <button
            type="button"
            [disabled]="enhancing() || !value.trim()"
            (click)="enhance()"
            (mousedown)="$event.preventDefault()"
            class="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-purple-500 transition-all hover:text-purple-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-purple-400 dark:hover:text-purple-300"
          >
            @if (enhancing()) {
              <span class="h-3 w-3 animate-spin rounded-full border-2 border-purple-500 border-t-transparent dark:border-purple-400"></span>
            } @else {
              <span class="material-icons text-sm leading-none">auto_fix_high</span>
            }
          </button>
          @if (!enhancing()) {
            <div class="pointer-events-none absolute bottom-full right-0 mb-1.5 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100 dark:bg-gray-700">
              Enhance with AI
            </div>
          }
        </div>
      }

    </div>
  `,
})
export class EnhancedTextareaComponent implements ControlValueAccessor, OnDestroy {
  @Input() inputId = '';
  @Input() rows = 3;
  @Input() textareaClass = '';
  @Input() placeholder = '';
  @Input() fieldPurpose = '';

  private profileService = inject(ProfileService);
  private notify = inject(NotifyService);

  value = '';
  disabled = false;
  readonly focused = signal(false);
  readonly enhancing = signal(false);

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private onChange: (v: string) => void = () => {};
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private onTouched: () => void = () => {};
  private enhanceSub?: Subscription;

  writeValue(v: string): void {
    this.value = v ?? '';
  }

  registerOnChange(fn: (v: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled = disabled;
  }

  onInput(event: Event): void {
    const v = (event.target as HTMLTextAreaElement).value;
    this.value = v;
    this.onChange(v);
  }

  onBlur(): void {
    if (!this.enhancing()) {
      this.focused.set(false);
    }
    this.onTouched();
  }

  enhance(): void {
    if (!this.value.trim() || this.enhancing()) return;
    this.enhancing.set(true);
    this.enhanceSub = this.profileService
      .enhanceField(this.value, this.fieldPurpose)
      .subscribe({
        next: ({ enhanced }) => {
          this.value = enhanced;
          this.onChange(enhanced);
          this.enhancing.set(false);
        },
        error: () => {
          this.notify.error('Failed to enhance text. Please try again.');
          this.enhancing.set(false);
        },
      });
  }

  ngOnDestroy(): void {
    this.enhanceSub?.unsubscribe();
  }
}
