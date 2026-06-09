import {
  HttpErrorResponse,
  HttpInterceptorFn,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';

/**
 * HTTP interceptor that:
 *  1. Attaches the JWT `Authorization: Bearer` header to every outgoing request.
 *  2. On a 401 response, attempts a silent token refresh via the HttpOnly cookie,
 *     retries the original request once with the new token, and — if the refresh
 *     also fails — clears the session and redirects to login.
 *
 * Auth endpoints (`/api/auth/`) are excluded from the retry loop to prevent
 * infinite cycles when login/refresh themselves return 401.
 *
 * Registered in `app.config.ts`:
 * ```ts
 * provideHttpClient(withInterceptors([apiInterceptor]))
 * ```
 */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const token = authService.getToken();

  const authedReq = token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authedReq).pipe(
    catchError((err: unknown) => {
      // Only attempt refresh for 401s on non-auth endpoints
      if (
        err instanceof HttpErrorResponse &&
        err.status === 401 &&
        !req.url.includes('/api/auth/')
      ) {
        return authService.refresh().pipe(
          switchMap((res) => {
            const retried = req.clone({
              setHeaders: { Authorization: `Bearer ${res.token}` },
            });
            return next(retried);
          }),
          catchError((refreshErr: unknown) => {
            // Refresh failed — force logout without broadcasting (already logged out)
            authService.forceLogout();
            return throwError(() => refreshErr);
          })
        );
      }
      return throwError(() => err);
    })
  );
};
