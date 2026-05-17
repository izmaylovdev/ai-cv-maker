import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

import { environment } from '../../environments/environment';
import type { AuthRequest, AuthResponse } from '../../shared/models/auth.model';

const TOKEN_KEY = 'cv_token';
const EMAIL_KEY = 'cv_email';

const AUTH_BASE = `${environment.apiUrl}/auth`;

export type AuthState = {
  token: string | null;
  email: string;
};

function readStorage(): AuthState {
  return {
    token: localStorage.getItem(TOKEN_KEY),
    email: localStorage.getItem(EMAIL_KEY) ?? '',
  };
}

function persistSession(token: string, email: string) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(EMAIL_KEY, email);
}

const initialState: AuthState = readStorage();

export const login = createAsyncThunk<
  AuthResponse,
  AuthRequest,
  { rejectValue: number }
>('auth/login', async (body, { rejectWithValue }) => {
  const res = await fetch(`${AUTH_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) return rejectWithValue(res.status);
  return res.json() as Promise<AuthResponse>;
});

export const register = createAsyncThunk<
  AuthResponse,
  AuthRequest,
  { rejectValue: number }
>('auth/register', async (body, { rejectWithValue }) => {
  const res = await fetch(`${AUTH_BASE}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) return rejectWithValue(res.status);
  return res.json() as Promise<AuthResponse>;
});

export const googleLogin = createAsyncThunk<
  AuthResponse,
  string,
  { rejectValue: void }
>('auth/google', async (credential, { rejectWithValue }) => {
  const res = await fetch(`${AUTH_BASE}/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  });
  if (!res.ok) return rejectWithValue(undefined);
  return res.json() as Promise<AuthResponse>;
});

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    logout(state) {
      state.token = null;
      state.email = '';
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(EMAIL_KEY);
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(login.fulfilled, (state, action) => {
        state.token = action.payload.token;
        state.email = action.payload.email;
        persistSession(action.payload.token, action.payload.email);
      })
      .addCase(register.fulfilled, (state, action) => {
        state.token = action.payload.token;
        state.email = action.payload.email;
        persistSession(action.payload.token, action.payload.email);
      })
      .addCase(googleLogin.fulfilled, (state, action) => {
        state.token = action.payload.token;
        state.email = action.payload.email;
        persistSession(action.payload.token, action.payload.email);
      });
  },
});

export const { logout } = authSlice.actions;
export default authSlice.reducer;
