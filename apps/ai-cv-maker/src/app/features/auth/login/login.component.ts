import { Component, ElementRef, NgZone, OnInit, ViewChild, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../../core/auth.service';
import { environment } from '../../../../environments/environment';

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
  loading = false;
  error = '';
  hidePassword = true;

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
    this.loading = true;
    this.error = '';
    this.auth.login(this.form.value as { email: string; password: string }).subscribe({
      next: () => this.router.navigate(['/profile']),
      error: (err) => {
        this.error = err.status === 401 ? 'Invalid email or password.' : 'Login failed. Please try again.';
        this.loading = false;
      },
    });
  }

  private handleGoogleCredential(credential: string) {
    this.loading = true;
    this.error = '';
    this.auth.googleLogin(credential).subscribe({
      next: () => this.router.navigate(['/profile']),
      error: () => {
        this.error = 'Google sign-in failed. Please try again.';
        this.loading = false;
      },
    });
  }
}
