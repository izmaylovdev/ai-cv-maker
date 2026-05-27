import ReactDOM from 'react-dom/client';
import { ChatApp } from './ChatApp';

class ChatWidget extends HTMLElement {
  private root?: ReturnType<typeof ReactDOM.createRoot>;

  static get observedAttributes() {
    return ['auth-token', 'api-base'];
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

  private renderWidget() {
    this.root?.render(
      <ChatApp
        authToken={this.getAttribute('auth-token') ?? ''}
        apiBase={this.getAttribute('api-base') ?? '/api'}
      />
    );
  }
}

if (!customElements.get('ai-chat-widget')) {
  customElements.define('ai-chat-widget', ChatWidget);
}
