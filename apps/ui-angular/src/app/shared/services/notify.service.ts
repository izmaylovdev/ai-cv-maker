import { Injectable, signal } from '@angular/core';

export interface Notification {
  message: string;
  type: 'success' | 'error';
}

@Injectable({ providedIn: 'root' })
export class NotifyService {
  readonly current = signal<Notification | null>(null);

  private timer: ReturnType<typeof setTimeout> | null = null;

  success(message: string): void {
    this.show(message, 'success');
  }

  error(message: string): void {
    this.show(message, 'error');
  }

  dismiss(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.current.set(null);
  }

  private show(message: string, type: 'success' | 'error'): void {
    if (this.timer) clearTimeout(this.timer);
    this.current.set({ message, type });
    this.timer = setTimeout(() => this.current.set(null), 4000);
  }
}
