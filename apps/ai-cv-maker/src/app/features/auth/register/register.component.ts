import { Component, ElementRef, NgZone, OnInit, ViewChild, inject } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../../core/auth.service';
import { environment } from '../../../../environments/environment';

declare const google: any;

function passwordsMatch(control: AbstractControl): ValidationErrors | null {
  const password = control.get('password')?.value;
  const confirm = control.get('confirmPassword')?.value;
  return password === confirm ? null : { passwordsMismatch: true };
}

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [ReactiveFormsModule, RouterModule],
  templateUrl: './register.component.html',
})
export class RegisterComponent implements OnInit {
  @ViewChild('googleBtn', { static: true }) googleBtnEl!: ElementRef;

  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);
  private ngZone = inject(NgZone);

  form = this.fb.group(
    {
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', Validators.required],
    },
    { validators: passwordsMatch }
  );
  loading = false;
  error = '';
  hidePassword = true;
  hideConfirm = true;

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
        text: 'signup_with',
      });
    }
  }

  submit() {
    if (this.form.invalid) return;
    this.loading = true;
    this.error = '';
    const { email, password } = this.form.value as { email: string; password: string };
    this.auth.register({ email, password }).subscribe({
      next: () => this.router.navigate(['/profile']),
      error: (err) => {
        this.error = err.status === 409 ? 'An account with this email already exists.' : 'Registration failed. Please try again.';
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
