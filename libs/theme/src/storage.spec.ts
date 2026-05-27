import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, getSystemPreference, getTheme, saveTheme } from './storage';

function makeLocalStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
}

describe('getTheme', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', makeLocalStorage()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns persisted value when set to dark', () => {
    localStorage.setItem('theme', 'dark');
    expect(getTheme()).toBe('dark');
  });

  it('returns persisted value when set to light', () => {
    localStorage.setItem('theme', 'light');
    expect(getTheme()).toBe('light');
  });

  it('falls back to system preference (dark) when nothing persisted', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    expect(getTheme()).toBe('dark');
  });

  it('falls back to light when no persistence and system prefers light', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    expect(getTheme()).toBe('light');
  });
});

describe('saveTheme', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', makeLocalStorage()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('writes dark to localStorage', () => {
    saveTheme('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('overwrites previous value', () => {
    saveTheme('dark');
    saveTheme('light');
    expect(localStorage.getItem('theme')).toBe('light');
  });
});

describe('applyTheme', () => {
  afterEach(() => {
    document.documentElement.classList.remove('dark');
  });

  it('adds dark class for dark theme', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('removes dark class for light theme', () => {
    document.documentElement.classList.add('dark');
    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});

describe('getSystemPreference', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns dark when OS prefers dark', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    expect(getSystemPreference()).toBe('dark');
  });

  it('returns light when OS prefers light', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    expect(getSystemPreference()).toBe('light');
  });
});
