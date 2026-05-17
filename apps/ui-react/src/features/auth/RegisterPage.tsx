import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { GoogleSignInButton } from '../../shared/components/GoogleSignInButton';
import { register as registerThunk, googleLogin } from './authSlice';
import { useAppDispatch } from '../../app/hooks';

export function RegisterPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hidePassword, setHidePassword] = useState(true);
  const [hideConfirm, setHideConfirm] = useState(true);
  const [touched, setTouched] = useState({
    email: false,
    password: false,
    confirm: false,
  });

  const onGoogle = useCallback(
    async (credential: string) => {
      setLoading(true);
      setError('');
      const res = await dispatch(googleLogin(credential));
      setLoading(false);
      if (googleLogin.fulfilled.match(res)) {
        navigate('/profile');
      } else {
        setError('Google sign-in failed. Please try again.');
      }
    },
    [dispatch, navigate],
  );

  const mismatch =
    touched.confirm && confirmPassword.length > 0 && password !== confirmPassword;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ email: true, password: true, confirm: true });
    if (!email || !password || password.length < 6 || password !== confirmPassword) return;
    setLoading(true);
    setError('');
    const res = await dispatch(registerThunk({ email, password }));
    setLoading(false);
    if (registerThunk.fulfilled.match(res)) {
      navigate('/profile');
    } else {
      const status = res.payload as number | undefined;
      setError(
        status === 409
          ? 'An account with this email already exists.'
          : 'Registration failed. Please try again.',
      );
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-128px)] items-center justify-center">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg transition-colors dark:bg-gray-800">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white">Create Account</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Start building your AI-powered CV
        </p>

        <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Email
            </label>
            <input
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, email: true }))}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-500"
            />
            {touched.email && !email && (
              <span className="text-xs text-red-500">Email is required</span>
            )}
            {touched.email && email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && (
              <span className="text-xs text-red-500">Enter a valid email</span>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Password
            </label>
            <div className="relative">
              <input
                type={hidePassword ? 'password' : 'text'}
                autoComplete="new-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-10 text-sm text-gray-900 placeholder-gray-400 transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-500"
              />
              <button
                type="button"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer border-0 bg-transparent p-0 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                onClick={() => setHidePassword((v) => !v)}
              >
                <span className="material-icons text-[18px]">
                  {hidePassword ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            </div>
            {touched.password && !password && (
              <span className="text-xs text-red-500">Password is required</span>
            )}
            {touched.password && password.length > 0 && password.length < 6 && (
              <span className="text-xs text-red-500">Password must be at least 6 characters</span>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Confirm Password
            </label>
            <div className="relative">
              <input
                type={hideConfirm ? 'password' : 'text'}
                autoComplete="new-password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, confirm: true }))}
                className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-10 text-sm text-gray-900 placeholder-gray-400 transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-500"
              />
              <button
                type="button"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer border-0 bg-transparent p-0 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                onClick={() => setHideConfirm((v) => !v)}
              >
                <span className="material-icons text-[18px]">
                  {hideConfirm ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            </div>
            {mismatch && (
              <span className="text-xs text-red-500">Passwords do not match</span>
            )}
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-0 bg-blue-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              'Create Account'
            )}
          </button>
        </form>

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-gray-200 dark:bg-gray-600" />
          <span className="text-xs text-gray-400 dark:text-gray-500">or</span>
          <div className="h-px flex-1 bg-gray-200 dark:bg-gray-600" />
        </div>

        <GoogleSignInButton mode="signup" onCredential={onGoogle} />

        <p className="mt-5 text-center text-sm text-gray-600 dark:text-gray-300">
          Already have an account?{' '}
          <Link
            to="/auth/login"
            className="font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
