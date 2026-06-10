import { describe, it, expect, beforeEach, vi } from "vitest";
import { JSDOM } from "jsdom";

// Stub chrome before content.ts is imported (it calls chrome.runtime.onMessage at module level)
vi.stubGlobal("chrome", {
  runtime: { onMessage: { addListener: vi.fn() } },
});

const { extractJobContext } = await import("./content");

// extractJobContext reads from the live document, so we swap document per test
function setDocument(html: string) {
  const dom = new JSDOM(html, { url: "https://example.com" });
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("window", dom.window);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("extractJobContext — text selection takes priority", () => {
  it("returns selection when it is >= 100 chars", () => {
    const selected = "A".repeat(120);
    setDocument(`<html><body><h1>Engineer</h1><p>${selected}</p></body></html>`);
    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => selected,
    } as unknown as Selection);

    const result = extractJobContext();
    expect(result.jobDescription).toBe(selected);
    expect(result.jobDescription.length).toBe(120);
  });

  it("falls back to DOM heuristics when selection is < 100 chars", () => {
    setDocument(`
      <html><body>
        <h1>Frontend Developer</h1>
        <div id="job-description">We are looking for a skilled frontend developer with 3+ years React experience to join our growing product team working on exciting projects.</div>
      </body></html>
    `);
    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "short",
    } as unknown as Selection);

    const result = extractJobContext();
    expect(result.jobDescription).toContain("React");
    expect(result.jobDescription.length).toBeGreaterThanOrEqual(100);
  });
});

describe("extractJobContext — DOM heuristics", () => {
  it("extracts job title from <h1>", () => {
    setDocument(`
      <html><body>
        <h1>Senior Backend Engineer</h1>
        <div class="job-description">We need an experienced engineer ${"x".repeat(200)}</div>
      </body></html>
    `);
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "" } as unknown as Selection);

    const result = extractJobContext();
    expect(result.jobTitle).toBe("Senior Backend Engineer");
  });

  it("falls back to document.title when no <h1>", () => {
    setDocument(`<html><head><title>Product Manager - Acme</title></head><body><p>${"x".repeat(200)}</p></body></html>`);
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "" } as unknown as Selection);

    const result = extractJobContext();
    expect(result.jobTitle).toBe("Product Manager - Acme");
  });

  it("picks up element with 'description' in id", () => {
    setDocument(`
      <html><body>
        <h1>Data Scientist</h1>
        <div id="job-description">We are looking for a data scientist with Python and ML expertise to build recommendation models for our platform and work cross-functionally with product teams.</div>
      </body></html>
    `);
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "" } as unknown as Selection);

    const result = extractJobContext();
    expect(result.jobDescription).toContain("data scientist");
  });

  it("picks up element with 'about' in class", () => {
    setDocument(`
      <html><body>
        <h1>DevOps Engineer</h1>
        <section class="about-role">Manage our cloud infrastructure on GCP and automate CI/CD pipelines for 50+ microservices. Strong Kubernetes and Terraform knowledge required for this full-time remote role.</section>
      </body></html>
    `);
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "" } as unknown as Selection);

    const result = extractJobContext();
    expect(result.jobDescription).toContain("Kubernetes");
  });

  it("truncates job description to 3000 chars", () => {
    const longText = "We need an engineer. ".repeat(300);
    setDocument(`
      <html><body>
        <h1>Engineer</h1>
        <div aria-label="job details">${longText}</div>
      </body></html>
    `);
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "" } as unknown as Selection);

    const result = extractJobContext();
    expect(result.jobDescription.length).toBeLessThanOrEqual(3000);
  });
});

describe("extractJobContext — vacancy-prefixed class names (DOU-style)", () => {
  it("extracts content from elements with 'vacancy' in class", () => {
    setDocument(`
      <html><body>
        <h1>Middle+ Frontend Developer (Angular)</h1>
        <div class="b-vacancy-text">
          <p>Обов'язки: розробка SPA на Angular, code review, участь у плануванні спринтів.</p>
          <p>Вимоги: 3+ роки Angular, TypeScript, RxJS, знання REST API та gRPC.</p>
          <p>Пропонуємо: повністю віддалена робота, гнучкий графік, конкурентна зарплата.</p>
        </div>
      </body></html>
    `);
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "" } as unknown as Selection);

    const result = extractJobContext();
    expect(result.jobTitle).toBe("Middle+ Frontend Developer (Angular)");
    expect(result.jobDescription).toContain("Angular");
    expect(result.jobDescription).toContain("Вимоги");
  });

  it("falls through to keyword matching when attr-matched content is too thin", () => {
    setDocument(`
      <html><head><title>Job Page</title></head><body>
        <h1>Frontend Developer</h1>
        <div class="description">Short irrelevant text.</div>
        <section>
          <p>Обов'язки: розробка та підтримка веб-застосунків на Angular, написання тестів, code review та участь у технічних дискусіях команди.</p>
          <p>Вимоги: досвід Angular від 2 років, знання TypeScript, RxJS, розуміння HTTP та REST API.</p>
        </section>
      </body></html>
    `);
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "" } as unknown as Selection);

    const result = extractJobContext();
    expect(result.jobDescription).toContain("Вимоги");
    expect(result.jobDescription).toContain("Angular");
  });
});

describe("extractJobContext — absent job description", () => {
  it("returns empty string when page has no meaningful content", () => {
    setDocument(`<html><body><p>Welcome to our website.</p></body></html>`);
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "" } as unknown as Selection);

    const result = extractJobContext();
    expect(result.jobDescription.length).toBeLessThan(100);
  });
});
