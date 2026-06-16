import { Injectable, signal } from '@angular/core';
import { applyTheme, getTheme, saveTheme } from '@applysy/theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  isDark = signal(getTheme() === 'dark');

  constructor() {
    applyTheme(getTheme());
  }

  toggle() {
    this.isDark.update((v) => !v);
    const theme = this.isDark() ? 'dark' : 'light';
    saveTheme(theme);
    applyTheme(theme);
  }
}
