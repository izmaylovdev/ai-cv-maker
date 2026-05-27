import { mountDevShell } from '@ai-cv-maker/dev-shell';

mountDevShell({
  widgetSelector: 'ai-chat-widget',
  apiBase: 'http://localhost:5050/api',
  googleClientId: import.meta.env['VITE_GOOGLE_CLIENT_ID'] ?? '',
  title: 'chat-ui dev',
});
