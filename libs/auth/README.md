# `@ai-cv-maker/auth`

Shared authentication library for the AI CV Maker monorepo.

Contains framework-agnostic TypeScript — no Angular, React, or Redux imports.  
Each app wraps these primitives in its own DI/state layer.

---

## Modules

| Module | Exports | Purpose |
|---|---|---|
| `models` | `AuthRequest`, `AuthResponse`, `AuthSession`, `JwtPayload` | Shared TypeScript interfaces |
| `constants` | `TOKEN_KEY`, `EMAIL_KEY` | Single source of truth for localStorage key names |
| `storage` | `getToken`, `getSession`, `saveSession`, `clearSession` | Read/write the auth session in localStorage |
| `token` | `parseJwt`, `isTokenExpired`, `getTokenExpiry` | Decode JWT claims client-side (no signature verification) |
| `api` | `loginApi`, `registerApi`, `googleLoginApi` | Plain `fetch` wrappers for `cv-api` auth endpoints |
| `broadcast` | `createAuthBroadcast`, `AuthBroadcast` | Cross-tab logout sync via `BroadcastChannel` |

---

## Usage

### In `ui-angular` (Angular service)

```ts
import {
  loginApi, registerApi, googleLoginApi,
  saveSession, clearSession, getToken,
  createAuthBroadcast, isTokenExpired,
} from '@ai-cv-maker/auth';

@Injectable({ providedIn: 'root' })
export class AuthService implements OnDestroy {
  private broadcast = createAuthBroadcast();
  private unsub = this.broadcast.onLogout(() => this._applyLogout(false));

  readonly isLoggedIn = signal(!isTokenExpired(getToken()));

  login(req: AuthRequest) {
    return from(loginApi(req, environment.apiUrl)).pipe(
      tap(res => { saveSession(res.token, res.email); this.isLoggedIn.set(true); })
    );
  }

  logout() {
    clearSession();
    this.broadcast.notifyLogout(); // notify other tabs before navigating
    this._applyLogout(true);
  }

  ngOnDestroy() { this.unsub(); this.broadcast.destroy(); }
}
```

### Token expiry check

```ts
import { isTokenExpired, getTokenExpiry } from '@ai-cv-maker/auth';

// Guard a route
if (isTokenExpired(token)) navigate('/auth/login');

// Show a "session expires" warning
const expiry = getTokenExpiry(token);
if (expiry) console.log('session valid until', expiry.toLocaleString());
```

---

## Design decisions

### Access token in localStorage, refresh token in HttpOnly cookie

The access token (1-hour JWT) lives in localStorage for easy use by the Angular
interceptor and the `<ai-chat-widget>` Web Component, which has no cookie access.

The refresh token (30-day) is stored in an HttpOnly cookie set by `cv-api` on
login/register. It is never readable by JavaScript — a meaningful XSS mitigation.
The browser sends it automatically when the interceptor calls `POST /api/auth/refresh`
with `credentials: 'include'`.

Refresh tokens are stored hashed (SHA-256) in the `RefreshTokens` table and
rotated on every use. A stolen refresh token cannot be reused after one rotation.

Mitigate remaining XSS risk on the access token with a strict Content-Security-Policy
and standard Angular output sanitisation.

### Why BroadcastChannel instead of storage events?

`storage` events fire on *other* tabs but not the writing tab — it's tricky to
use consistently. `BroadcastChannel` is explicit, works the same in all tabs,
and carries typed messages. It degrades gracefully to a no-op when unavailable
(Node, older WebViews).

### Why plain `fetch` in `api.ts` instead of `HttpClient`?

Angular's `HttpClient` is DI-bound and wraps `fetch` in Observables. Using
plain `fetch` here means the same `loginApi()` function can be called from:
- An Angular `Injectable` (wrapped in `from()`)
- A Web Component / standalone script (no framework DI)

---

## Development

```sh
# Run tests
npx nx test auth

# Type-check only
npx nx typecheck auth

# Build the library
npx nx build auth
```

Tests use [Vitest](https://vitest.dev/) with a jsdom environment.
localStorage is stubbed via `vi.stubGlobal` — no real browser needed.
