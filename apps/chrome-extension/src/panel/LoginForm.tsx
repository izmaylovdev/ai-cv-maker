import { useState } from "react";
import { login, loginWithGoogle, saveToken } from "../popup/api";

// US-EXT-4 — login moved out of the (removed) popup into the side panel. Reuses
// the same api.ts auth helpers; on success it hands the token to the panel.
export function LoginForm({ onAuthenticated }: { onAuthenticated: (token: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const token = await login(email, password);
      await saveToken(token);
      onAuthenticated(token);
    } catch (err: unknown) {
      setError((err as Error).message ?? "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogleLogin() {
    setBusy(true);
    setError(null);
    try {
      const token = await loginWithGoogle();
      await saveToken(token);
      onAuthenticated(token);
    } catch (err: unknown) {
      const msg = (err as Error).message ?? "";
      // User-cancelled Google flow is silent.
      if (!/cancelled|user closed/i.test(msg)) {
        setError(msg || "Google sign-in failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <strong style={{ fontSize: 14, marginBottom: 4 }}>Sign in to Applysy</strong>

      <button type="button" onClick={handleGoogleLogin} disabled={busy} style={googleBtn}>
        <GoogleIcon />
        {busy ? "Signing in…" : "Sign in with Google"}
      </button>

      <div style={{ display: "flex", alignItems: "center" }}>
        <span style={dividerLine} />
        <span style={{ fontSize: 11, color: "#9ca3af", padding: "0 8px" }}>or</span>
        <span style={dividerLine} />
      </div>

      <form onSubmit={handlePasswordLogin} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={inputStyle}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={inputStyle}
        />
        <button type="submit" disabled={busy} style={primaryBtn}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {error && <p style={{ fontSize: 12, color: "#dc2626" }}>{error}</p>}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" style={{ marginRight: 8, flexShrink: 0 }}>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

const primaryBtn: React.CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "8px 12px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  border: "1px solid #d1d5db",
  borderRadius: 6,
  padding: "7px 10px",
  fontSize: 13,
  width: "100%",
};

const googleBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#fff",
  color: "#374151",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  padding: "8px 12px",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

const dividerLine: React.CSSProperties = { flex: 1, height: 1, background: "#e5e7eb" };
