import { Component, inject, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AuthService } from './auth/auth.service';
import { ThemeService } from './core/theme.service';
import { NotificationToastComponent } from './shared/components/notification-toast/notification-toast.component';

@Component({
  imports: [RouterModule, NgClass, NotificationToastComponent],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App {
  protected auth = inject(AuthService);
  protected theme = inject(ThemeService);
  protected sidebarOpen = signal(false);

  protected toggleSidebar() {
    this.sidebarOpen.update(v => !v);
  }

  protected closeSidebar() {
    this.sidebarOpen.set(false);
  }
}
