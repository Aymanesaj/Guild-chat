import { useEffect, useState } from "react";
import { subscribeToPresence } from "../api/messages";

/**
 * Online status for visible users, from the shared chat socket.
 * Subscribing and reconnecting return a snapshot; subsequent changes are pushed.
 * -> Map<userId, "online" | "offline">; unknown until the snapshot arrives.
 */
export function usePresence(userIds) {
  const key = [...new Set((userIds || []).filter(Boolean))].sort().join(",");
  const [statuses, setStatuses] = useState(() => new Map());

  useEffect(() => {
    setStatuses(new Map());
    if (!key) return undefined;
    let cancelled = false;
    const unsubscribe = subscribeToPresence(key.split(","), ({ userId, status }) => {
      if (!cancelled) {
        setStatuses((previous) => new Map(previous).set(userId, status));
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [key]);

  return statuses;
}
