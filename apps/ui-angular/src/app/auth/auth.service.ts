import { HttpClient } from '@angular/common/http';
import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { from } from 'rxjs';
import { tap } from 'rxjs/operators';
import {
  AuthBroadcast,
  AuthRequest,
  clearSession,
  createAuthBroadcast,
  getToken,
  googleLoginApi,
  isTokenExpired,
  loginApi,
  registerApi,
  saveSession,
} from '@ai-cv-maker/auth';
import { environment } from '../../environments/environment';

const API = environment.apiUrl;

@Injectable({ providedIn: 'root' })
export class AuthService implements OnDestroy {
  private router = inject(Router);
  // HttpClient kept for any Angular-specific needs (interceptors, progress events)
  // Raw API calls go through the shared lib so both apps use identical logic
  private _http = inject(HttpClient);

  private broadcast: AuthBroadcast = createAuthBroadcast();
  private unsubLogout: () => void;

  readonly isLoggedIn = signal(!isTokenExpired(getToken()));
  readonly currentEmail = signal(
    typeof localStorage !== 'undefined'
      ? (localStorage.getItem('cv_email') ?? '')
      : ''
  );

  constructor() {
    // Sync logout across tabs (e.g. user logs out in the React app)
    this.unsubLogout = this.broadcast.onLogout(() => this._applyLogout(false));
  }

  ngOnDestroy() {
    this.unsubLogout();
    this.broadcast.destroy();
  }

  login(request: AuthRequest) {
    return from(loginApi(request, API)).pipe(
      tap((res) => this._storeSession(res.token, res.email))
    );
  }

  register(request: AuthRequest) {
    return from(registerApi(request, API)).pipe(
      tap((res) => this._storeSession(res.token, res.email))
    );
  }

  googleLogin(credential: string) {
    return from(googleLoginApi(credential, API)).pipe(
      tap((res) => this._storeSession(res.token, res.email))
    );
  }

  logout() {
    this.broadcast.notifyLogout(); // tell other tabs first
    this._applyLogout(true);
  }

  getToken(): string | null {
    return getToken();
  }

  private _storeSession(token: string, email: string) {
    saveSession(token, email);
    this.isLoggedIn.set(true);
    this.currentEmail.set(email);
  }

  private _applyLogout(navigate: boolean) {
    clearSession();
    this.isLoggedIn.set(false);
    this.currentEmail.set('');
    if (navigate) this.router.navigate(['/auth/login']);
  }
}
