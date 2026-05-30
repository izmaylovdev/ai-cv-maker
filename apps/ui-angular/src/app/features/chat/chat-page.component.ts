import { Component, OnInit, inject, signal, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { ChatLoaderService } from '../../core/chat-loader.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-chat-page',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="flex flex-col h-[calc(100vh-3.5rem)] md:h-screen -mx-4 md:-mx-8">
      <div class="px-4 md:px-8 py-4 border-b border-gray-200 dark:border-zinc-700 shrink-0">
        <h1 class="text-lg font-bold text-gray-900 dark:text-white">AI Career Assistant</h1>
        <p class="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
          Ask about your profiles, career strategy, or how to improve your CV
        </p>
      </div>

      <div class="flex-1 min-h-0">
        @if (widgetReady()) {
          <ai-chat-widget
            [attr.auth-token]="authToken"
            [attr.api-base]="apiBase"
            style="display:block;height:100%">
          </ai-chat-widget>
        } @else if (loadError()) {
          <div class="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
            <p class="text-sm text-red-600 dark:text-red-400">
              Could not load the chat widget. Make sure the chat-ui dev server is running on port 4202.
            </p>
            <code class="text-xs bg-gray-100 dark:bg-zinc-800 px-3 py-1.5 rounded">npm run serve:chat</code>
          </div>
        } @else {
          <div class="flex items-center justify-center h-full">
            <span class="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></span>
          </div>
        }
      </div>
    </div>
  `,
})
export class ChatPageComponent implements OnInit {
  private auth = inject(AuthService);
  private chatLoader = inject(ChatLoaderService);

  readonly widgetReady = signal(false);
  readonly loadError = signal(false);
  readonly apiBase = environment.apiUrl.replace(/\/api$/, '') + '/api';

  get authToken(): string {
    return this.auth.getToken() ?? '';
  }

  ngOnInit() {
    this.chatLoader.load()
      .then(() => this.widgetReady.set(true))
      .catch(() => this.loadError.set(true));
  }
}
