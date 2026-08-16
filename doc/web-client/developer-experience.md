# Developer Experience

The widget apps (`chat-ui`, `profile-builder-ui`) are web components with no
login screen of their own. To develop them standalone you still need a real JWT
and a theme. `@applysy/dev-shell` provides both as a dev-only top bar.

**Code:** `libs/dev-shell`, `libs/theme`
**See also:** [ARCHITECTURE.md — Shared Libraries](../../ARCHITECTURE.md#shared-libraries) ·
[authentication.md](authentication.md)

---

## `@applysy/theme`

A framework-agnostic library owning theme state, backed by `localStorage`:

| Function | Purpose |
|---|---|
| `getTheme()` | Persisted theme, falling back to OS preference, then `light` |
| `saveTheme(theme)` | Persist the choice |
| `applyTheme(theme)` | Toggle the `dark` class on `<html>` |
| `getSystemPreference()` | The OS colour-scheme preference |

Angular's `ThemeService` is a thin wrapper that delegates to these — the logic
exists in exactly one place, and the widgets read the same `.dark` class.

---

## `@applysy/dev-shell`

Plain TypeScript and DOM only — no React or Angular imports. `mountDevShell(config)`
prepends a fixed 40px top bar to the host page and pads the body so the widget is
not obscured.

```ts
mountDevShell({
  widgetSelector: 'ai-chat-widget',           // element that receives `auth-token`
  apiBase: 'http://localhost:5050/api',
  googleClientId: import.meta.env['VITE_GOOGLE_CLIENT_ID'] ?? '',
  title: 'chat-ui dev',
});
```

The bar carries a title, a theme toggle (☀/☾, persisted via `@applysy/theme`),
and an auth section. Signed out, it shows an email/password form plus a Google
Sign-In button — the GIS SDK is loaded lazily only when needed. A successful
login through either path calls `saveSession()` from `@applysy/auth` and sets the
`auth-token` attribute on the configured widget element; logging out calls
`clearSession()` and removes the attribute. So the widget receives exactly the
token shape it gets in production.

Each widget app wires it from a dev-only entry — `apps/chat-ui/src/dev-shell.ts`
and `apps/profile-builder-ui/src/dev-shell.ts` — loaded from that app's
`index.html`, which is never part of a production bundle.
`@applysy/dev-shell` must stay a `devDependency` everywhere it is used.

---

## Not implemented

Cross-tab logout sync in the shell (the widgets do not need it), any theming of
the bar beyond a neutral style, and support for widgets that take auth via props
or events rather than an HTML attribute.
