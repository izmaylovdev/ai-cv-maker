import { Injectable, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { environment } from '../../environments/environment';

// Lazily loads the <applysy-profile-builder> web component bundle, mirroring
// ChatLoaderService. The bundle is served by the profile-builder-ui dev server
// in development and from a static path in production (see builderWidgetUrl).
@Injectable({ providedIn: 'root' })
export class BuilderLoaderService {
  private doc = inject(DOCUMENT);
  private loaded: Promise<void> | null = null;

  load(): Promise<void> {
    if (this.loaded) return this.loaded;

    this.loaded = new Promise<void>((resolve, reject) => {
      if (customElements.get('applysy-profile-builder')) {
        resolve();
        return;
      }
      const script = this.doc.createElement('script');
      script.src = environment.builderWidgetUrl;
      script.onload = () =>
        customElements.whenDefined('applysy-profile-builder').then(() => resolve());
      script.onerror = () => reject(new Error('Failed to load profile builder widget'));
      this.doc.head.appendChild(script);
    });

    return this.loaded;
  }
}
