import { HttpErrorResponse } from '@angular/common/http';

/**
 * Shared detection for the per-user LLM spending-limit response (US-AI-7).
 * cv-api returns HTTP 402 with `{ code: 'usage_limit_exceeded', message, limitUsd }`
 * when the user has hit their cap. The frontend surfaces a distinct message
 * rather than a generic AI-failure (F-AI-9.8).
 */

const FALLBACK = 'You have reached your AI usage limit.';

export function isUsageLimitError(err: unknown): err is HttpErrorResponse {
  return (
    err instanceof HttpErrorResponse &&
    err.status === 402 &&
    (err.error as { code?: string } | null)?.code === 'usage_limit_exceeded'
  );
}

export function usageLimitMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const message = (err.error as { message?: string } | null)?.message;
    if (message) return message;
  }
  return FALLBACK;
}
