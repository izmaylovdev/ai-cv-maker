import { useEffect, useRef, useState } from "react";
import { getApiBase } from "../../popup/api";

// Shape of the <ai-chat-widget> custom element we drive imperatively (US-EXT-4).
interface ChatWidgetEl extends HTMLElement {
  jobContext: { jobTitle: string; jobDescription: string; fieldContext: string } | null;
  addAssistantNote?: (text: string) => void;
}

interface PageContext {
  jobTitle: string;
  jobDescription: string;
  fieldContext: string;
  tabId: number;
  frameId: number;
}

async function fetchPageContext(): Promise<PageContext | null> {
  try {
    return await chrome.runtime.sendMessage({ type: "PANEL_GET_PAGE_CONTEXT" });
  } catch {
    return null;
  }
}

export function ChatView({
  token,
  onUnauthorized: _onUnauthorized,
}: {
  token: string;
  onUnauthorized: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<ChatWidgetEl | null>(null);
  const pageCtxRef = useRef<PageContext | null>(null);
  const [apiBase, setApiBase] = useState<string | null>(null);

  useEffect(() => {
    getApiBase().then((base) => setApiBase(`${base.replace(/\/$/, "")}/api`));
  }, []);

  // Create the widget element once the custom element is defined and we know the
  // api base, then keep its job context in sync with the active tab.
  useEffect(() => {
    if (!apiBase || !hostRef.current) return;
    let disposed = false;

    customElements.whenDefined("ai-chat-widget").then(() => {
      if (disposed || !hostRef.current) return;

      const widget = document.createElement("ai-chat-widget") as ChatWidgetEl;
      widget.setAttribute("auth-token", token);
      widget.setAttribute("api-base", apiBase);
      widget.style.display = "block";
      widget.style.height = "100%";

      widget.addEventListener("fill", handleFill as EventListener);

      hostRef.current.appendChild(widget);
      widgetRef.current = widget;

      refreshContext();
    });

    const onActivated = () => refreshContext();
    const onUpdated = (_id: number, info: chrome.tabs.TabChangeInfo) => {
      if (info.status === "complete") refreshContext();
    };
    chrome.tabs?.onActivated.addListener(onActivated);
    chrome.tabs?.onUpdated.addListener(onUpdated);

    return () => {
      disposed = true;
      chrome.tabs?.onActivated.removeListener(onActivated);
      chrome.tabs?.onUpdated.removeListener(onUpdated);
      widgetRef.current?.removeEventListener("fill", handleFill as EventListener);
      widgetRef.current?.remove();
      widgetRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, token]);

  async function refreshContext() {
    const ctx = await fetchPageContext();
    pageCtxRef.current = ctx;
    if (widgetRef.current) {
      widgetRef.current.jobContext = ctx
        ? { jobTitle: ctx.jobTitle, jobDescription: ctx.jobDescription, fieldContext: ctx.fieldContext }
        : null;
    }
  }

  // User accepted a cover-letter draft ("Use this") → write it into the page.
  async function handleFill(e: Event) {
    const detail = (e as CustomEvent<{ text: string }>).detail;
    const ctx = pageCtxRef.current;
    const note = (text: string) => widgetRef.current?.addAssistantNote?.(text);

    if (!ctx) {
      note("Couldn't find a field to fill on this page.");
      return;
    }
    try {
      const res = await chrome.runtime.sendMessage({
        type: "PANEL_INSERT_TEXT",
        text: detail.text,
        tabId: ctx.tabId,
        frameId: ctx.frameId,
      });
      note(res?.ok ? "Filled the cover letter field." : "Couldn't find a field to fill on this page.");
    } catch {
      note("Couldn't find a field to fill on this page.");
    }
  }

  return <div ref={hostRef} style={{ flex: 1, minHeight: 0, height: "100%" }} />;
}
