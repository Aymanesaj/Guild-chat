import { requireEndpoint } from "./features";
import { buildQuery, LOGOUT_EVENT, request } from "./http";

const API_BASE = "/api/users";

/**
 * identity-service speaks camelCase; the components were written against the
 * mock's snake_case. Keep both so neither side has to know about the other.
 */
export function normalizeUser(user) {
  if (!user) return null;

  return {
    ...user,
    display_name: user.displayName ?? null,
    avatar: user.avatarUrl ?? null,
    avatar_file: user.avatarUrl ?? null,
    status: user.status ?? "offline",
  };
}

const userCache = new Map();

/** GET /api/users/{id}, cached per session — ids never change owner. */
export function getUserById(id) {
  if (!id) return Promise.resolve(null);

  if (!userCache.has(id)) {
    const pending = request(`${API_BASE}/${id}`, {}, "User not found")
      .then(normalizeUser)
      .catch((error) => {
        userCache.delete(id);
        throw error;
      });
    userCache.set(id, pending);
  }

  return userCache.get(id);
}

/** Resolves ids to users; unknown ids come back as a placeholder, never throw. */
export async function resolveUsers(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  const users = await Promise.all(
    unique.map((id) =>
      getUserById(id).catch(() => ({ id, username: "Unknown user", status: "offline" })),
    ),
  );
  return new Map(users.map((user) => [user.id, user]));
}

/** Seeds the cache with a user we already have (e.g. /me or a friends list). */
export function rememberUser(user) {
  if (user?.id) userCache.set(user.id, Promise.resolve(user));
  return user;
}

export function clearUserCache() {
  userCache.clear();
}

window.addEventListener(LOGOUT_EVENT, clearUserCache);

/** identity `GET /by-username` — not implemented yet (see features.js). */
export async function getUserByUsername(username) {
  requireEndpoint("usernameLookup");
  return request(
    `${API_BASE}/by-username${buildQuery({ username })}`,
    {},
    "User not found",
  ).then(normalizeUser);
}

/** identity `GET /check-username` — not implemented yet (see features.js). */
export async function checkUsernameAvailability(username, { signal } = {}) {
  requireEndpoint("usernameCheck");
  // -> { available: boolean }
  return request(
    `${API_BASE}/check-username${buildQuery({ username })}`,
    { signal },
    "Failed to check username",
  );
}
