import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../auth/auth.service';

/**
 * HTTP interceptor that attaches the JWT to every outgoing request.
 *
 * Reads the token via `AuthService.getToken()` (which delegates to
 * `@ai-cv-maker/auth`'s `getToken()`) and injects an `Authorization: Bearer`
 * header when a session exists. Requests without a session are passed through
 * unchanged — public endpoints (e.g. `/api/auth/login`) work normally.
 *
 * Registered in `app.config.ts`:
 * ```ts
 * provideHttpClient(withInterceptors([apiInterceptor]))
 * ```
 */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(AuthService).getToken();
  if (token) {
    req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }
  return next(req);
};
