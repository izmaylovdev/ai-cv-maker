# Developer Experience

## Overview

Infrastructure and tooling stories that improve local development workflow across the microfrontend architecture.

---

## User Stories

### US-DX-1 — Dev shell library for widget apps

**As a** frontend developer building a widget microfrontend,
**I want** to import a dev-shell library that wraps my widget's dev `index.html` with a real auth bar and theme toggle,
**so that** I can develop the widget against a real session and correct theme without hardcoding tokens or duplicating auth/theme setup in every widget.

**Acceptance criteria:**
- A `@ai-cv-maker/dev-shell` library exists and is importable in any widget app's dev entry point.
- The library mounts a top bar above the host widget element containing: a theme toggle (light/dark) and auth controls (email/password login form + "Sign in with Google" button when logged out; email + logout button when logged in).
- Toggling the theme applies the `dark` class to `<html>` and persists the choice via `@ai-cv-maker/theme` storage helpers.
- Auth login/logout uses `@ai-cv-maker/auth` helpers; on successful login the library sets the `auth-token` attribute on the host widget element automatically.
- The library is framework-agnostic (plain TypeScript, no React/Angular dependency) so any widget — web component, React, Angular — can use it.
- The library is never imported in production builds; it is a `devDependency` / used only in dev entry points.
