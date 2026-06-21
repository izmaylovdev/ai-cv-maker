import { Page } from '@playwright/test';

/**
 * Registers a fake <applysy-profile-builder> custom element and stubs its bundle
 * request, mirroring registerFakeChatWidget for the chat widget. The real
 * builder is a separately-served React web component that can't load in the e2e
 * environment; this stub gives the host something to load, seed (`.document`),
 * and read back from.
 *
 * The stub:
 *  - reflects the seeded document's header into visible text and data-* attrs so
 *    tests can assert what was loaded (e.g. after optimize/import);
 *  - exposes `__getDocument()` so tests can read the current document;
 *  - exposes `__edit(patch)` to simulate a user edit, which fires the
 *    `documentchange` event the host listens to.
 */
export async function registerFakeProfileBuilder(page: Page) {
  await page.addInitScript(() => {
    class FakeProfileBuilder extends HTMLElement {
      private _document: unknown = { header: {}, sections: [] };

      get document() {
        return this._document;
      }
      set document(value: unknown) {
        this._document = value ?? { header: {}, sections: [] };
        this.renderDoc();
      }

      connectedCallback() {
        this.setAttribute('data-loaded', 'true');
        this.renderDoc();
      }

      // Test hook: read the current document.
      __getDocument() {
        return this._document;
      }

      // Test hook: merge a header patch and fire documentchange (simulated edit).
      __edit(patch: Record<string, unknown>) {
        const doc = this._document as { header?: Record<string, unknown> };
        const next = {
          ...(this._document as object),
          header: { ...(doc.header ?? {}), ...patch },
        };
        this._document = next;
        this.renderDoc();
        this.dispatchEvent(
          new CustomEvent('documentchange', { detail: next, bubbles: true, composed: true }),
        );
      }

      private renderDoc() {
        const doc = this._document as {
          header?: { fullName?: string; title?: string; location?: string };
        };
        const h = doc.header ?? {};
        this.setAttribute('data-full-name', h.fullName ?? '');
        this.setAttribute('data-title', h.title ?? '');
        this.innerHTML = `
          <div data-testid="builder-inner">
            <div data-testid="builder-full-name">${h.fullName ?? ''}</div>
            <div data-testid="builder-title">${h.title ?? ''}</div>
            <div data-testid="builder-location">${h.location ?? ''}</div>
          </div>`;
      }
    }

    if (!customElements.get('applysy-profile-builder')) {
      customElements.define('applysy-profile-builder', FakeProfileBuilder);
    }
  });

  await page.route('**/profile-builder.js', (route) => route.fulfill({ body: '' }));
}
