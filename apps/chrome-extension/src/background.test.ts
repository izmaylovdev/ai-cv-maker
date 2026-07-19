import { describe, it, expect, beforeEach, vi } from "vitest";

// US-EXT-7 — the side panel is tab-scoped: no window-global panel behaviour,
// per-tab enable (setOptions) + open on toolbar click and on signed-out hotkeys.

// background.ts imports ./popup/api at module level (chrome.storage / fetch),
// so mock it entirely. vi.hoisted keeps the spies stable across vi.resetModules().
const api = vi.hoisted(() => ({
  getToken: vi.fn<() => Promise<string | null>>(),
  clearToken: vi.fn(async () => {}),
  clearAuthMethod: vi.fn(async () => {}),
  getSelectedProfile: vi.fn(async () => ""),
  generateCoverLetter: vi.fn(),
  generateAndDownloadCv: vi.fn(),
}));
vi.mock("./popup/api", () => api);

type Listener = (...args: unknown[]) => unknown;

interface ChromeMock {
  runtime: {
    onInstalled: { addListener: ReturnType<typeof vi.fn> };
    onMessage: { addListener: ReturnType<typeof vi.fn> };
  };
  action: { onClicked: { addListener: ReturnType<typeof vi.fn> } };
  commands: { onCommand: { addListener: ReturnType<typeof vi.fn> } };
  sidePanel: {
    setPanelBehavior: ReturnType<typeof vi.fn>;
    setOptions: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
  };
  tabs: {
    query: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
  };
  scripting: { executeScript: ReturnType<typeof vi.fn> };
  webNavigation: { getAllFrames: ReturnType<typeof vi.fn> };
}

function makeChromeMock(): ChromeMock {
  return {
    runtime: {
      onInstalled: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn() },
    },
    action: { onClicked: { addListener: vi.fn() } },
    commands: { onCommand: { addListener: vi.fn() } },
    sidePanel: {
      setPanelBehavior: vi.fn(() => Promise.resolve()),
      setOptions: vi.fn(() => Promise.resolve()),
      open: vi.fn(() => Promise.resolve()),
    },
    tabs: {
      query: vi.fn(async () => [{ id: 7 }]),
      sendMessage: vi.fn(async () => null),
    },
    scripting: { executeScript: vi.fn(async () => []) },
    webNavigation: { getAllFrames: vi.fn(async () => [{ frameId: 0 }]) },
  };
}

/** Stub the chrome global, (re)import background.ts, return the mock + captured listeners. */
async function loadBackground() {
  vi.resetModules();
  const chromeMock = makeChromeMock();
  vi.stubGlobal("chrome", chromeMock);
  await import("./background");

  const listenerOf = (spy: ReturnType<typeof vi.fn>): Listener | undefined =>
    spy.mock.calls[0]?.[0] as Listener | undefined;

  return {
    chromeMock,
    onInstalled: listenerOf(chromeMock.runtime.onInstalled.addListener),
    onActionClicked: listenerOf(chromeMock.action.onClicked.addListener),
    onCommand: listenerOf(chromeMock.commands.onCommand.addListener),
  };
}

beforeEach(() => {
  api.getToken.mockReset();
  api.getToken.mockResolvedValue(null);
});

describe("US-EXT-7 — background: no window-global side panel behaviour", () => {
  it("registers an action.onClicked listener and never calls sidePanel.setPanelBehavior", async () => {
    const { chromeMock, onInstalled } = await loadBackground();

    // A toolbar-click listener must exist (F-EXT-7.2)…
    expect(chromeMock.action.onClicked.addListener).toHaveBeenCalledTimes(1);

    // …and setPanelBehavior must never run: not at module load (F-EXT-7.1)…
    expect(chromeMock.sidePanel.setPanelBehavior).not.toHaveBeenCalled();

    // …nor from the onInstalled handler, if one is still registered.
    if (onInstalled) {
      await onInstalled();
    }
    expect(chromeMock.sidePanel.setPanelBehavior).not.toHaveBeenCalled();
  });
});

describe("US-EXT-7 — toolbar click opens the panel on the clicked tab only", () => {
  it("action.onClicked enables the panel for that tab (setOptions) then opens it", async () => {
    const { chromeMock, onActionClicked } = await loadBackground();

    expect(onActionClicked).toBeDefined();
    await onActionClicked!({ id: 42 });
    // openPanelForTab is fire-and-forget (void) — let its promise chain settle
    await new Promise((r) => setTimeout(r, 0));

    expect(chromeMock.sidePanel.setOptions).toHaveBeenCalledWith({
      tabId: 42,
      path: "panel/index.html",
      enabled: true,
    });
    expect(chromeMock.sidePanel.open).toHaveBeenCalledWith({ tabId: 42 });

    // Enable-then-open: setOptions must run before open.
    const setOptionsOrder = chromeMock.sidePanel.setOptions.mock.invocationCallOrder[0];
    const openOrder = chromeMock.sidePanel.open.mock.invocationCallOrder[0];
    expect(setOptionsOrder).toBeLessThan(openOrder);
  });
});

describe("US-EXT-7 — signed-out hotkeys open the panel on the current tab", () => {
  it.each(["fill-fields", "download-optimised-cv"] as const)(
    "%s with no token enables then opens the panel on the active tab and injects nothing",
    async (command) => {
      api.getToken.mockResolvedValue(null);
      const { chromeMock, onCommand } = await loadBackground();

      expect(onCommand).toBeDefined();
      await onCommand!(command);
      await new Promise((r) => setTimeout(r, 0));

      expect(chromeMock.sidePanel.setOptions).toHaveBeenCalledWith({
        tabId: 7,
        path: "panel/index.html",
        enabled: true,
      });
      expect(chromeMock.sidePanel.open).toHaveBeenCalledWith({ tabId: 7 });

      const setOptionsOrder = chromeMock.sidePanel.setOptions.mock.invocationCallOrder[0];
      const openOrder = chromeMock.sidePanel.open.mock.invocationCallOrder[0];
      expect(setOptionsOrder).toBeLessThan(openOrder);

      // Signed-out fallback must not inject the content script.
      expect(chromeMock.scripting.executeScript).not.toHaveBeenCalled();
    }
  );
});
