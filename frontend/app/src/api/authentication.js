import { jsonBody, refreshSession, request, requestPublic } from "./http";
import { clearTokens, setTokens } from "./tokens";
import { clearUserCache, normalizeUser, rememberUser } from "./users";

export { authedFetch, ApiError, LOGOUT_EVENT } from "./http";
export { hasSession } from "./tokens";
export { refreshSession };

const API_URL = "/api/users";

/** login/register/refresh all answer { tokenType, accessToken, refreshToken, user }. */
function startSession(auth) {
  setTokens(auth);
  return rememberUser(normalizeUser(auth.user));
}

export async function registerUser(username, email, password) {
  const auth = await requestPublic(
    `${API_URL}/register`,
    { method: "POST", ...jsonBody({ username, email, password }) },
    "Failed to create account",
  );
  return startSession(auth);
}

export async function loginUser(identifier, password) {
  const auth = await requestPublic(
    `${API_URL}/login`,
    { method: "POST", ...jsonBody({ identifier, password }) },
    "Failed to log in",
  );
  return startSession(auth);
}

/** Revokes every refresh token server-side, then forgets the local pair regardless. */
export async function logoutUser() {
  try {
    return await request(`${API_URL}/auth/logout`, { method: "POST" }, "Failed to log out");
  } finally {
    clearTokens();
    clearUserCache();
  }
}

export async function getMe() {
  const me = await request(`${API_URL}/me`, { method: "GET" }, "Failed to fetch user data");
  return rememberUser(normalizeUser(me));
}
