import { mountDevShell } from '@applysy/dev-shell';

// Shared dev chrome (title bar, theme toggle, login/logout) — same harness the
// chat-ui widget uses. The profile builder is host-agnostic and ignores the
// `auth-token` attribute the shell sets; the shell is used here only for a
// consistent dev experience and theme switching.
mountDevShell({
  widgetSelector: 'applysy-profile-builder',
  apiBase: 'http://localhost:5050/api',
  googleClientId: import.meta.env['VITE_GOOGLE_CLIENT_ID'] ?? '',
  title: 'profile-builder-ui dev',
});
