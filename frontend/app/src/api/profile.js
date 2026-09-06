import { ApiError, authedFetch, buildQuery, jsonBody, request } from "./http";

/**
 * Profile module — owned by IDENTITY-SERVICE.
 *
 * Gateway route:  location /api/users/  ->  identity-service
 *                 rewrite ^/api/users/(.*)$ /$1
 *   frontend calls  /api/users/me   ->  service handles  /me
 *
 * The user object this app renders:
 *   {
 *     id, username, display_name, bio,
 *     avatar,             // stored filename, or null
 *     status,             // "online" | "offline" | "away"
 *     friendship_id,      // id of the friendship row with the CURRENT user,
 *                         // null when there is none
 *     friendship_status,  // "none" | "friends" | "pending_outgoing"
 *                         //        | "pending_incoming"
 *   }
 *
 * `friendship_id` / `friendship_status` are relative to the caller and only
 * need to be present on /by-username — that is what drives the buttons in
 * ProfilePreviewPopover (Add friend / Cancel request / Accept / Remove).
 */
const API_BASE = "/api/users";

/**
 * GET /check-username?username=   (identity-service)
 * Used by: ProfileOverlay, debounced while typing a new username.
 *
 * Response: { available: boolean }
 * Note: called on every keystroke (debounced) and aborted via `signal`, so
 * keep it cheap and make sure it does NOT require the name to be free of the
 * caller's own current username.
 */
export async function checkUsernameAvailability(username, { signal } = {}) {
  return request(
    `${API_BASE}/check-username${buildQuery({ username })}`,
    { signal },
    "Failed to check username",
  );
}

/**
 * PUT /me   (identity-service)
 * Used by: ProfileOverlay "edit profile" form.
 *
 * Body:     any subset of { display_name, username, bio } — treat missing
 *           keys as "leave unchanged", not as "clear".
 * Response: the updated user object.
 * Errors:   409 when the requested username is taken.
 */
export async function updateProfile(payload) {
  return request(
    `${API_BASE}/me`,
    { method: "PUT", ...jsonBody(payload) },
    "Failed to update profile",
  );
}

/**
 * GET /by-username?username=   (identity-service)
 * Used by: ProfilePreviewPopover, when clicking a username anywhere in the UI.
 *
 * Response: the user object above, INCLUDING friendship_id /
 *           friendship_status relative to the caller.
 * Errors:   404 -> the popover shows "User not found".
 */
export async function getUserByUsername(username) {
  return request(
    `${API_BASE}/by-username${buildQuery({ username })}`,
    {},
    "User not found",
  );
}

/**
 * Builds the URL for GET /avatar/{filename}   (identity-service)
 * `avatar` is the filename returned on the user object, not a full URL.
 */
export function avatarUrl(avatar) {
  return avatar ? `${API_BASE}/avatar/${encodeURIComponent(avatar)}` : null;
}

/**
 * GET /avatar/{filename}   (identity-service)
 * Used by: useAvatarUrl hook -> every avatar in the app.
 *
 * Response: the raw image bytes with a correct Content-Type. This is an
 * AUTHENTICATED request (cookies), which is why the hook fetches a blob
 * instead of putting the URL in an <img src>.
 *
 * Backend note: this is one request per avatar per component mount, with no
 * caching in front of it. Send a long Cache-Control on the response — the
 * filename changes whenever the avatar changes, so it is safe to cache hard.
 */
export async function getAvatarBlob(avatar) {
  const response = await authedFetch(avatarUrl(avatar));

  if (!response.ok) {
    throw new ApiError("Failed to fetch avatar", response.status, null);
  }

  return response.blob();
}

/**
 * POST /me/avatar   (identity-service)
 * Used by: ProfileOverlay avatar picker.
 *
 * Body:     multipart/form-data with a single file field named `avatar`.
 *           The browser sets the Content-Type + boundary itself, so we must
 *           NOT set that header here.
 * Response: the updated user object (with the new `avatar` filename).
 * Errors:   413 too large, 415 unsupported type.
 */
export async function uploadAvatar(file) {
  const formData = new FormData();
  formData.append("avatar", file);

  return request(
    `${API_BASE}/me/avatar`,
    { method: "POST", body: formData },
    "Failed to upload avatar",
  );
}

/**
 * DELETE /me/avatar   (identity-service)
 * Used by: ProfileOverlay "remove photo".
 *
 * Clears the avatar and deletes the stored file. Response: the updated user
 * object with `avatar: null`.
 */
export async function deleteAvatar() {
  return request(`${API_BASE}/me/avatar`, { method: "DELETE" }, "Failed to remove avatar");
}
