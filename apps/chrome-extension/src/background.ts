import { clearAuthMethod, clearToken, generateCoverLetter, generateAndDownloadCv, getSelectedProfile, getToken } from "./popup/api";

// US-EXT-4 — clicking the toolbar icon opens the side panel (the popup is gone).
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

async function ensureContentScript(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" });
    return true;
  } catch {
    // Content script not present — try to inject it
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ["content.js"],
      });
      return true;
    } catch {
      // Restricted page (chrome://, PDF, etc.) — cannot inject
      return false;
    }
  }
}

async function sendToTab(
  tabId: number,
  message: object,
  options?: chrome.tabs.MessageSendOptions
): Promise<void> {
  try {
    await (options
      ? chrome.tabs.sendMessage(tabId, message, options)
      : chrome.tabs.sendMessage(tabId, message));
  } catch { /* tab may have navigated away */ }
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "download-optimised-cv") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    const token = await getToken();
    if (!token) { await chrome.sidePanel?.open({ tabId: tab.id }).catch(() => {}); return; }

    const ready = await ensureContentScript(tab.id);
    if (!ready) return;

    let jobContext: { jobTitle: string; jobDescription: string } | null = null;
    try {
      jobContext = await chrome.tabs.sendMessage(tab.id, { type: "GET_JOB_CONTEXT" });
    } catch { /* ignore */ }

    if (!jobContext || jobContext.jobDescription.length < 100) {
      await sendToTab(tab.id, {
        type: "SHOW_RESULT",
        text: "Could not detect a job description. Select the job text on the page and try again.",
        variant: "error",
      });
      return;
    }

    await sendToTab(tab.id, { type: "SHOW_LOADING", text: "Generating optimised CV…" });

    const profileId = await getSelectedProfile();
    const jobText = `${jobContext.jobTitle}\n${jobContext.jobDescription}`;

    try {
      await generateAndDownloadCv(token, jobText, profileId);
      await sendToTab(tab.id, { type: "SHOW_RESULT", text: "✓ CV downloaded.", variant: "success" });
    } catch (e: unknown) {
      const msg = (e as Error).message;
      if (msg === "UNAUTHORIZED") { await clearToken(); await clearAuthMethod(); }
      await sendToTab(tab.id, {
        type: "SHOW_RESULT",
        text: msg === "UNAUTHORIZED"
          ? "Session expired — click the extension icon to log in."
          : `CV generation failed: ${msg}`,
        variant: "error",
      });
    }
    return;
  }

  if (command !== "fill-fields") return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  const tabId = tab.id;
  const token = await getToken();
  if (!token) {
    await chrome.sidePanel?.open({ tabId }).catch(() => {});
    return;
  }

  const ready = await ensureContentScript(tabId);
  if (!ready) return;

  // Ask content script for page context across all frames
  let pageContext: { jobTitle: string; jobDescription: string; fieldContext: string } | null = null;
  let targetFrameId = 0;

  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    const frameIds = frames?.map((f) => f.frameId) ?? [0];
    for (const frameId of frameIds) {
      try {
        const result = await chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_CONTEXT" }, { frameId });
        if (result) { pageContext = result; targetFrameId = frameId; break; }
      } catch { /* frame may not have content script */ }
    }
  } catch {
    try {
      pageContext = await chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_CONTEXT" });
    } catch { /* ignore */ }
  }

  if (!pageContext) {
    await sendToTab(tabId, {
      type: "SHOW_RESULT",
      text: "No application fields detected on this page.",
      variant: "error",
    });
    return;
  }

  await sendToTab(tabId, { type: "SHOW_LOADING", text: "Generating cover letter…" });

  try {
    const result = await generateCoverLetter(
      token,
      pageContext.jobTitle,
      pageContext.jobDescription,
      pageContext.fieldContext,
      null
    );
    await sendToTab(tabId, { type: "INSERT_TEXT", text: result.text, fieldIndex: 0 }, { frameId: targetFrameId });
    await sendToTab(tabId, {
      type: "SHOW_RESULT",
      text: `✓ Filled using: ${result.selectedProfileName}`,
      variant: "success",
    });
  } catch (e: unknown) {
    const msg = (e as Error).message;
    if (msg === "UNAUTHORIZED") {
      await clearToken();
      await clearAuthMethod();
    }
    await sendToTab(tabId, {
      type: "SHOW_RESULT",
      text: msg === "UNAUTHORIZED"
        ? "Session expired — click the extension icon to log in."
        : `Error: ${msg}`,
      variant: "error",
    });
  }
});

// ── Side-panel relay (US-EXT-4) ────────────────────────────────────────────
// The side panel runs in the extension context and has no direct page access, so
// it asks the background to read job context from / write text into the active
// tab. Reuses the content script's GET_PAGE_CONTEXT / INSERT_TEXT handlers.

interface PanelPageContext {
  jobTitle: string;
  jobDescription: string;
  fieldContext: string;
  tabId: number;
  frameId: number;
}

async function getPageContextAcrossFrames(tabId: number): Promise<PanelPageContext | null> {
  let frameIds: number[] = [0];
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    if (frames?.length) frameIds = frames.map((f) => f.frameId);
  } catch { /* webNavigation unavailable — top frame only */ }

  for (const frameId of frameIds) {
    try {
      const result = await chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_CONTEXT" }, { frameId });
      if (result) {
        return { ...result, tabId, frameId };
      }
    } catch { /* frame may not have the content script */ }
  }
  return null;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "PANEL_GET_PAGE_CONTEXT") {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) { sendResponse(null); return; }
      const ready = await ensureContentScript(tab.id);
      if (!ready) { sendResponse(null); return; }
      sendResponse(await getPageContextAcrossFrames(tab.id));
    })();
    return true; // async response
  }

  if (message?.type === "PANEL_INSERT_TEXT") {
    (async () => {
      const { text, tabId, frameId } = message;
      if (typeof tabId !== "number") { sendResponse({ ok: false }); return; }
      const insert = { type: "INSERT_TEXT", text, fieldIndex: 0 };
      try {
        await (typeof frameId === "number"
          ? chrome.tabs.sendMessage(tabId, insert, { frameId })
          : chrome.tabs.sendMessage(tabId, insert));
        sendResponse({ ok: true });
      } catch {
        sendResponse({ ok: false });
      }
    })();
    return true; // async response
  }

  return undefined;
});
