import { Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { AuthService } from './auth/auth.service';
import { ThemeService } from './core/theme.service';
import { NotificationToastComponent } from './shared/components/notification-toast/notification-toast.component';

@Component({
  imports: [RouterModule, NotificationToastComponent],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App {
  protected auth = inject(AuthService);
  protected theme = inject(ThemeService);
}
