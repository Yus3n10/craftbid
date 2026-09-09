import type { ApiErrorDto } from "@raxtan/shared";
import {
  BEARER_MODE,
  clearTokens,
  getAccessToken,
  getRefreshToken,
  storeTokens,
} from "./session.js";

declare const __API_URL__: string;

export const API_URL = __API_URL__;

/**
 * A failed request, carrying the field-level messages a form needs.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;

  constructor(status: number, body: ApiErrorDto | null) {
    super(body?.error.message ?? "Something went wrong. Please try again.");
    this.name = "ApiError";
    this.status = status;
    this.code = body?.error.code ?? "unknown";
    this.fields = body?.error.fields ?? {};
  }
}

/**
 * Sessions ride on httpOnly cookies, so no token is ever readable from
 * JavaScript and an XSS cannot walk off with one. Every request opts in with
 * `credentials: "include"` because the API is on a different origin.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  // Collapse concurrent 401s into one refresh, or a page issuing four queries
  // at once would fire four refreshes and rotate the token out from under
  // itself three times.
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include",
        // An explicit body, because a POST with no body at all fails JSON body
        // validation with a 400 before the route is reached, which would make
        // a genuinely renewable session look unrecoverable. In bearer mode the
        // stored refresh token travels here, since there is no cookie.
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          BEARER_MODE ? { refreshToken: getRefreshToken() ?? undefined } : {},
        ),
      });

      if (!response.ok) {
        // The refresh token is spent or revoked; holding on to it only makes
        // every later request pay for a doomed refresh.
        if (BEARER_MODE) clearTokens();
        return false;
      }

      if (BEARER_MODE) {
        storeTokens(
          (await response.json()) as {
            accessToken: string;
            refreshToken: string;
          },
        );
      }
      return true;
    } catch {
      return false;
    } finally {
      // Cleared on the next tick so callers awaiting this promise all see the
      // same result before a new attempt can start.
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();

  return refreshInFlight;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  /** Set internally to stop a refresh loop. */
  retrying?: boolean;
}

export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, signal, retrying = false } = options;

  const headers: Record<string, string> = {};
  const accessToken = getAccessToken();
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  if (body !== undefined) headers["Content-Type"] = "application/json";

  const init: RequestInit = { method, credentials: "include", headers };
  if (signal) init.signal = signal;
  if (body !== undefined) init.body = JSON.stringify(body);

  const response = await fetch(`${API_URL}${path}`, init);

  // An expired access token is normal: refresh once, then replay.
  if (response.status === 401 && !retrying && path !== "/auth/refresh") {
    if (await refreshSession()) {
      return request<T>(path, { ...options, retrying: true });
    }
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(response.status, parsed as ApiErrorDto | null);
  }

  return parsed as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) =>
    request<T>(path, signal ? { signal } : {}),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

/** Uploads one image and returns the record the forms reference by id. */
export async function uploadImage(
  file: File,
): Promise<{ id: string; url: string; width: number; height: number }> {
  const form = new FormData();
  form.append("file", file);

  const accessToken = getAccessToken();
  const response = await fetch(`${API_URL}/images`, {
    method: "POST",
    credentials: "include",
    // Content-Type is deliberately unset so the browser adds the multipart
    // boundary itself.
    ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
    body: form,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(
      response.status,
      text ? (JSON.parse(text) as ApiErrorDto) : null,
    );
  }

  return response.json() as Promise<{
    id: string;
    url: string;
    width: number;
    height: number;
  }>;
}
