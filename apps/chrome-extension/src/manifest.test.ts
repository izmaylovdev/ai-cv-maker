// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// US-EXT-7 — the manifest no longer declares a window-global side panel or a
// declarative content script; the extension activates per tab, on demand.
// Read (not import) so we test the shipped manifest.json verbatim.
const manifestPath = fileURLToPath(new URL("../manifest.json", import.meta.url));
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;

describe("US-EXT-7 — manifest.json is tab-scoped", () => {
  it("has no declarative content_scripts block (injection is on-demand only)", () => {
    // F-EXT-7.4 — content.js reaches a page only via chrome.scripting.executeScript
    expect(manifest).not.toHaveProperty("content_scripts");
  });

  it("has no side_panel key (no window-global default panel)", () => {
    // F-EXT-7.1 — the panel is enabled per tab via sidePanel.setOptions
    expect(manifest).not.toHaveProperty("side_panel");
  });

  it("keeps permissions, host_permissions and both commands unchanged", () => {
    // F-EXT-7.6 — permissions are unchanged
    const permissions = manifest.permissions as string[];
    expect(permissions).toContain("sidePanel");
    expect(permissions).toContain("activeTab");
    expect(permissions).toContain("scripting");

    expect(manifest.host_permissions).toEqual(["<all_urls>"]);

    const commands = manifest.commands as Record<string, unknown>;
    expect(commands).toHaveProperty("fill-fields");
    expect(commands).toHaveProperty("download-optimised-cv");
  });
});
