/**
 * Resolves once the async Google Identity Services script
 * (`https://accounts.google.com/gsi/client`) has loaded and exposed
 * `window.google.accounts.id`.
 *
 * The script is loaded with `async` in index.html, so a component's
 * `ngOnInit` can run before `google` exists. Checking once and giving up
 * (the previous behaviour) made the sign-in button render only when the
 * script happened to win the race. This polls until it's available, or
 * resolves `false` after `timeoutMs` so callers can bail gracefully.
 */
export function loadGoogleIdentity(timeoutMs = 10000, intervalMs = 100): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((window as any).google?.accounts?.id) {
        resolve(true);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(check, intervalMs);
    };
    check();
  });
}
