import { useEffect, useState } from "react";

// US-EXT-4 — placeholder Hotkeys view. Lists the current shortcuts and links to
// Chrome's shortcut settings; in-app rebinding is a future iteration.
export function HotkeysView() {
  const [fill, setFill] = useState("Alt+Shift+F");
  const [download, setDownload] = useState("Alt+Shift+D");

  useEffect(() => {
    chrome.commands?.getAll((commands) => {
      const f = commands.find((c) => c.name === "fill-fields");
      if (f?.shortcut) setFill(f.shortcut);
      const d = commands.find((c) => c.name === "download-optimised-cv");
      if (d?.shortcut) setDownload(d.shortcut);
    });
  }, []);

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={row}>
        <span>Fill application fields</span>
        <kbd style={kbd}>{fill}</kbd>
      </div>
      <div style={row}>
        <span>Download optimised CV</span>
        <kbd style={kbd}>{download}</kbd>
      </div>
      <a
        href="chrome://extensions/shortcuts"
        onClick={(e) => { e.preventDefault(); chrome.tabs.create({ url: "chrome://extensions/shortcuts" }); }}
        style={linkStyle}
      >
        Change shortcuts in Chrome settings
      </a>
    </div>
  );
}

const row: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  fontSize: 13,
  color: "#374151",
};

const kbd: React.CSSProperties = {
  background: "#f3f4f6",
  border: "1px solid #d1d5db",
  borderRadius: 4,
  padding: "1px 6px",
  fontSize: 11,
  fontFamily: "monospace",
  color: "#374151",
};

const linkStyle: React.CSSProperties = {
  color: "#2563eb",
  fontSize: 12,
  textDecoration: "underline",
  cursor: "pointer",
};
