/**
 * Access/refresh token storage. identity-service hands both back in the JSON
 * body and every service expects `Authorization: Bearer`, so the tokens live
 * here instead of in cookies. Storage can throw (private mode, blocked site
 * data) — every access is guarded and falls back to an in-memory copy.
 */

const STORAGE_KEY = "ft.auth";

let memory = null;

function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : memory;
  } catch {
    return memory;
  }
}

export function getAccessToken() {
  return read()?.accessToken ?? null;
}

export function getRefreshToken() {
  return read()?.refreshToken ?? null;
}

/** Access token claims. Not verified — the services do that; this is for local decisions only. */
function accessClaims() {
  const token = getAccessToken();
  if (!token) return null;

  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
}

/** The `sub` claim — identity's user id. */
export function getCurrentUserId() {
  return accessClaims()?.sub ?? null;
}

/**
 * True when the access token is missing or expires within `skewSeconds`.
 * identity-service answers an expired token with 403 rather than 401, so
 * waiting for a 401 before refreshing isn't enough.
 */
export function isAccessTokenExpired(skewSeconds = 30) {
  const exp = accessClaims()?.exp;
  if (!exp) return true;
  return Date.now() / 1000 >= exp - skewSeconds;
}

export function hasSession() {
  return Boolean(getRefreshToken() || getAccessToken());
}

export function setTokens({ accessToken, refreshToken }) {
  memory = { accessToken, refreshToken };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // memory copy is enough for this tab
  }
}

export function clearTokens() {
  memory = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing to clear
  }
}
