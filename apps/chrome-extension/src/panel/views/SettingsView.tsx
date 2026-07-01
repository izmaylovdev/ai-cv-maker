import { useEffect, useState } from "react";
import { fetchProfiles, getSelectedProfile, saveSelectedProfile, type Profile } from "../../popup/api";

// US-EXT-4 — the optimised-CV profile picker, relocated here from the removed
// popup. The value is read by the Alt+Shift+D download hotkey flow via storage.
export function SettingsView({
  token,
  onUnauthorized,
}: {
  token: string;
  onUnauthorized: () => void;
}) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>("auto");

  useEffect(() => {
    getSelectedProfile().then(setSelected);
    fetchProfiles(token)
      .then((list) => { setProfiles(list); setError(null); })
      .catch((e: unknown) => {
        const msg = (e as Error).message;
        if (msg === "UNAUTHORIZED") onUnauthorized();
        else setError(msg ?? "Could not load profiles");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleChange(id: string) {
    setSelected(id);
    await saveSelectedProfile(id);
  }

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={labelStyle}>Profile for CV download</label>
        {error ? (
          <p style={{ fontSize: 12, color: "#dc2626", margin: 0 }}>Could not load profiles: {error}</p>
        ) : (
          <select value={selected} onChange={(e) => handleChange(e.target.value)} style={selectStyle}>
            <option value="auto">Auto (LLM picks best match)</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name} — {p.title}</option>
            ))}
          </select>
        )}
        <p style={hintStyle}>
          Used by the “Download Optimised CV” shortcut (Alt+Shift+D) on a job posting.
        </p>
      </section>
    </div>
  );
}

const labelStyle: React.CSSProperties = { fontSize: 12, color: "#6b7280", fontWeight: 500 };
const selectStyle: React.CSSProperties = {
  border: "1px solid #d1d5db",
  borderRadius: 6,
  padding: "7px 10px",
  fontSize: 13,
  width: "100%",
};
const hintStyle: React.CSSProperties = { fontSize: 11, color: "#9ca3af", margin: 0 };
