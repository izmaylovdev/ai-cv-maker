import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadGoogleIdentity } from './google-identity';

const win = window as any;

describe('loadGoogleIdentity', () => {
  afterEach(() => {
    delete win.google;
    vi.useRealTimers();
  });

  it('resolves true immediately when the script is already loaded', async () => {
    win.google = { accounts: { id: {} } };
    await expect(loadGoogleIdentity()).resolves.toBe(true);
  });

  it('resolves true once the script loads after the component starts (the race)', async () => {
    vi.useFakeTimers();
    const promise = loadGoogleIdentity(10000, 100);

    // google is still undefined on the first poll
    await vi.advanceTimersByTimeAsync(100);
    win.google = { accounts: { id: {} } };
    await vi.advanceTimersByTimeAsync(100);

    await expect(promise).resolves.toBe(true);
  });

  it('resolves false when the script never loads before the timeout', async () => {
    vi.useFakeTimers();
    const promise = loadGoogleIdentity(500, 100);
    await vi.advanceTimersByTimeAsync(600);
    await expect(promise).resolves.toBe(false);
  });

  it('does not treat a partially-initialized google global as ready', async () => {
    vi.useFakeTimers();
    win.google = { accounts: {} }; // accounts.id not yet present
    const promise = loadGoogleIdentity(500, 100);
    await vi.advanceTimersByTimeAsync(600);
    await expect(promise).resolves.toBe(false);
  });
});
