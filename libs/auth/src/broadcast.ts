/**
 * @module broadcast
 *
 * Cross-tab auth event bus built on the `BroadcastChannel` API.
 *
 * ## Why this is needed
 *
 * `ui-angular` and `ui-react` run on the same origin. When the user logs out
 * in one app (or one tab), the other app's in-memory auth state still reads
 * "logged in" until a page reload — unless explicitly notified.
 *
 * `BroadcastChannel` sends a message to every same-origin tab/window
 * simultaneously, allowing all apps to clear their state and redirect to
 * `/auth/login` within milliseconds.
 *
 * ## Graceful degradation
 *
 * `BroadcastChannel` is unavailable in:
 * - Unit test environments (Node / jsdom without the API)
 * - Some older WebViews
 *
 * `createAuthBroadcast()` returns a no-op implementation in those cases so
 * callers never need to check for support.
 */

const CHANNEL_NAME = 'ai-cv-maker:auth';

type AuthEvent = { type: 'logout' };

/**
 * Handle returned by `createAuthBroadcast()`.
 * Inject this into services/components and call `destroy()` on teardown.
 */
export interface AuthBroadcast {
  /**
   * Broadcast a logout event to every other same-origin tab.
   *
   * Call this **after** `clearSession()` so that other tabs see an empty
   * localStorage when they react to the event.
   *
   * Note: `BroadcastChannel` does **not** fire the event in the sending tab —
   * the caller must update its own state directly.
   */
  notifyLogout(): void;

  /**
   * Register a callback that fires when another tab broadcasts a logout.
   *
   * Returns an unsubscribe function. Call it in `ngOnDestroy` (Angular) or
   * the React cleanup function to prevent memory leaks.
   *
   * @param callback - Runs in the receiving tab. Should clear local auth state
   *                   and redirect to `/auth/login`.
   * @returns A zero-argument function that removes this listener.
   *
   * @example
   * // Angular
   * private unsub = this.broadcast.onLogout(() => this._applyLogout(false));
   * ngOnDestroy() { this.unsub(); }
   *
   * @example
   * // React (module-level, runs once at app startup)
   * authBroadcast.onLogout(() => store.dispatch(logout()));
   */
  onLogout(callback: () => void): () => void;

  /**
   * Close the underlying `BroadcastChannel` and remove all listeners.
   *
   * Call this when the app (or the service that owns this instance) unmounts.
   * After `destroy()` the instance is no longer usable.
   */
  destroy(): void;
}

/**
 * Create a shared `BroadcastChannel`-backed auth event bus.
 *
 * One instance per app is sufficient — create it at module initialisation
 * time and share it via DI (Angular) or a module-level variable (React).
 *
 * @example
 * // Angular — created once in AuthService constructor
 * private broadcast = createAuthBroadcast();
 *
 * @example
 * // React — module-level in main.tsx
 * const authBroadcast = createAuthBroadcast();
 * authBroadcast.onLogout(() => store.dispatch(logout()));
 */
export function createAuthBroadcast(): AuthBroadcast {
  // Graceful no-op fallback for environments without BroadcastChannel
  if (typeof BroadcastChannel === 'undefined') {
    return {
      notifyLogout: () => undefined,
      onLogout: () => () => undefined,
      destroy: () => undefined,
    };
  }

  const channel = new BroadcastChannel(CHANNEL_NAME);
  const listeners = new Set<() => void>();

  channel.onmessage = (event: MessageEvent<AuthEvent>) => {
    if (event.data?.type === 'logout') {
      listeners.forEach((cb) => cb());
    }
  };

  return {
    notifyLogout() {
      channel.postMessage({ type: 'logout' } satisfies AuthEvent);
    },

    onLogout(callback: () => void) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },

    destroy() {
      listeners.clear();
      channel.close();
    },
  };
}
