import { useEffect } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { logout } from '../features/auth/authSlice';
import { toggle } from '../features/theme/themeSlice';
import { useAppDispatch, useAppSelector } from './hooks';

export function Layout() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const token = useAppSelector((s) => s.auth.token);
  const isDark = useAppSelector((s) => s.theme.isDark);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  const isLoggedIn = !!token;
  const isAuthPage = location.pathname.startsWith('/auth/');

  return (
    <>
      <nav className="bg-blue-600 text-white shadow-md transition-colors dark:border-b dark:border-gray-700 dark:bg-gray-900">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-1 px-4">
          <span className="material-icons text-xl">description</span>
          <span className="ml-1 flex-1 text-lg font-semibold">AI CV Maker</span>

          {!isAuthPage && isLoggedIn && (
            <>
              <Link
                to="/job-profiles"
                className="flex cursor-pointer items-center gap-1 rounded px-3 py-1.5 text-sm transition-colors hover:bg-blue-700 dark:hover:bg-gray-800"
              >
                <span className="material-icons text-base">work</span> Job Profiles
              </Link>
              <button
                type="button"
                className="flex cursor-pointer items-center gap-1 rounded border-0 bg-transparent px-3 py-1.5 text-sm text-white transition-colors hover:bg-blue-700 dark:hover:bg-gray-800"
                onClick={() => {
                  dispatch(logout());
                  navigate('/auth/login');
                }}
              >
                <span className="material-icons text-base">logout</span> Logout
              </button>
            </>
          )}

          <button
            type="button"
            title="Toggle dark mode"
            className="ml-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-white transition-colors hover:bg-blue-700 dark:hover:bg-gray-800"
            onClick={() => dispatch(toggle())}
          >
            <span className="material-icons text-[20px]">
              {isDark ? 'light_mode' : 'dark_mode'}
            </span>
          </button>
        </div>
      </nav>

      <main className="mx-auto max-w-4xl px-4 py-8">
        <Outlet />
      </main>
    </>
  );
}
