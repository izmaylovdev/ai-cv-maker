import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, getSession, getToken, saveSession } from './storage';

// Simple localStorage stub that fully supports all methods
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

describe('storage', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeLocalStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getSession returns nulls when empty', () => {
    const s = getSession();
    expect(s.token).toBeNull();
    expect(s.email).toBe('');
  });

  it('saveSession persists token and email', () => {
    saveSession('tok123', 'user@example.com');
    expect(getToken()).toBe('tok123');
    expect(getSession().email).toBe('user@example.com');
  });

  it('clearSession removes both keys', () => {
    saveSession('tok123', 'user@example.com');
    clearSession();
    expect(getToken()).toBeNull();
    expect(getSession().email).toBe('');
  });
});
