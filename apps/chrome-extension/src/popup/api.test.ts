import { describe, it, expect, vi, beforeEach } from "vitest";

const storageMock: Record<string, unknown> = {};
const chromeMock = {
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: storageMock[key] })),
      set: vi.fn(async (obj: Record<string, unknown>) => { Object.assign(storageMock, obj); }),
      remove: vi.fn(async (key: string) => { delete storageMock[key]; }),
    },
  },
  identity: {
    getAuthToken: vi.fn(),
    removeCachedAuthToken: vi.fn((_opts: unknown, cb: () => void) => cb()),
  },
  runtime: {
    lastError: undefined as { message?: string } | undefined,
  },
};

vi.stubGlobal("chrome", chromeMock);

const {
  loginWithGoogle,
  refreshGoogleToken,
  getAuthMethod,
  saveAuthMethod,
  clearAuthMethod,
} = await import("./api");

const FAKE_ACCESS_TOKEN = "google-access-token-abc";
const FAKE_JWT = "backend-jwt-xyz";

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(storageMock).forEach((k) => delete storageMock[k]);
  chromeMock.runtime.lastError = undefined;
  storageMock["api_base"] = "https://api.example.com";
});

describe("saveAuthMethod / getAuthMethod / clearAuthMethod", () => {
  it("persists and retrieves auth method", async () => {
    await saveAuthMethod("google");
    chromeMock.storage.local.get.mockResolvedValueOnce({ cv_auth_method: "google" });
    expect(await getAuthMethod()).toBe("google");
  });

  it("returns null when not set", async () => {
    chromeMock.storage.local.get.mockResolvedValueOnce({});
    expect(await getAuthMethod()).toBeNull();
  });

  it("clears auth method", async () => {
    await clearAuthMethod();
    expect(chromeMock.storage.local.remove).toHaveBeenCalledWith("cv_auth_method");
  });
});

describe("loginWithGoogle", () => {
  it("exchanges access token for backend JWT and stores google auth method", async () => {
    chromeMock.identity.getAuthToken.mockImplementation(
      (_opts: unknown, cb: (token?: string) => void) => cb(FAKE_ACCESS_TOKEN)
    );

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: FAKE_JWT }),
    } as Response);

    const token = await loginWithGoogle();

    expect(token).toBe(FAKE_JWT);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/google/token"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ accessToken: FAKE_ACCESS_TOKEN }),
      })
    );
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ cv_auth_method: "google" })
    );
  });

  it("throws when user cancels", async () => {
    chromeMock.identity.getAuthToken.mockImplementation(
      (_opts: unknown, cb: (token?: string) => void) => {
        chromeMock.runtime.lastError = { message: "The user did not approve access." };
        cb(undefined);
      }
    );
    await expect(loginWithGoogle()).rejects.toThrow();
  });

  it("throws when backend rejects the token", async () => {
    chromeMock.identity.getAuthToken.mockImplementation(
      (_opts: unknown, cb: (token?: string) => void) => cb(FAKE_ACCESS_TOKEN)
    );
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response);
    await expect(loginWithGoogle()).rejects.toThrow(/rejected/i);
  });
});

describe("refreshGoogleToken", () => {
  it("removes cached token and fetches a fresh one non-interactively", async () => {
    chromeMock.identity.getAuthToken.mockImplementation(
      (opts: { interactive: boolean }, cb: (token?: string) => void) => {
        cb(FAKE_ACCESS_TOKEN);
      }
    );

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: FAKE_JWT }),
    } as Response);

    const token = await refreshGoogleToken();
    expect(token).toBe(FAKE_JWT);
    expect(chromeMock.identity.removeCachedAuthToken).toHaveBeenCalled();
  });
});
