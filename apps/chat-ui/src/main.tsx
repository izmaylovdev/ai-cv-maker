import ReactDOM from 'react-dom/client';
import { ChatApp, ChatApi, ChatEdit, ChatFill, JobContext } from './ChatApp';

// Self-contained web component wrapper. Host-agnostic boundary:
//   • input:  `auth-token` / `api-base` attributes; `.document` property (object)
//             enables in-editor edit mode (US-AI-9) by sending it as context;
//             `.jobContext` property (object) enables side-panel job chat
//             (US-EXT-4).
//   • output: `edit` CustomEvent (detail = { patchJson, description }) when the
//             assistant proposes an edit to the open document; `fill` CustomEvent
//             (detail = { text }) when the user accepts a cover-letter draft.
//   • method: `addAssistantNote(text)` appends a note to the thread (e.g. when
//             the host rejects an edit, F-CHAT-6.10, or reports a fill outcome).
class ChatWidget extends HTMLElement {
  private root?: ReturnType<typeof ReactDOM.createRoot>;
  private _document: unknown = null;
  private _profileId: string | null = null;
  private _jobContext: JobContext | null = null;
  private api?: ChatApi;

  static get observedAttributes() {
    return ['auth-token', 'api-base'];
  }

  /** Property access for the in-editor host to pass the open document object. */
  get document(): unknown {
    return this._document;
  }
  set document(value: unknown) {
    this._document = value ?? null;
    this.renderWidget();
  }

  /** The open profile's id, so the agent's cross-profile reads exclude it (US-AI-13). */
  get profileId(): string | null {
    return this._profileId;
  }
  set profileId(value: string | null) {
    this._profileId = value || null;
    this.renderWidget();
  }

  /** Property access for the side-panel host to pass the page's job posting. */
  get jobContext(): JobContext | null {
    return this._jobContext;
  }
  set jobContext(value: JobContext | null) {
    this._jobContext = value ?? null;
    this.renderWidget();
  }

  /** Append an assistant note to the thread (delegates to the React app). */
  addAssistantNote(text: string) {
    this.api?.addAssistantNote(text);
  }

  connectedCallback() {
    this.root = ReactDOM.createRoot(this);
    this.renderWidget();
  }

  disconnectedCallback() {
    this.root?.unmount();
  }

  attributeChangedCallback() {
    this.renderWidget();
  }

  private handleEdit = (edit: ChatEdit) => {
    this.dispatchEvent(
      new CustomEvent<ChatEdit>('edit', { detail: edit, bubbles: true, composed: true }),
    );
  };

  private handleFill = (fill: ChatFill) => {
    this.dispatchEvent(
      new CustomEvent<ChatFill>('fill', { detail: fill, bubbles: true, composed: true }),
    );
  };

  private handleReady = (api: ChatApi) => {
    this.api = api;
  };

  private renderWidget() {
    this.root?.render(
      <ChatApp
        authToken={this.getAttribute('auth-token') ?? ''}
        apiBase={this.getAttribute('api-base') ?? '/api'}
        document={this._document ?? undefined}
        profileId={this._profileId ?? undefined}
        jobContext={this._jobContext ?? undefined}
        onEdit={this.handleEdit}
        onFill={this.handleFill}
        onReady={this.handleReady}
      />
    );
  }
}

if (!customElements.get('ai-chat-widget')) {
  customElements.define('ai-chat-widget', ChatWidget);
}
