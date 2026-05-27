import { Injectable, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ChatLoaderService {
  private doc = inject(DOCUMENT);
  private loaded: Promise<void> | null = null;

  load(): Promise<void> {
    if (this.loaded) return this.loaded;

    this.loaded = new Promise<void>((resolve, reject) => {
      if (customElements.get('ai-chat-widget')) {
        resolve();
        return;
      }
      const script = this.doc.createElement('script');
      script.src = environment.chatWidgetUrl;
      script.onload = () => customElements.whenDefined('ai-chat-widget').then(() => resolve());
      script.onerror = () => reject(new Error('Failed to load chat widget'));
      this.doc.head.appendChild(script);
    });

    return this.loaded;
  }
}
