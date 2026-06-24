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

      // US-AI-9: apply a chat edit (ops patch JSON). The real builder applies +
      // validates via model.ts; this stub honours `updateHeader` (so the change
      // is observable) and rejects empty / unknown-op / missing-target patches
      // so the host's failure path (F-CHAT-6.10) can be exercised.
      applyEdit(patchJson: string): { ok: boolean; errors: string[] } {
        let patch: { ops?: Array<Record<string, unknown>> };
        try {
          patch = JSON.parse(patchJson);
        } catch {
          return { ok: false, errors: ['invalid json'] };
        }
        const ops = patch.ops ?? [];
        const known = ['updateHeader', 'convertNode', 'setAttrs', 'addChild', 'removeNode'];
        const bad =
          ops.length === 0 ||
          ops.some((o) => !known.includes(o.op as string)) ||
          ops.some((o) => o.id === 'MISSING' || o.parentId === 'MISSING');
        if (bad) return { ok: false, errors: ['rejected'] };

        const headerOp = ops.find((o) => o.op === 'updateHeader');
        if (headerOp) {
          const doc = this._document as { header?: Record<string, unknown> };
          this._document = {
            ...(this._document as object),
            header: { ...(doc.header ?? {}), ...((headerOp.fields as object) ?? {}) },
          };
          this.renderDoc();
        }
        this.dispatchEvent(
          new CustomEvent('documentchange', {
            detail: this._document,
            bubbles: true,
            composed: true,
          }),
        );
        return { ok: true, errors: [] };
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
