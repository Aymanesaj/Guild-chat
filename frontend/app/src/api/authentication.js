import { jsonBody, refreshSession, request, requestPublic } from "./http";

export { authedFetch, ApiError } from "./http";
export { refreshSession };

/**
 * Auth module — owned by IDENTITY-SERVICE.
 *
 * Gateway route:  location /api/users/  ->  identity-service
 *                 rewrite ^/api/users/(.*)$ /$1
 *
 * So the service sees the path WITHOUT the /api/users prefix:
 *   frontend calls  /api/users/auth/login   ->  service handles  /auth/login
 *
 * Session model: see the contract block in ./http.js. Register, login and
 * refresh all set the session cookies; logout clears them.
 */
const AUTH_URL = "/api/users/auth";

/** Base for the plain user resource (see ./profile.js for the rest of it). */
const USERS_URL = "/api/users";

/**
 * POST /auth/register   (identity-service)
 * Used by: AuthPage signup form.
 *
 * Body:     { username, email, password }
 * Response: 201 + the created user
 *           { id, username, email, display_name, bio, avatar, status }
 * Errors:   409 when username or email is taken, 422 on validation.
 *
 * IMPORTANT: register MUST issue the session cookies, same as login. The
 * signup screen goes straight to the app afterwards and never calls login.
 */
export async function registerUser(username, email, password) {
  return requestPublic(
    `${AUTH_URL}/register`,
    { method: "POST", ...jsonBody({ username, email, password }) },
    "Failed to create account",
  );
}

/**
 * POST /auth/login   (identity-service)
 * Used by: AuthPage login form.
 *
 * Body:     { identifier, password }  — `identifier` is an email OR a username,
 *                                       the service decides which by content.
 * Response: 200, sets the session cookies. Body may be the user object.
 * Errors:   401 with { message: "Invalid credentials" } on a bad pair.
 */
export async function loginUser(identifier, password) {
  return requestPublic(
    `${AUTH_URL}/login`,
    { method: "POST", ...jsonBody({ identifier, password }) },
    "Failed to log in",
  );
}

/**
 * POST /auth/logout   (identity-service)
 * Used by: AppShell / Sidebar logout button.
 *
 * No body. Must clear (expire) both the access and refresh cookies and
 * invalidate the refresh token server-side.
 */
export async function logoutUser() {
  return request(`${AUTH_URL}/logout`, { method: "POST" }, "Failed to log out");
}

/**
 * GET /me   (identity-service)
 * Used by: App.jsx session probe on boot, and ProfileOverlayContext for the
 * current user everything else keys off.
 *
 * Response: { id, username, email, display_name, bio, avatar, status }
 *           `avatar` is the stored FILENAME (not a URL) — see ./profile.js.
 * Errors:   401 when there is no valid session. App.jsx treats any failure
 *           here as "logged out" and redirects to /auth.
 */
export async function getMe() {
  return request(`${USERS_URL}/me`, { method: "GET" }, "Failed to fetch user data");
}
