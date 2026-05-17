import { Component, ElementRef, NgZone, OnInit, ViewChild, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../auth.service';
import { environment } from '../../../environments/environment';

declare const google: any;

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, RouterModule],
  templateUrl: './login.component.html',
})
export class LoginComponent implements OnInit {
  @ViewChild('googleBtn', { static: true }) googleBtnEl!: ElementRef;

  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);
  private ngZone = inject(NgZone);

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });
  readonly loading = signal(false);
  readonly error = signal('');
  readonly hidePassword = signal(true);

  toggleHidePassword() { this.hidePassword.update(v => !v); }

  ngOnInit() {
    if (typeof google !== 'undefined' && environment.googleClientId) {
      google.accounts.id.initialize({
        client_id: environment.googleClientId,
        callback: (response: { credential: string }) => {
          this.ngZone.run(() => this.handleGoogleCredential(response.credential));
        },
      });
      google.accounts.id.renderButton(this.googleBtnEl.nativeElement, {
        theme: 'outline',
        size: 'large',
        width: '100%',
        text: 'signin_with',
      });
    }
  }

  submit() {
    if (this.form.invalid) return;
    this.loading.set(true);
    this.error.set('');
    this.auth.login(this.form.value as { email: string; password: string }).subscribe({
      next: () => this.router.navigate(['/profile']),
      error: (err) => {
        this.error.set(err.status === 401 ? 'Invalid email or password.' : 'Login failed. Please try again.');
        this.loading.set(false);
      },
    });
  }

  private handleGoogleCredential(credential: string) {
    this.loading.set(true);
    this.error.set('');
    this.auth.googleLogin(credential).subscribe({
      next: () => this.router.navigate(['/profile']),
      error: () => {
        this.error.set('Google sign-in failed. Please try again.');
        this.loading.set(false);
      },
    });
  }
}
