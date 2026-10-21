import { useEffect, useState } from "react";

// Match chat-service MessageService.EDIT_WINDOW: now < created_at + 15 minutes.
const EDIT_WINDOW_MS = 15 * 60 * 1000;

export function useMessageEditWindow(sentAt, enabled) {
  const deadline = sentAt ? Date.parse(sentAt) + EDIT_WINDOW_MS : NaN;
  const [checkedAt, setCheckedAt] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled || !Number.isFinite(deadline)) return undefined;
    let timer;
    const refresh = () => {
      window.clearTimeout(timer);
      const now = Date.now();
      setCheckedAt(now);
      const remaining = deadline - now;
      if (remaining > 0) {
        timer = window.setTimeout(refresh, Math.min(remaining, EDIT_WINDOW_MS));
      }
    };

    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [deadline, enabled]);

  return enabled && checkedAt < deadline;
}
