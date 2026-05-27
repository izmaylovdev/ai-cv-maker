export const BAR_STYLES = `
#__dev-shell__ {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 40px;
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  background: #1a1a1a;
  color: #e0e0e0;
  font-family: ui-monospace, monospace;
  font-size: 11px;
  box-sizing: border-box;
  border-bottom: 1px solid #333;
}
#__dev-shell__ .dev-shell-title {
  font-weight: 600;
  opacity: 0.6;
  margin-right: auto;
}
#__dev-shell__ .dev-shell-auth {
  display: flex;
  align-items: center;
  gap: 6px;
}
#__dev-shell__ input {
  height: 24px;
  padding: 0 6px;
  border: 1px solid #444;
  border-radius: 3px;
  background: #2a2a2a;
  color: #e0e0e0;
  font-size: 11px;
  font-family: inherit;
  width: 120px;
}
#__dev-shell__ button {
  height: 24px;
  padding: 0 10px;
  border: 1px solid #444;
  border-radius: 3px;
  background: #2a2a2a;
  color: #e0e0e0;
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
}
#__dev-shell__ button:hover { background: #3a3a3a; }
#__dev-shell__ [data-testid="theme-toggle"] { padding: 0 8px; font-size: 14px; }
#__dev-shell__ [data-testid="google-signin"] { color: #8ab4f8; border-color: #8ab4f8; }
#__dev-shell__ [data-testid="user-email"] { opacity: 0.8; }
`;
