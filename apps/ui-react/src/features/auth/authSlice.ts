import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import {
  AuthRequest,
  AuthResponse,
  clearSession,
  getSession,
  googleLoginApi,
  loginApi,
  registerApi,
  saveSession,
} from '@ai-cv-maker/auth';
import { environment } from '../../environments/environment';

const API = environment.apiUrl;

export type AuthState = {
  token: string | null;
  email: string;
};

const initialState: AuthState = getSession();

export const login = createAsyncThunk<AuthResponse, AuthRequest, { rejectValue: number }>(
  'auth/login',
  async (body, { rejectWithValue }) => {
    try {
      return await loginApi(body, API);
    } catch (e) {
      return rejectWithValue((e as Error & { status?: number }).status ?? 0);
    }
  }
);

export const register = createAsyncThunk<AuthResponse, AuthRequest, { rejectValue: number }>(
  'auth/register',
  async (body, { rejectWithValue }) => {
    try {
      return await registerApi(body, API);
    } catch (e) {
      return rejectWithValue((e as Error & { status?: number }).status ?? 0);
    }
  }
);

export const googleLogin = createAsyncThunk<AuthResponse, string, { rejectValue: void }>(
  'auth/google',
  async (credential, { rejectWithValue }) => {
    try {
      return await googleLoginApi(credential, API);
    } catch {
      return rejectWithValue(undefined);
    }
  }
);

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    logout(state) {
      state.token = null;
      state.email = '';
      clearSession();
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(login.fulfilled, (state, { payload }) => {
        state.token = payload.token;
        state.email = payload.email;
        saveSession(payload.token, payload.email);
      })
      .addCase(register.fulfilled, (state, { payload }) => {
        state.token = payload.token;
        state.email = payload.email;
        saveSession(payload.token, payload.email);
      })
      .addCase(googleLogin.fulfilled, (state, { payload }) => {
        state.token = payload.token;
        state.email = payload.email;
        saveSession(payload.token, payload.email);
      });
  },
});

export const { logout } = authSlice.actions;
export default authSlice.reducer;
