export interface DevShellConfig {
  /** CSS selector for the widget element that receives `auth-token`. */
  widgetSelector: string;
  /** cv-api base URL, e.g. "http://localhost:5050/api". */
  apiBase: string;
  /** Google OAuth client ID for One-Tap / popup sign-in. */
  googleClientId: string;
  /** Label shown in the bar. Defaults to widgetSelector. */
  title?: string;
}
