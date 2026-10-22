import { ApiError, authedFetch, jsonBody, LOGOUT_EVENT, request } from "./http";
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
function avatarUrl(avatar) {
  if (!avatar) return null;
  if (avatar.startsWith("/") || /^https?:\/\//.test(avatar)) return avatar;
  return `${API_BASE}/avatars/${encodeURIComponent(avatar)}`;
}

async function getAvatarBlob(avatar) {
  const response = await authedFetch(avatarUrl(avatar));

  if (!response.ok) {
    throw new ApiError("Failed to fetch avatar", response.status, null);
  }

  return response.blob();
}

/**
 * Avatar images need an Authorization header, so they can't go straight into
 * an <img src>: each one is fetched as a blob and wrapped in an object URL.
 *
 * That makes them expensive enough to share. A message list can show the same
 * sender fifty times, so the object URL is cached by path and every view gets
 * the same one — one fetch per distinct avatar per session, like `userCache`.
 * Nothing revokes on unmount: the cache owns the URL until logout.
 */
const settledAvatars = new Map(); // avatar path -> object URL, or null when it failed
const pendingAvatars = new Map(); // avatar path -> in-flight promise

/** The object URL if it's already resolved, `null` if it failed, `undefined` if unknown. */
export function peekAvatarObjectUrl(avatar) {
  if (!avatar) return null;
  return settledAvatars.has(avatar) ? settledAvatars.get(avatar) : undefined;
}

/** Fetches once per path; concurrent callers share the same request. */
export function getAvatarObjectUrl(avatar) {
  if (!avatar) return Promise.resolve(null);
  if (settledAvatars.has(avatar)) return Promise.resolve(settledAvatars.get(avatar));
  if (pendingAvatars.has(avatar)) return pendingAvatars.get(avatar);

  const pending = getAvatarBlob(avatar)
    .then((blob) => {
      const objectUrl = URL.createObjectURL(blob);
      settledAvatars.set(avatar, objectUrl);
      return objectUrl;
    })
    // A missing or forbidden avatar is cached as a miss so the initial is
    // rendered instead of the same request firing again on every re-render.
    .catch(() => {
      settledAvatars.set(avatar, null);
      return null;
    })
    .finally(() => pendingAvatars.delete(avatar));

  pendingAvatars.set(avatar, pending);
  return pending;
}

/** After an upload or removal: identity may hand back the same path with new bytes. */
export function forgetAvatar(avatar) {
  if (!avatar) return;

  const objectUrl = settledAvatars.get(avatar);
  if (objectUrl) URL.revokeObjectURL(objectUrl);

  settledAvatars.delete(avatar);
  pendingAvatars.delete(avatar);
}

function clearAvatarCache() {
  settledAvatars.forEach((objectUrl) => objectUrl && URL.revokeObjectURL(objectUrl));
  settledAvatars.clear();
  pendingAvatars.clear();
}

window.addEventListener(LOGOUT_EVENT, clearAvatarCache);

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
