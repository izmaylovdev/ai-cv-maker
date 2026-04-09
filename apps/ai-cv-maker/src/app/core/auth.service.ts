import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { tap } from 'rxjs';
import { AuthRequest, AuthResponse } from '../shared/models/auth.model';

const TOKEN_KEY = 'cv_token';
const EMAIL_KEY = 'cv_email';
const API = 'http://localhost:5050/api/auth';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  readonly isLoggedIn = signal(!!localStorage.getItem(TOKEN_KEY));
  readonly currentEmail = signal(localStorage.getItem(EMAIL_KEY) ?? '');

  register(request: AuthRequest) {
    return this.http.post<AuthResponse>(`${API}/register`, request).pipe(
      tap((res) => this.storeSession(res))
    );
  }

  login(request: AuthRequest) {
    return this.http.post<AuthResponse>(`${API}/login`, request).pipe(
      tap((res) => this.storeSession(res))
    );
  }

  googleLogin(credential: string) {
    return this.http.post<AuthResponse>(`${API}/google`, { credential }).pipe(
      tap((res) => this.storeSession(res))
    );
  }

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EMAIL_KEY);
    this.isLoggedIn.set(false);
    this.currentEmail.set('');
    this.router.navigate(['/auth/login']);
  }

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  private storeSession(res: AuthResponse) {
    localStorage.setItem(TOKEN_KEY, res.token);
    localStorage.setItem(EMAIL_KEY, res.email);
    this.isLoggedIn.set(true);
    this.currentEmail.set(res.email);
  }
}
