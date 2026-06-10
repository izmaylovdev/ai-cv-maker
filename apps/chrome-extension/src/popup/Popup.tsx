import { useEffect, useRef, useState } from "react";
import {
  clearAuthMethod,
  clearToken,
  fetchProfiles,
  generateAndDownloadCv,
  generateCoverLetter,
  getSelectedProfile,
  getToken,
  login,
  loginWithGoogle,
  saveSelectedProfile,
  saveToken,
  type Profile,
} from "./api";

type Status =
  | { kind: "idle" }
  | { kind: "loading"; message: string }
  | { kind: "done"; profileName: string }
  | { kind: "error"; message: string };

type DownloadStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done" }
  | { kind: "error"; message: string };

export function Popup() {
  const [token, setToken] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [cvProfileId, setCvProfileId] = useState<string>("auto");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>({ kind: "idle" });
  const [jobContext, setJobContext] = useState<string | null>(null);
  const [fillShortcut, setFillShortcut] = useState<string>("Alt+Shift+F");
  const [downloadShortcut, setDownloadShortcut] = useState<string>("Alt+Shift+D");
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getToken().then((t) => {
      setToken(t);
      if (t) loadProfiles(t);
    });
    getSelectedProfile().then(setCvProfileId);
    chrome.commands.getAll((commands) => {
      const fill = commands.find((c) => c.name === "fill-fields");
      if (fill?.shortcut) setFillShortcut(fill.shortcut);
      const dl = commands.find((c) => c.name === "download-optimised-cv");
      if (dl?.shortcut) setDownloadShortcut(dl.shortcut);
    });
    // Probe job context on popup open so button enabled state is immediate
    chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
      if (!tab?.id) return;
      try {
        const ctx = await chrome.tabs.sendMessage(tab.id, { type: "GET_JOB_CONTEXT" });
        if (ctx?.jobDescription?.length >= 100) setJobContext(ctx.jobDescription);
      } catch { /* content script not ready — button stays disabled */ }
    });
  }, []);

  async function loadProfiles(t: string) {
    try {
      const list = await fetchProfiles(t);
      setProfiles(list);
      setProfilesError(null);
    } catch (e: unknown) {
      setProfilesError((e as Error).message ?? "Could not load profiles");
    }
  }

  async function handleLogin(email: string, password: string) {
    setStatus({ kind: "loading", message: "Logging in…" });
    try {
      const t = await login(email, password);
      await saveToken(t);
      setToken(t);
      loadProfiles(t);
      setStatus({ kind: "idle" });
    } catch (e: unknown) {
      setStatus({ kind: "error", message: (e as Error).message });
    }
  }

  async function handleGoogleLogin() {
    setStatus({ kind: "loading", message: "Opening Google sign-in…" });
    try {
      const t = await loginWithGoogle();
      await saveToken(t);
      setToken(t);
      loadProfiles(t);
      setStatus({ kind: "idle" });
    } catch (e: unknown) {
      const msg = (e as Error).message ?? "";
      if (/cancelled|user closed/i.test(msg)) {
        setStatus({ kind: "idle" });
      } else {
        setStatus({ kind: "error", message: msg || "Google sign-in failed." });
      }
    }
  }

  async function handleLogout() {
    await clearToken();
    await clearAuthMethod();
    setToken(null);
    setProfiles([]);
    setStatus({ kind: "idle" });
  }

  async function handleCvProfileChange(id: string) {
    setCvProfileId(id);
    await saveSelectedProfile(id);
  }

  async function handleDownload() {
    if (!token || !jobContext) return;
    setDownloadStatus({ kind: "loading" });
    try {
      await generateAndDownloadCv(token, jobContext, cvProfileId);
      setDownloadStatus({ kind: "done" });
      if (doneTimer.current) clearTimeout(doneTimer.current);
      doneTimer.current = setTimeout(() => setDownloadStatus({ kind: "idle" }), 3000);
    } catch (e: unknown) {
      const msg = (e as Error).message;
      if (msg === "UNAUTHORIZED") { await clearToken(); setToken(null); }
      setDownloadStatus({ kind: "error", message: msg === "UNAUTHORIZED" ? "Session expired. Please log in again." : msg });
    }
  }

  async function handleFill() {
    if (!token) return;
    setStatus({ kind: "loading", message: "Detecting fields…" });

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setStatus({ kind: "error", message: "No active tab found." });
      return;
    }

    // Ask content script for page context — try all frames so iframes are covered
    let pageContext: { jobTitle: string; jobDescription: string; fieldContext: string } | null = null;
    let targetFrameId = 0;
    try {
      const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
      const frameIds = frames?.map((f) => f.frameId) ?? [0];
      for (const frameId of frameIds) {
        try {
          const result = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_CONTEXT" }, { frameId });
          if (result) { pageContext = result; targetFrameId = frameId; break; }
        } catch { /* frame may not have content script */ }
      }
    } catch {
      // webNavigation not available — fall back to top frame only
      try {
        pageContext = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_CONTEXT" });
      } catch {
        setStatus({ kind: "error", message: "Could not reach page. Reload the tab and try again." });
        return;
      }
    }

    if (!pageContext) {
      setStatus({ kind: "error", message: "No application fields detected on this page." });
      return;
    }

    setStatus({ kind: "loading", message: "Generating cover letter…" });
    try {
      const result = await generateCoverLetter(
        token,
        pageContext.jobTitle,
        pageContext.jobDescription,
        pageContext.fieldContext,
        selectedProfileId || null
      );

      await chrome.tabs.sendMessage(
        tab.id,
        { type: "INSERT_TEXT", text: result.text, fieldIndex: 0 },
        { frameId: targetFrameId }
      );

      setStatus({ kind: "done", profileName: result.selectedProfileName });
    } catch (e: unknown) {
      const msg = (e as Error).message;
      if (msg === "UNAUTHORIZED") {
        await clearToken();
        setToken(null);
        setStatus({ kind: "error", message: "Session expired. Please log in again." });
      } else {
        setStatus({ kind: "error", message: msg });
      }
    }
  }

  if (!token) {
    return <LoginForm onLogin={handleLogin} onGoogleLogin={handleGoogleLogin} status={status} />;
  }

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong style={{ fontSize: 14 }}>AI CV Maker</strong>
        <button onClick={handleLogout} style={ghostBtn}>Log out</button>
      </header>

      {/* ── Download Optimised CV ───────────────────────── */}
      <section style={{ display: "flex", flexDirection: "column", gap: 8, borderBottom: "1px solid #e5e7eb", paddingBottom: 12 }}>
        <div>
          <label style={labelStyle}>Profile for CV download</label>
          {profilesError ? (
            <p style={{ fontSize: 12, color: "#dc2626", margin: "4px 0 0" }}>
              Could not load profiles: {profilesError}{" "}
              <button onClick={() => token && loadProfiles(token)} style={ghostBtn}>Retry</button>
            </p>
          ) : (
            <select
              value={cvProfileId}
              onChange={(e) => handleCvProfileChange(e.target.value)}
              style={selectStyle}
            >
              <option value="auto">Auto (LLM picks best match)</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name} — {p.title}</option>
              ))}
            </select>
          )}
        </div>

        <button
          onClick={handleDownload}
          disabled={downloadStatus.kind === "loading" || !jobContext}
          style={primaryBtn}
          title={!jobContext ? "No job description detected on this page" : undefined}
        >
          {downloadStatus.kind === "loading" ? "⟳ Generating CV…" :
           downloadStatus.kind === "done" ? "✓ Download complete" :
           "Download Optimised CV"}
        </button>

        {!jobContext && (
          <p style={{ fontSize: 11, color: "#9ca3af", margin: 0 }}>
            Could not detect a job description. Select the job text on the page and try again.
          </p>
        )}
        {downloadStatus.kind === "error" && (
          <p style={{ fontSize: 12, color: "#dc2626", margin: 0 }}>{downloadStatus.message}</p>
        )}

        <p style={hintStyle}>
          Shortcut: <kbd style={kbdStyle}>{downloadShortcut}</kbd>
        </p>
      </section>

      {/* ── Fill application fields ──────────────────────── */}
      {profiles.length > 1 && !profilesError && (
        <div>
          <label style={labelStyle}>Profile for field fill</label>
          <select
            value={selectedProfileId}
            onChange={(e) => setSelectedProfileId(e.target.value)}
            style={selectStyle}
          >
            <option value="">Auto-select best match</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name} — {p.title}</option>
            ))}
          </select>
        </div>
      )}

      <button
        onClick={handleFill}
        disabled={status.kind === "loading"}
        style={{ ...primaryBtn, background: "#4b5563" }}
      >
        {status.kind === "loading" ? status.message : "Fill this page"}
      </button>

      <p style={hintStyle}>
        Tip: press <kbd style={kbdStyle}>{fillShortcut}</kbd> on any page to fill without opening this popup.
        <a
          href="chrome://extensions/shortcuts"
          onClick={(e) => { e.preventDefault(); chrome.tabs.create({ url: "chrome://extensions/shortcuts" }); }}
          style={hintLinkStyle}
        >
          Change shortcut
        </a>
      </p>

      {status.kind === "done" && (
        <p style={{ fontSize: 12, color: "#16a34a" }}>
          ✓ Filled using profile: <strong>{status.profileName}</strong>
        </p>
      )}
      {status.kind === "error" && (
        <p style={{ fontSize: 12, color: "#dc2626" }}>{status.message}</p>
      )}
    </div>
  );
}

function LoginForm({
  onLogin,
  onGoogleLogin,
  status,
}: {
  onLogin: (email: string, password: string) => void;
  onGoogleLogin: () => void;
  status: Status;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const busy = status.kind === "loading";

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <strong style={{ fontSize: 14, marginBottom: 4 }}>Sign in to AI CV Maker</strong>

      <button
        type="button"
        onClick={onGoogleLogin}
        disabled={busy}
        style={googleBtn}
      >
        <GoogleIcon />
        {busy ? "Signing in…" : "Sign in with Google"}
      </button>

      <div style={dividerStyle}>
        <span style={dividerLineStyle} />
        <span style={{ fontSize: 11, color: "#9ca3af", padding: "0 8px" }}>or</span>
        <span style={dividerLineStyle} />
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); onLogin(email, password); }}
        style={{ display: "flex", flexDirection: "column", gap: 10 }}
      >
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

      {status.kind === "error" && (
        <p style={{ fontSize: 12, color: "#dc2626" }}>{status.message}</p>
      )}
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

const ghostBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#6b7280",
  fontSize: 12,
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  border: "1px solid #d1d5db",
  borderRadius: 6,
  padding: "7px 10px",
  fontSize: 13,
  width: "100%",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  marginTop: 4,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#6b7280",
  fontWeight: 500,
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

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#9ca3af",
  margin: 0,
  display: "flex",
  alignItems: "center",
  gap: 6,
  flexWrap: "wrap",
};

const kbdStyle: React.CSSProperties = {
  background: "#f3f4f6",
  border: "1px solid #d1d5db",
  borderRadius: 4,
  padding: "1px 5px",
  fontSize: 11,
  fontFamily: "monospace",
  color: "#374151",
};

const hintLinkStyle: React.CSSProperties = {
  color: "#6b7280",
  fontSize: 11,
  marginLeft: "auto",
  textDecoration: "underline",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const dividerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
};

const dividerLineStyle: React.CSSProperties = {
  flex: 1,
  height: 1,
  background: "#e5e7eb",
};
