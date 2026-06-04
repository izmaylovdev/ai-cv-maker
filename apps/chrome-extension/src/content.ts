const COVER_KEYWORDS = [
  // English
  "cover", "letter", "motivation", "why", "introduce",
  "tell us", "about yourself", "additional", "message", "comment", "descr",
  // Ukrainian
  "супровідний", "мотивацій", "розкажіть", "про себе", "чому", "лист",
  "повідомлення", "коментар", "додатков",
  // Russian
  "сопроводительн", "мотивацион", "расскажите", "о себе", "почему",
  "письмо", "сообщение", "комментарий",
];

function getAssociatedLabel(el: Element): string {
  const id = el.getAttribute("id");
  if (id) {
    const label = document.querySelector(`label[for="${id}"]`);
    if (label) return label.textContent ?? "";
  }
  const closestLabel = el.closest("label");
  if (closestLabel) return closestLabel.textContent ?? "";
  const prev = el.previousElementSibling;
  if (prev?.tagName === "LABEL") return prev.textContent ?? "";
  return "";
}

function matchesKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return COVER_KEYWORDS.some((kw) => lower.includes(kw));
}

function isCandidateField(el: Element): boolean {
  const attrs = [
    el.getAttribute("placeholder") ?? "",
    el.getAttribute("name") ?? "",
    el.getAttribute("id") ?? "",
    el.getAttribute("aria-label") ?? "",
    getAssociatedLabel(el),
  ];
  return attrs.some(matchesKeyword);
}

function findCandidateFields(): Element[] {
  const textareas = Array.from(document.querySelectorAll("textarea"));
  const contentEditables = Array.from(document.querySelectorAll('[contenteditable="true"]'));
  const all = [...textareas, ...contentEditables];

  const matched = all.filter(isCandidateField);
  // Fall back to any visible textarea/contenteditable if none match keywords
  if (matched.length > 0) return matched;
  return all.filter((el) => {
    const r = (el as HTMLElement).getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

function extractJobContext(): { jobTitle: string; jobDescription: string } {
  const h1 = document.querySelector("h1");
  const jobTitle = h1?.textContent?.trim() ?? document.title;

  const candidates = Array.from(document.querySelectorAll("p, div, section, li"));
  const descriptionKeywords = [
    // English
    "job description", "about the role", "about this role", "responsibilities", "requirements",
    // Ukrainian
    "обов'язки", "вимоги", "про вакансію", "опис вакансії", "що потрібно", "що ми пропонуємо",
    // Russian
    "обязанности", "требования", "описание вакансии", "о вакансии",
  ];
  let jobDescription = "";

  for (const el of candidates) {
    const text = el.textContent ?? "";
    if (descriptionKeywords.some((kw) => text.toLowerCase().includes(kw))) {
      jobDescription += text + "\n";
      if (jobDescription.length >= 2000) break;
    }
  }

  if (!jobDescription) {
    jobDescription = document.body.innerText.slice(0, 2000);
  }

  return {
    jobTitle: jobTitle.slice(0, 200),
    jobDescription: jobDescription.slice(0, 2000),
  };
}

function insertText(field: Element, text: string): void {
  if (field.getAttribute("contenteditable")) {
    (field as HTMLElement).innerText = text;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    const nativeInputSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype, "value"
    )?.set;
    nativeInputSetter?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

// ── In-page toast ────────────────────────────────────────────────────────────

let toastEl: HTMLElement | null = null;

function showToast(message: string, variant: "loading" | "success" | "error") {
  removeToast();

  const el = document.createElement("div");
  el.id = "__ai_cv_toast__";

  const colors: Record<typeof variant, { bg: string; border: string; text: string }> = {
    loading: { bg: "#1e293b", border: "#334155", text: "#e2e8f0" },
    success:  { bg: "#14532d", border: "#166534", text: "#bbf7d0" },
    error:    { bg: "#450a0a", border: "#7f1d1d", text: "#fecaca" },
  };
  const c = colors[variant];

  Object.assign(el.style, {
    position: "fixed",
    bottom: "24px",
    right: "24px",
    zIndex: "2147483647",
    background: c.bg,
    border: `1px solid ${c.border}`,
    color: c.text,
    borderRadius: "10px",
    padding: "12px 16px",
    fontSize: "13px",
    fontFamily: "system-ui, sans-serif",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
    maxWidth: "320px",
    lineHeight: "1.4",
    transition: "opacity 0.2s",
  });

  if (variant === "loading") {
    const spinner = document.createElement("div");
    Object.assign(spinner.style, {
      width: "14px",
      height: "14px",
      border: "2px solid #475569",
      borderTopColor: "#94a3b8",
      borderRadius: "50%",
      flexShrink: "0",
      animation: "__ai_cv_spin__ 0.7s linear infinite",
    });
    if (!document.getElementById("__ai_cv_keyframes__")) {
      const style = document.createElement("style");
      style.id = "__ai_cv_keyframes__";
      style.textContent = "@keyframes __ai_cv_spin__ { to { transform: rotate(360deg); } }";
      document.head.appendChild(style);
    }
    el.appendChild(spinner);
  }

  const text = document.createElement("span");
  text.textContent = message;
  el.appendChild(text);

  document.body.appendChild(el);
  toastEl = el;
}

function removeToast() {
  toastEl?.remove();
  toastEl = null;
}

function flashToast(message: string, variant: "success" | "error") {
  showToast(message, variant);
  setTimeout(removeToast, 3000);
}

// ─────────────────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "PING") {
    sendResponse(true);
    return;
  }

  if (message.type === "SHOW_LOADING") {
    showToast(message.text ?? "Generating…", "loading");
  }

  if (message.type === "SHOW_RESULT") {
    flashToast(message.text, message.variant ?? "success");
  }

  if (message.type === "INSERT_TEXT") {
    const fields = findCandidateFields();
    const field = fields[message.fieldIndex ?? 0];
    if (field) insertText(field, message.text);
  }

  if (message.type === "GET_PAGE_CONTEXT") {
    const fields = findCandidateFields();
    if (fields.length === 0) {
      sendResponse(null);
      return;
    }
    const field = fields[0];
    const { jobTitle, jobDescription } = extractJobContext();
    const fieldContext =
      field.getAttribute("placeholder") ??
      field.getAttribute("aria-label") ??
      getAssociatedLabel(field) ??
      "cover letter";
    sendResponse({ jobTitle, jobDescription, fieldContext });
  }
});
