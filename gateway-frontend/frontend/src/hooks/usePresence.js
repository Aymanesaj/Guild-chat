import { useEffect, useState } from "react";
import { getPresence } from "../api/presence";

/** How often the dots refresh while they're on screen. */
const REFRESH_MS = 30_000;

/**
 * Online status for the given users, fetched on mount and every 30 s after.
 * -> Map<userId, "online" | "offline">; unknown until the first answer.
 */
export function usePresence(userIds) {
  // A stable key, so a new array with the same ids doesn't refetch.
  const key = [...new Set((userIds || []).filter(Boolean))].sort().join(",");
  const [statuses, setStatuses] = useState(() => new Map());

  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;

    const load = () =>
      getPresence(key.split(","))
        .then((next) => {
          if (!cancelled) setStatuses(next);
        })
        .catch(() => {}); // keep the last known dots; the next tick retries

    load();
    const timer = setInterval(load, REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [key]);

  return statuses;
}
