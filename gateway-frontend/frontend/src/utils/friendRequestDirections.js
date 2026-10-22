import { getCurrentUserId } from "../api/tokens.js";

const byUser = new Map();
const MAX_REQUESTS = 500;
const storageKey = (userId) => `ft.friend-request-directions:${userId}`;

function readDirections(userId) {
  if (!byUser.has(userId)) byUser.set(userId, new Map());
  const directions = byUser.get(userId);
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey(userId)) || "[]");
    if (Array.isArray(stored)) {
      stored.forEach((entry) => {
        if (Array.isArray(entry) && typeof entry[0] === "string"
          && ["incoming", "outgoing"].includes(entry[1])) {
          directions.set(entry[0], entry[1]);
        }
      });
    }
  } catch {
    // The in-memory copy still works when browser storage is unavailable.
  }
  while (directions.size > MAX_REQUESTS) directions.delete(directions.keys().next().value);
  return directions;
}

/** Keep direction after acceptance removes the request from the pending REST list. */
export function rememberFriendRequestDirection(id, direction, userId = getCurrentUserId()) {
  if (!userId || !id || !["incoming", "outgoing"].includes(direction)) return;
  const directions = readDirections(userId);
  directions.delete(id);
  directions.set(id, direction);
  while (directions.size > MAX_REQUESTS) directions.delete(directions.keys().next().value);
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify([...directions]));
  } catch {
    // Storage is optional; requests in this tab still retain their direction.
  }
}

/** Read storage again so accepting in another tab also suppresses this tab's toast. */
export function getFriendRequestDirection(id) {
  const userId = getCurrentUserId();
  return userId ? readDirections(userId).get(id) : undefined;
}
