import { useEffect, useState } from "react";
import { clearAuthMethod, clearToken, getToken } from "../popup/api";
import { DEFAULT_ROUTE, ROUTES, type Route } from "./routes";
import { LoginForm } from "./LoginForm";
import { ChatView } from "./views/ChatView";
import { SettingsView } from "./views/SettingsView";
import { HotkeysView } from "./views/HotkeysView";

export function Panel() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [route, setRoute] = useState<Route>(DEFAULT_ROUTE);

  useEffect(() => {
    getToken().then((t) => {
      setToken(t);
      setReady(true);
    });
  }, []);

  async function handleLogout() {
    await clearToken();
    await clearAuthMethod();
    setToken(null);
    setRoute(DEFAULT_ROUTE);
  }

  // A 401 anywhere in the panel sends the user back to login.
  function handleUnauthorized() {
    clearToken();
    setToken(null);
  }

  if (!ready) return null;

  if (!token) {
    return <LoginForm onAuthenticated={setToken} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header style={headerStyle}>
        <nav style={{ display: "flex", gap: 4 }}>
          {ROUTES.map((r) => (
            <button
              key={r.id}
              onClick={() => setRoute(r.id)}
              style={route === r.id ? tabActive : tab}
            >
              {r.label}
            </button>
          ))}
        </nav>
        <button onClick={handleLogout} style={ghostBtn}>Log out</button>
      </header>

      <main style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {route === "chat" && <ChatView token={token} onUnauthorized={handleUnauthorized} />}
        {route === "settings" && <SettingsView token={token} onUnauthorized={handleUnauthorized} />}
        {route === "hotkeys" && <HotkeysView />}
      </main>
    </div>
  );
}

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 12px",
  borderBottom: "1px solid #e5e7eb",
  background: "#fff",
};

const tab: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#6b7280",
  fontSize: 13,
  fontWeight: 500,
  padding: "4px 8px",
  borderRadius: 6,
  cursor: "pointer",
};

const tabActive: React.CSSProperties = {
  ...tab,
  color: "#111827",
  background: "#f3f4f6",
};

const ghostBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#6b7280",
  fontSize: 12,
  cursor: "pointer",
};
