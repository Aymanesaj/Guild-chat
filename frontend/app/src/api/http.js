/**
 * Shared HTTP plumbing for the api layer.
 *
 * Every api/*.js module goes through here, so this is the one place that knows
 * about cookies, the refresh dance and the backend's error envelope.
 *
 * ---------------------------------------------------------------------------
 * CONTRACT FOR THE BACKEND TEAM
 * ---------------------------------------------------------------------------
 * Auth is COOKIE based. There is no Authorization header and no token in
 * localStorage anywhere in this app. Every request is sent with
 * `credentials: "include"`, so each service must:
 *
 *   - Set the session cookies as HttpOnly (+ SameSite=Lax, and Secure in prod).
 *   - Read the access token from the cookie, never from a header.
 *   - Answer 401 (not 403) when the access token is missing/expired, so the
 *     refresh-and-retry below can kick in.
 *
 * All URLs are ROOT-RELATIVE (`/api/...`). The app is served from the same
 * origin as the nginx gateway, which is what makes the cookies work. Do not
 * introduce absolute URLs to a service host — that breaks cookie auth.
 *
 * Error envelope every service must return on a non-2xx:
 *
 *   { "message": "Human readable reason shown directly to the user" }
 *
 * `{ "detail": "..." }` is accepted as a fallback, and a bare string body is
 * used as-is. Anything else falls back to the caller's generic message.
 * ---------------------------------------------------------------------------
 */

/**
 * POST /auth/refresh   (identity-service, via /api/users/)
 *
 * Rotates the access token cookie using the refresh token cookie. Takes no
 * body. Returns 2xx (body ignored) on success, 401 when the refresh token is
 * also dead — at which point the user is fully logged out.
 */
const REFRESH_URL = "/api/users/auth/refresh";

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
  return data.message || data.detail || fallback;
}

/** Builds "?a=1&b=2", skipping undefined/null/empty values. */
export function buildQuery(params = {}) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }

  const queryString = query.toString();
  return queryString ? `?${queryString}` : "";
}

/** Spread into a fetch init to send `payload` as a JSON body. */
export function jsonBody(payload) {
  return {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

let refreshPromise = null;

/** Rotates the access token cookie. Concurrent callers share one request. */
export function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = fetch(REFRESH_URL, {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) {
          const data = await parseBody(response);
          throw new ApiError(errorMessage(data, "Session expired"), response.status, data);
        }
        return parseBody(response);
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

/**
 * fetch + cookies, retried once through /auth/refresh on a 401.
 *
 * Backend note: this means a single expired-access-token 401 is invisible to
 * the user. Only return 401 for an actually-invalid session; use 403 for
 * "authenticated but not allowed", otherwise every permission error costs a
 * pointless refresh round-trip.
 */
export async function authedFetch(url, init = {}) {
  const requestInit = { ...init, credentials: "include" };

  const response = await fetch(url, requestInit);
  if (response.status !== 401) return response;

  try {
    await refreshSession();
  } catch {
    return response;
  }

  return fetch(url, requestInit);
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
  const response = await fetch(url, { ...init, credentials: "include" });
  const data = await parseBody(response);

  if (!response.ok) {
    throw new ApiError(errorMessage(data, fallback), response.status, data);
  }

  return data;
}
