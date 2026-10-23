import { HttpErrorResponse } from '@angular/common/http';
import { usageLimitMessage } from '../../core/usage-limit';

/**
 * Human-readable reason a CV import (`POST /job-profiles/:id/extract`) failed.
 * cv-api answers with either a plain-text body (the controller's own
 * `BadRequest(...)` / `StatusCode(503, "...")`) or a `{ code, message }` body
 * (the global LLM / usage-limit handlers); when neither carries a message,
 * fall back on the status.
 */
export function cvImportErrorMessage(err: unknown): string {
  if (!(err instanceof HttpErrorResponse)) return GENERIC;

  const body = err.error as unknown;
  // An HTML body is a proxy/gateway error page, not a message for the user.
  if (typeof body === 'string' && body.trim() && !body.trim().startsWith('<')) return body.trim();
  const message = (body as { message?: unknown } | null)?.message;
  if (typeof message === 'string' && message.trim()) return message.trim();

  switch (err.status) {
    case 0: return "We couldn't reach the server. Check your connection and try again.";
    case 400: return "We couldn't read any text from that file. Try a different PDF.";
    case 402: return usageLimitMessage(err);
    case 413: return 'That file is too large. The limit is 10 MB.';
    case 429:
    case 503: return 'CV import is temporarily unavailable. Please try again later.';
    default: return GENERIC;
  }
}

const GENERIC = 'Something went wrong. Please try again.';
