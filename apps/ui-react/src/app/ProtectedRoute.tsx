import { Navigate, Outlet } from 'react-router-dom';

import { useAppSelector } from './hooks';

export function ProtectedRoute() {
  const token = useAppSelector((s) => s.auth.token);

  if (!token) {
    return <Navigate to="/auth/login" replace />;
  }

  return <Outlet />;
}
