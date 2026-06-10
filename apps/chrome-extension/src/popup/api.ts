const TOKEN_KEY = "cv_token";
const AUTH_METHOD_KEY = "cv_auth_method";
const GOOGLE_CLIENT_ID =
  "1015982503484-qcsd4ide4960h65mlqca166qfvjofukk.apps.googleusercontent.com";

export type AuthMethod = "google" | "password";

export async function getToken(): Promise<string | null> {
  const result = await chrome.storage.local.get(TOKEN_KEY);
  return result[TOKEN_KEY] ?? null;
}

export async function saveToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [TOKEN_KEY]: token });
}

export async function clearToken(): Promise<void> {
  await chrome.storage.local.remove(TOKEN_KEY);
}

export async function getAuthMethod(): Promise<AuthMethod | null> {
  const result = await chrome.storage.local.get(AUTH_METHOD_KEY);
  return result[AUTH_METHOD_KEY] ?? null;
}

export async function saveAuthMethod(method: AuthMethod): Promise<void> {
  await chrome.storage.local.set({ [AUTH_METHOD_KEY]: method });
}

export async function clearAuthMethod(): Promise<void> {
  await chrome.storage.local.remove(AUTH_METHOD_KEY);
}

export interface Profile {
  id: string;
  name: string;
  fullName: string;
  title: string;
}

export interface CoverLetterResponse {
  text: string;
  selectedProfileId: string;
  selectedProfileName: string;
}

const DEFAULT_API_BASE = import.meta.env.VITE_API_BASE ?? "https://ai-cv-maker.example.com";

export async function getApiBase(): Promise<string> {
  const result = await chrome.storage.local.get("api_base");
  return result["api_base"] ?? DEFAULT_API_BASE;
}

async function doRequest<T>(
  path: string,
  options: RequestInit,
  token: string
): Promise<T> {
  const base = await getApiBase();
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

async function request<T>(
  path: string,
  options: RequestInit,
  token: string
): Promise<T> {
  try {
    return await doRequest<T>(path, options, token);
  } catch (e) {
    if ((e as Error).message !== "UNAUTHORIZED") throw e;

    // Attempt silent Google token refresh
    const method = await getAuthMethod();
    if (method !== "google") throw e;

    let newToken: string;
    try {
      newToken = await refreshGoogleToken();
    } catch {
      await clearToken();
      await clearAuthMethod();
      throw new Error("UNAUTHORIZED");
    }

    await saveToken(newToken);
    return doRequest<T>(path, options, newToken);
  }
}

async function getGoogleAccessToken(interactive: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message ?? "Cancelled"));
      } else {
        resolve(token);
      }
    });
  });
}

async function exchangeAccessToken(accessToken: string): Promise<string> {
  const base = await getApiBase();
  const res = await fetch(`${base}/api/auth/google/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessToken }),
  });
  if (!res.ok) throw new Error("Google sign-in rejected by server");
  const data = await res.json();
  return data.token;
}

export async function loginWithGoogle(): Promise<string> {
  const accessToken = await getGoogleAccessToken(true);
  const jwt = await exchangeAccessToken(accessToken);
  await saveAuthMethod("google");
  return jwt;
}


export async function refreshGoogleToken(): Promise<string> {
  // Remove cached token so Chrome fetches a fresh one, then get a new one
  const stale = await getGoogleAccessToken(false).catch(() => "");
  if (stale) {
    await new Promise<void>((resolve) =>
      chrome.identity.removeCachedAuthToken({ token: stale }, resolve)
    );
  }
  const accessToken = await getGoogleAccessToken(false);
  return exchangeAccessToken(accessToken);
}

export async function login(email: string, password: string): Promise<string> {
  const base = await getApiBase();
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? "Login failed");
  }
  const data = await res.json();
  return data.token;
}

const SELECTED_PROFILE_KEY = "cv_selected_profile";

export async function getSelectedProfile(): Promise<string> {
  const result = await chrome.storage.local.get(SELECTED_PROFILE_KEY);
  return result[SELECTED_PROFILE_KEY] ?? "auto";
}

export async function saveSelectedProfile(profileId: string): Promise<void> {
  await chrome.storage.local.set({ [SELECTED_PROFILE_KEY]: profileId });
}

export async function fetchProfiles(token: string): Promise<Profile[]> {
  return request<Profile[]>("/api/job-profiles", { method: "GET" }, token);
}

export async function getProfiles(token: string): Promise<Profile[]> {
  return request<Profile[]>("/api/job-profiles", { method: "GET" }, token);
}

interface GenerateResponse {
  id?: string;
  cvId?: string;
  profileId: string;
  fullName: string;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, "_").slice(0, 50).trim();
}

export async function generateAndDownloadCv(
  token: string,
  jobContext: string,
  profileId: string | "auto"
): Promise<void> {
  const base = await getApiBase();

  let cvId: string;
  let resolvedProfileId: string;
  let fullName: string;

  if (profileId === "auto") {
    const res = await fetch(`${base}/api/cvs/generate-auto`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jobDescription: jobContext }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
    }
    const data = (await res.json()) as GenerateResponse;
    cvId = data.cvId ?? data.id ?? "";
    resolvedProfileId = data.profileId;
    fullName = data.fullName;
  } else {
    const res = await fetch(`${base}/api/job-profiles/${profileId}/cvs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ optimizationNotes: jobContext }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
    }
    const data = (await res.json()) as GenerateResponse;
    cvId = data.id ?? data.cvId ?? "";
    resolvedProfileId = profileId;
    fullName = data.fullName;
  }

  const pdfRes = await fetch(
    `${base}/api/job-profiles/${resolvedProfileId}/cvs/${cvId}/pdf`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!pdfRes.ok) throw new Error(`Failed to fetch PDF: HTTP ${pdfRes.status}`);

  const buffer = await pdfRes.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  const dataUrl = `data:application/pdf;base64,${btoa(binary)}`;

  const jobTitle = sanitizeFilename(jobContext.split("\n")[0].trim());
  const safeName = fullName.replace(/[/\\:*?"<>|]/g, "_");
  const filename = `${safeName}_${jobTitle}_CV.pdf`;

  chrome.downloads.download({ url: dataUrl, filename });
}

export async function generateCoverLetter(
  token: string,
  jobTitle: string,
  jobDescription: string,
  fieldContext: string,
  profileIdOverride: string | null
): Promise<CoverLetterResponse> {
  return request<CoverLetterResponse>(
    "/api/cover-letter",
    {
      method: "POST",
      body: JSON.stringify({ jobTitle, jobDescription, fieldContext, profileIdOverride }),
    },
    token
  );
}
