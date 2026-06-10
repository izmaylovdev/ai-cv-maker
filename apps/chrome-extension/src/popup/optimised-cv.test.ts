import { describe, it, expect, vi, beforeEach } from "vitest";

const storageMock: Record<string, unknown> = {};
const downloadsMock = { download: vi.fn() };
const chromeMock = {
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: storageMock[key] })),
      set: vi.fn(async (obj: Record<string, unknown>) => { Object.assign(storageMock, obj); }),
      remove: vi.fn(async (key: string) => { delete storageMock[key]; }),
    },
  },
  downloads: downloadsMock,
  runtime: { lastError: undefined as { message?: string } | undefined },
};

vi.stubGlobal("chrome", chromeMock);

const {
  getSelectedProfile,
  saveSelectedProfile,
  getProfiles,
  generateAndDownloadCv,
} = await import("./api");

const FAKE_TOKEN = "test-jwt";
const FAKE_PROFILES = [
  { id: "prof-1", name: "Senior Dev", fullName: "Jane Doe", title: "Senior Developer" },
  { id: "prof-2", name: "Backend Dev", fullName: "Jane Doe", title: "Backend Developer" },
];

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(storageMock).forEach((k) => delete storageMock[k]);
  storageMock["api_base"] = "https://api.example.com";
  global.URL.createObjectURL = vi.fn(() => "blob:fake-url");
  global.URL.revokeObjectURL = vi.fn();
});

describe("getSelectedProfile / saveSelectedProfile", () => {
  it("returns 'auto' by default when nothing is stored", async () => {
    chromeMock.storage.local.get.mockResolvedValueOnce({});
    expect(await getSelectedProfile()).toBe("auto");
  });

  it("returns stored profile id", async () => {
    chromeMock.storage.local.get.mockResolvedValueOnce({ cv_selected_profile: "prof-1" });
    expect(await getSelectedProfile()).toBe("prof-1");
  });

  it("persists selected profile id", async () => {
    await saveSelectedProfile("prof-2");
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith({ cv_selected_profile: "prof-2" });
  });

  it("persists 'auto'", async () => {
    await saveSelectedProfile("auto");
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith({ cv_selected_profile: "auto" });
  });
});

describe("getProfiles", () => {
  it("fetches profiles from /api/job-profiles", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => FAKE_PROFILES,
    } as Response);

    const profiles = await getProfiles(FAKE_TOKEN);
    expect(profiles).toEqual(FAKE_PROFILES);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/job-profiles"),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${FAKE_TOKEN}` }) })
    );
  });

  it("throws on non-2xx response", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as Response);
    await expect(getProfiles(FAKE_TOKEN)).rejects.toThrow();
  });
});

describe("generateAndDownloadCv — specific profile", () => {
  it("calls POST /api/profiles/:id/generate then fetches PDF and triggers download", async () => {
    const fakePdfBlob = new Blob(["pdf-bytes"], { type: "application/pdf" });

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "cv-99", profileId: "prof-1", fullName: "Jane Doe" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        blob: async () => fakePdfBlob,
      } as Response);

    await generateAndDownloadCv(FAKE_TOKEN, "Software Engineer at Acme", "prof-1");

    expect(fetch).toHaveBeenNthCalledWith(1,
      expect.stringContaining("/api/job-profiles/prof-1/cvs"),
      expect.objectContaining({ method: "POST" })
    );
    expect(fetch).toHaveBeenNthCalledWith(2,
      expect.stringContaining("/api/job-profiles/prof-1/cvs/cv-99/pdf"),
      expect.anything()
    );
    expect(chromeMock.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "blob:fake-url",
        filename: expect.stringMatching(/Jane Doe.*CV\.pdf/),
      })
    );
  });

  it("includes job description in optimizationNotes", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "cv-1", profileId: "prof-1", fullName: "Jane Doe" }) } as Response)
      .mockResolvedValueOnce({ ok: true, blob: async () => new Blob([]) } as Response);

    await generateAndDownloadCv(FAKE_TOKEN, "React Developer needed", "prof-1");

    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.optimizationNotes).toContain("React Developer needed");
  });
});

describe("generateAndDownloadCv — auto profile", () => {
  it("calls POST /api/cvs/generate-auto when profileId is 'auto'", async () => {
    const fakePdfBlob = new Blob(["pdf-bytes"], { type: "application/pdf" });

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ cvId: "cv-77", profileId: "prof-2", fullName: "Jane Doe" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        blob: async () => fakePdfBlob,
      } as Response);

    await generateAndDownloadCv(FAKE_TOKEN, "Senior Python Engineer at BigCo", "auto");

    expect(fetch).toHaveBeenNthCalledWith(1,
      expect.stringContaining("/api/cvs/generate-auto"),
      expect.objectContaining({ method: "POST" })
    );
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.jobDescription).toContain("Senior Python Engineer");
  });

  it("uses cvId from auto response to fetch PDF", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ cvId: "cv-77", profileId: "prof-2", fullName: "Jane Doe" }) } as Response)
      .mockResolvedValueOnce({ ok: true, blob: async () => new Blob([]) } as Response);

    await generateAndDownloadCv(FAKE_TOKEN, "job description", "auto");

    expect(fetch).toHaveBeenNthCalledWith(2,
      expect.stringContaining("/api/job-profiles/prof-2/cvs/cv-77/pdf"),
      expect.anything()
    );
  });
});

describe("generateAndDownloadCv — filename", () => {
  it("names file [FullName]_[JobTitle]_CV.pdf with filesystem-safe job title", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "cv-1", profileId: "prof-1", fullName: "Jane Doe" }) } as Response)
      .mockResolvedValueOnce({ ok: true, blob: async () => new Blob([]) } as Response);

    await generateAndDownloadCv(FAKE_TOKEN, "Senior React/Node.js Developer: Full-Time", "prof-1");

    const { filename } = chromeMock.downloads.download.mock.calls[0][0];
    expect(filename).toMatch(/^Jane Doe_/);
    expect(filename).toMatch(/_CV\.pdf$/);
    expect(filename).not.toMatch(/[/\\:*?"<>|]/);
  });

  it("truncates job title to 50 characters in filename", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "cv-1", profileId: "prof-1", fullName: "Jane Doe" }) } as Response)
      .mockResolvedValueOnce({ ok: true, blob: async () => new Blob([]) } as Response);

    const longTitle = "A".repeat(80);
    await generateAndDownloadCv(FAKE_TOKEN, longTitle, "prof-1");

    const { filename } = chromeMock.downloads.download.mock.calls[0][0];
    const jobPart = filename.replace("Jane Doe_", "").replace("_CV.pdf", "");
    expect(jobPart.length).toBeLessThanOrEqual(50);
  });
});

describe("generateAndDownloadCv — error handling", () => {
  it("throws with API error message on non-2xx from generate endpoint", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 422, json: async () => ({ error: "User has no profiles" }),
    } as Response);

    await expect(generateAndDownloadCv(FAKE_TOKEN, "some job", "auto")).rejects.toThrow("User has no profiles");
  });
});
