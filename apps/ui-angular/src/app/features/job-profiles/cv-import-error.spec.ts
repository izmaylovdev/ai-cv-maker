import { HttpErrorResponse } from '@angular/common/http';
import { describe, it, expect } from 'vitest';
import { cvImportErrorMessage } from './cv-import-error';

const res = (status: number, error: unknown) => new HttpErrorResponse({ status, error });

describe('cvImportErrorMessage', () => {
  it('uses a plain-text body verbatim', () => {
    expect(cvImportErrorMessage(res(503, '  CV extraction is temporarily unavailable.  ')))
      .toBe('CV extraction is temporarily unavailable.');
  });

  it('uses message from a { code, message } body', () => {
    expect(cvImportErrorMessage(res(503, { code: 'llm_unavailable', message: 'AI unreachable.' })))
      .toBe('AI unreachable.');
  });

  it('ignores an HTML body (proxy error page) and falls back by status', () => {
    expect(cvImportErrorMessage(res(502, '<html><body>Bad Gateway</body></html>')))
      .toBe('Something went wrong. Please try again.');
  });

  it.each([
    [400, "We couldn't read any text from that file. Try a different PDF."],
    [402, 'You have reached your AI usage limit.'],
    [413, 'That file is too large. The limit is 10 MB.'],
    [429, 'CV import is temporarily unavailable. Please try again later.'],
    [503, 'CV import is temporarily unavailable. Please try again later.'],
    [0, "We couldn't reach the server. Check your connection and try again."],
    [500, 'Something went wrong. Please try again.'],
  ])('falls back for status %i with no usable body', (status, expected) => {
    expect(cvImportErrorMessage(res(status, null))).toBe(expected);
    expect(cvImportErrorMessage(res(status, '   '))).toBe(expected);
  });

  it('falls back for a non-HTTP error', () => {
    expect(cvImportErrorMessage(new Error('boom'))).toBe('Something went wrong. Please try again.');
  });
});
