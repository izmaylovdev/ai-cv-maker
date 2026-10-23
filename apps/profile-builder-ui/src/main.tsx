import { flushSync } from 'react-dom';
import ReactDOM from 'react-dom/client';
import { ProfileBuilder } from './ProfileBuilder';
import { DocumentPatch, ProfileDocument, applyPatch, emptyDocument } from './model';

// Self-contained web component wrapper (spec §7.3), mirroring apps/chat-ui's
// <ai-chat-widget>. Host-agnostic boundary:
//   • input:  `document` attribute (JSON string) or `.document` property (object)
//   • output: `documentchange` CustomEvent, detail = the current ProfileDocument
//   • method: `applyEdit(patchJson)` applies a chat edit (US-AI-9 §6.4)

class ProfileBuilderWidget extends HTMLElement {
  private root?: ReturnType<typeof ReactDOM.createRoot>;
  private _document: ProfileDocument = emptyDocument();

  static get observedAttributes() {
    return ['document'];
  }

  /** Property access for hosts that pass an object rather than a JSON attribute. */
  get document(): ProfileDocument {
    return this._document;
  }
  set document(value: ProfileDocument) {
    this._document = value ?? emptyDocument();
    this.renderWidgetNow();
  }

  connectedCallback() {
    this.readDocumentAttribute();
    this.root = ReactDOM.createRoot(this);
    this.renderWidget();
  }

  disconnectedCallback() {
    this.root?.unmount();
  }

  attributeChangedCallback() {
    this.readDocumentAttribute();
    this.renderWidgetNow();
  }

  private readDocumentAttribute() {
    const raw = this.getAttribute('document');
    if (!raw) return;
    try {
      this._document = JSON.parse(raw) as ProfileDocument;
    } catch {
      console.warn('[profile-builder] Ignoring invalid `document` attribute JSON.');
    }
  }

  /**
   * Apply an AI chat edit (US-AI-9 §6.4). Parses the patch JSON, applies +
   * validates it against the current document via {@link applyPatch}, and on
   * success seeds the editor (firing `documentchange`, so the host marks the
   * profile dirty). Never persists — the host's Save flow does that. Atomic: an
   * invalid patch changes nothing and returns `{ ok: false, errors }`.
   */
  applyEdit(patchJson: string): { ok: boolean; errors: string[] } {
    let patch: DocumentPatch;
    try {
      patch = JSON.parse(patchJson) as DocumentPatch;
    } catch {
      return { ok: false, errors: ['Edit could not be parsed.'] };
    }
    const { document, result } = applyPatch(this._document, patch);
    if (!result.valid) return { ok: false, errors: result.errors };
    // handleChange seeds the editor (re-render) and fires `documentchange`.
    this.handleChange(document);
    return { ok: true, errors: [] };
  }

  private handleChange = (doc: ProfileDocument) => {
    this._document = doc;
    // Re-render so the React-controlled header inputs reflect the new value —
    // without this, typing into a header field is reverted to the stale prop
    // (the Lexical body is uncontrolled, so it's unaffected). LoadBodyPlugin
    // guards against reloading the editor on these no-op body re-renders.
    this.renderWidget();
    this.dispatchEvent(
      new CustomEvent<ProfileDocument>('documentchange', {
        detail: doc,
        bubbles: true,
        composed: true,
      })
    );
  };

  private renderWidget() {
    this.root?.render(
      <ProfileBuilder document={this._document} onChange={this.handleChange} />
    );
  }

  /**
   * Render a document the host just set, synchronously: once `el.document = x`
   * (or the attribute) returns, the editor already shows `x`, so a host — or a
   * test — reading the DOM next sees the new content rather than racing React's
   * scheduler. Internal re-renders (handleChange) stay asynchronous.
   */
  private renderWidgetNow() {
    flushSync(() => this.renderWidget());
  }
}

if (!customElements.get('applysy-profile-builder')) {
  customElements.define('applysy-profile-builder', ProfileBuilderWidget);
}
