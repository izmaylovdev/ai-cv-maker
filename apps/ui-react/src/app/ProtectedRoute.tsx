import { Navigate, Outlet } from 'react-router-dom';

import { useAppSelector } from './hooks';

/**
 * Route guard component that blocks unauthenticated navigation.
 *
 * Reads `auth.token` from the Redux store (populated by `authSlice`, which
 * initialises from `@ai-cv-maker/auth`'s `getSession()`). Redirects to
 * `/auth/login` when there is no token.
 *
 * Wrap protected routes with this component in `app.tsx`:
 * ```tsx
 * <Route element={<ProtectedRoute />}>
 *   <Route path="/job-profiles" element={<JobProfilesPage />} />
 * </Route>
 * ```
 */
export function ProtectedRoute() {
  const token = useAppSelector((s) => s.auth.token);

  if (!token) {
    return <Navigate to="/auth/login" replace />;
  }

  return <Outlet />;
}
