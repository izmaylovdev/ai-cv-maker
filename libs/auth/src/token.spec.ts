import { describe, expect, it } from 'vitest';
import { isTokenExpired, parseJwt, getTokenExpiry } from './token';

function makeToken(exp: number): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({ sub: '1', email: 'a@b.com', exp }));
  return `${header}.${payload}.fakesig`;
}

const FUTURE = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
const PAST = Math.floor(Date.now() / 1000) - 3600;   // 1 hour ago

describe('parseJwt', () => {
  it('decodes a valid token', () => {
    const token = makeToken(FUTURE);
    const payload = parseJwt(token);
    expect(payload?.email).toBe('a@b.com');
    expect(payload?.exp).toBe(FUTURE);
  });

  it('returns null for garbage input', () => {
    expect(parseJwt('not.a.token')).toBeNull();
    expect(parseJwt('')).toBeNull();
  });
});

describe('isTokenExpired', () => {
  it('returns false for a future token', () => {
    expect(isTokenExpired(makeToken(FUTURE))).toBe(false);
  });

  it('returns true for a past token', () => {
    expect(isTokenExpired(makeToken(PAST))).toBe(true);
  });

  it('returns true for null/undefined', () => {
    expect(isTokenExpired(null)).toBe(true);
    expect(isTokenExpired(undefined)).toBe(true);
  });

  it('returns true for a malformed token', () => {
    expect(isTokenExpired('bad')).toBe(true);
  });
});

describe('getTokenExpiry', () => {
  it('returns a Date for a valid token', () => {
    const expiry = getTokenExpiry(makeToken(FUTURE));
    expect(expiry).toBeInstanceOf(Date);
    expect(expiry!.getTime()).toBe(FUTURE * 1000);
  });

  it('returns null for a malformed token', () => {
    expect(getTokenExpiry('bad')).toBeNull();
  });
});
