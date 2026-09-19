import { requireEndpoint } from "./features";
import { ApiError, authedFetch, jsonBody, request } from "./http";
import { normalizeUser } from "./users";

export { checkUsernameAvailability, getUserById, getUserByUsername } from "./users";

const API_BASE = "/api/users";

export async function updateProfile({ display_name, username, bio } = {}) {
  // Any subset; identity treats a missing field as "leave unchanged".
  const payload = { displayName: display_name, username, bio };
  return request(
    `${API_BASE}/me`,
    { method: "PUT", ...jsonBody(payload) },
    "Failed to update profile",
  ).then(normalizeUser);
}

/**
 * identity stores `avatarUrl` as a gateway path (/api/users/avatars/<file>);
 * bare filenames are still accepted for safety.
 */
export function avatarUrl(avatar) {
  if (!avatar) return null;
  if (avatar.startsWith("/") || /^https?:\/\//.test(avatar)) return avatar;
  return `${API_BASE}/avatars/${encodeURIComponent(avatar)}`;
}

export async function getAvatarBlob(avatar) {
  const response = await authedFetch(avatarUrl(avatar));

  if (!response.ok) {
    throw new ApiError("Failed to fetch avatar", response.status, null);
  }

  return response.blob();
}

export async function uploadAvatar(file) {
  const formData = new FormData();
  formData.append("file", file);

  // No Content-Type header — the browser sets the multipart boundary.
  return request(
    `${API_BASE}/me/avatar`,
    { method: "POST", body: formData },
    "Failed to upload avatar",
  ).then(normalizeUser);
}

/** identity `DELETE /me/avatar` — not implemented yet (see features.js). */
export async function deleteAvatar() {
  requireEndpoint("avatarDelete");
  return request(`${API_BASE}/me/avatar`, { method: "DELETE" }, "Failed to remove avatar");
}
