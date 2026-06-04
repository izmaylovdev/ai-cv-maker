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

### Why not HttpOnly cookies?

`cv-api` currently issues tokens in the response body (not via `Set-Cookie`).
Moving to HttpOnly cookies requires server-side changes to:
1. Set `Set-Cookie: token=…; HttpOnly; Secure; SameSite=Strict` on login/register responses
2. Accept `Cookie` instead of (or in addition to) `Authorization: Bearer`

Until then, localStorage is the pragmatic choice. Mitigate XSS risk with a
strict Content-Security-Policy and standard Angular/React output sanitisation.
See the auth audit notes in `ARCHITECTURE.md` for the full upgrade path.

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
