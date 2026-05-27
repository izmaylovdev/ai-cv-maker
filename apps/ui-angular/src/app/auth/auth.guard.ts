import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Route guard that blocks unauthenticated navigation.
 *
 * Checks `AuthService.isLoggedIn` (an Angular signal backed by
 * `@ai-cv-maker/auth`'s `isTokenExpired()`). Redirects to `/auth/login`
 * when there is no valid session.
 *
 * Applied to all protected routes in `app.routes.ts`:
 * ```ts
 * { path: 'job-profiles', canActivate: [authGuard], ... }
 * ```
 */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isLoggedIn()) return true;
  return router.createUrlTree(['/auth/login']);
};
