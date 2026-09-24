import { buildQuery, request } from "./http";

/** chat-service's GET /presence, through the gateway's /api/chat/ prefix. */
const PRESENCE = "/api/chat/presence";
/** chat-service answers at most 100 ids per request. */
const MAX_IDS = 100;

/**
 * Online status for these users. A user is online while they have the app
 * open (chat-service sees their socket).
 * -> Map<userId, "online" | "offline">
 */
export async function getPresence(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const statuses = new Map();

  for (let start = 0; start < ids.length; start += MAX_IDS) {
    const chunk = ids.slice(start, start + MAX_IDS);
    const data = await request(
      `${PRESENCE}${buildQuery({ ids: chunk.join(",") })}`,
      {},
      "Failed to load online status",
    );
    Object.entries(data || {}).forEach(([id, status]) => statuses.set(id, status));
  }

  return statuses;
}
