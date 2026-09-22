/**
 * Shared HTTP plumbing for the api layer.
 *
 * The one place that knows about bearer tokens, the refresh dance and the
 * backends' error envelopes (identity: { message }, org: { error },
 * chat: { error: { code, message } }).
 */

import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  isAccessTokenExpired,
  setTokens,
} from "./tokens";

const REFRESH_URL = "/api/users/auth/refresh";

export const LOGOUT_EVENT = "auth:logout";

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

async function parseBody(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessage(data, fallback) {
  if (!data) return fallback;
  if (typeof data === "string") return data;

  // identity validation: { message: "Validation failed", fields: { password: "..." } }
  const fields = data.fields && Object.entries(data.fields);
  if (fields?.length) return fields.map(([field, reason]) => `${field} ${reason}`).join(", ");

  // chat: { error: { code, message } }
  if (data.error && typeof data.error === "object") return data.error.message || fallback;

  return data.message || data.detail || data.error || fallback;
}

export function buildQuery(params = {}) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }

  const queryString = query.toString();
  return queryString ? `?${queryString}` : "";
}

export function jsonBody(payload) {
  return {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

/** Drops the session locally and tells App to bounce to /auth. */
export function endSession() {
  clearTokens();
  window.dispatchEvent(new Event(LOGOUT_EVENT));
}

let refreshPromise = null;

/** Serialises refreshes across tabs where the Web Locks API exists. */
function withRefreshLock(task) {
  return navigator.locks?.request
    ? navigator.locks.request("ft.auth.refresh", task)
    : task();
}

/**
 * Rotates the token pair. Concurrent callers in this tab share one request,
 * and tabs take turns through a lock.
 *
 * `staleRefreshToken` is the refresh token the caller last saw (by default,
 * the current one). If storage holds a different one by the time we get the
 * lock, another tab already rotated it — presenting the old one again would
 * make identity revoke every session, so just hand back what's stored.
 */
export function refreshSession(staleRefreshToken = getRefreshToken()) {
  if (!refreshPromise) {
    refreshPromise = withRefreshLock(async () => {
      const current = getRefreshToken();
      if (!current) throw new ApiError("Session expired", 401, null);

      if (staleRefreshToken && current !== staleRefreshToken) {
        return { accessToken: getAccessToken(), refreshToken: current };
      }

      const response = await fetch(REFRESH_URL, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: current }),
      });
      const data = await parseBody(response);

      if (!response.ok) {
        throw new ApiError(errorMessage(data, "Session expired"), response.status, data);
      }

      setTokens(data);
      return data;
    })
      .catch((error) => {
        // Only a definitive rejection ends the session; a network blip shouldn't.
        if (error instanceof ApiError && error.status === 401) endSession();
        throw error;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

function withAuth(init) {
  const headers = new Headers(init.headers);
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
}

/**
 * Refreshes up front when the access token has (nearly) expired. identity
 * rejects an expired token with 403, which the 401 retry below never catches.
 */
export async function ensureFreshToken() {
  if (!getRefreshToken() || !isAccessTokenExpired()) return;

  try {
    await refreshSession();
  } catch {
    // let the request go out and fail on its own terms
  }
}

/** fetch + bearer token, refreshed ahead of expiry and retried once on a 401. */
export async function authedFetch(url, init = {}) {
  await ensureFreshToken();

  const refreshTokenAtSend = getRefreshToken();

  const response = await fetch(url, withAuth(init));
  if (response.status !== 401) return response;

  try {
    await refreshSession(refreshTokenAtSend);
  } catch {
    return response;
  }

  return fetch(url, withAuth(init));
}

/** authedFetch + JSON parsing + ApiError on failure. */
export async function request(url, init = {}, fallback = "Request failed") {
  const response = await authedFetch(url, init);
  const data = await parseBody(response);

  if (!response.ok) {
    throw new ApiError(errorMessage(data, fallback), response.status, data);
  }

  return data;
}

/** For endpoints that run before a session exists (register, login). */
export async function requestPublic(url, init = {}, fallback = "Request failed") {
  const response = await fetch(url, init);
  const data = await parseBody(response);

  if (!response.ok) {
    throw new ApiError(errorMessage(data, fallback), response.status, data);
  }

  return data;
}
