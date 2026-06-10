import { Component, OnInit, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SettingsService } from './settings.service';
import { NotifyService } from '../../shared/services/notify.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div class="max-w-2xl mx-auto py-8 px-4">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-8">Settings</h1>
      <section>
        <h2 class="text-base font-semibold text-gray-800 dark:text-zinc-200 mb-1">Global Preferences</h2>
        <p class="text-sm text-gray-500 dark:text-zinc-400 mb-3">
          These preferences are applied to all AI-generated content across your profiles.
        </p>
        <textarea
          [formControl]="prefsControl"
          rows="6"
          placeholder="Add tone, formatting, or rules."
          class="w-full rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-zinc-500 px-3 py-2 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
        ></textarea>
        <div class="mt-3 flex justify-end">
          <button
            (click)="save()"
            [disabled]="saving()"
            class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium transition-colors">
            {{ saving() ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </section>
    </div>
  `,
})
export class SettingsComponent implements OnInit {
  private settings = inject(SettingsService);
  private notify = inject(NotifyService);

  readonly prefsControl = new FormControl('');
  readonly saving = signal(false);

  ngOnInit() {
    this.settings.get().subscribe({
      next: ({ globalPreferences }) => this.prefsControl.setValue(globalPreferences ?? ''),
    });
  }

  save() {
    this.saving.set(true);
    this.settings.save(this.prefsControl.value ?? '').subscribe({
      next: () => {
        this.saving.set(false);
        this.notify.success('Preferences saved.');
      },
      error: () => {
        this.saving.set(false);
        this.notify.error('Could not save. Please try again.');
      },
    });
  }
}
