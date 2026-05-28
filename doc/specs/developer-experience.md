# Spec: Developer Experience

**Source user stories:** US-DX-1  
**Feature area:** Microfrontend dev tooling  
**Status:** Draft

---

## 1. Dev Shell Library (US-DX-1)

### 1.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-DX-1.1 | `@ai-cv-maker/theme` is a framework-agnostic TypeScript library exposing `getTheme()`, `saveTheme()`, `applyTheme()`, and `getSystemPreference()` backed by `localStorage`. |
| F-DX-1.2 | `@ai-cv-maker/dev-shell` is a framework-agnostic TypeScript library (no React / Angular runtime dependency). |
| F-DX-1.3 | Calling `mountDevShell(config)` inserts a fixed top bar into the host page containing a theme toggle and auth controls. |
| F-DX-1.4 | The theme toggle switches between light and dark, applies the `dark` class to `<html>`, and persists the choice via `@ai-cv-maker/theme`. |
| F-DX-1.5 | When no session exists the auth panel shows an email + password login form and a "Sign in with Google" button. |
| F-DX-1.6 | On successful login (email/password or Google) the bar switches to show the logged-in email and a "Log out" button; the library sets the `auth-token` attribute on the configured widget element. |
| F-DX-1.7 | Logging out clears the session via `@ai-cv-maker/auth` and removes `auth-token` from the widget element. |
| F-DX-1.8 | `@ai-cv-maker/dev-shell` is listed as a `devDependency` in every widget app that uses it and must never appear in a production bundle. |

### 1.2 Technical Specification

#### `libs/theme`

New library, mirrors the structure of `libs/auth`.

```
libs/theme/
  src/
    constants.ts   # THEME_KEY = 'theme'
    storage.ts     # getTheme, saveTheme, applyTheme, getSystemPreference
    index.ts
  package.json     # name: "@ai-cv-maker/theme"
  project.json
  tsconfig.json
  tsconfig.lib.json
```

Public API:

```typescript
type Theme = 'light' | 'dark';

// Read persisted theme, falling back to OS preference, then 'light'.
function getTheme(): Theme;

// Write to localStorage.
function saveTheme(theme: Theme): void;

// Toggle the `dark` class on <html> to match the given theme.
function applyTheme(theme: Theme): void;

// Return the OS color-scheme preference ('dark' | 'light').
function getSystemPreference(): Theme;
```

`ThemeService` in `ui-angular` becomes a thin wrapper that delegates to these four functions — no logic duplication.

#### `libs/dev-shell`

New library. Plain TypeScript, DOM-only — no framework imports allowed.

```
libs/dev-shell/
  src/
    types.ts     # DevShellConfig interface
    shell.ts     # mountDevShell implementation
    styles.ts    # inline CSS string injected at mount time
    index.ts
  package.json   # name: "@ai-cv-maker/dev-shell", private: true
  project.json
  tsconfig.json
  tsconfig.lib.json
```

Public API:

```typescript
interface DevShellConfig {
  /** CSS selector for the widget element that receives `auth-token`. */
  widgetSelector: string;
  /** cv-api base URL, e.g. "http://localhost:5050/api". */
  apiBase: string;
  /** Google OAuth client ID for One-Tap / popup sign-in. */
  googleClientId: string;
  /** Label shown in the bar. Defaults to widgetSelector value. */
  title?: string;
}

function mountDevShell(config: DevShellConfig): void;
```

**Mount behaviour:**

1. Inject a `<style>` tag with bar styles (fixed top bar, z-index 9999, 40 px height).
2. Add `padding-top: 40px` to `document.body` so the widget is not obscured.
3. Create `<div id="__dev-shell__">` prepended to `<body>`.
4. Render (via `innerHTML` / `createElement`):
   - Left: title label.
   - Centre: theme toggle button (☀ / ☾); reads initial state from `getTheme()`, calls `saveTheme` + `applyTheme` on click.
   - Right: auth section — login form (email + password + submit) or logged-in row (email span + "Log out" button).
5. On mount, call `applyTheme(getTheme())` so the host page starts in the correct colour scheme.
6. On login form submit: call `loginApi` from `@ai-cv-maker/auth`; on success call `saveSession` and set `auth-token` on the widget element; re-render auth section.
7. On `renderAuth` (unauthenticated state): load the GIS SDK lazily via a `<script>` tag if `window.google` is not already present; once the SDK is available, call `accounts.id.initialize()` with the client ID and a credential callback, then `accounts.id.renderButton()` to render the official Google Sign-In button into a container `<div>`. On credential callback: call `googleLoginApi` from `@ai-cv-maker/auth`; on success call `saveSession` and set `auth-token` on the widget element. The Google Client ID is passed via `DevShellConfig.googleClientId`.
8. On logout: call `clearSession`; remove `auth-token` attribute from widget element; re-render auth section.

**Usage in `chat-ui` dev entry:**

Replace the hardcoded `auth-token="dev-token"` in `apps/chat-ui/index.html` with a script import:

```html
<script type="module">
  import { mountDevShell } from '@ai-cv-maker/dev-shell';
  mountDevShell({
    widgetSelector: 'ai-chat-widget',
    apiBase: 'http://localhost:5050/api',
    googleClientId: '<GOOGLE_CLIENT_ID>',
    title: 'chat-ui dev',
  });
</script>
<ai-chat-widget api-base="http://localhost:5050/api"></ai-chat-widget>
```

#### Out of scope (MVP)

- Cross-tab sync (`BroadcastChannel`) in the shell — widgets do not need it.
- Any visual theming of the shell bar itself beyond a minimal neutral style.
- Support for widgets that receive auth via props/events rather than an HTML attribute.
