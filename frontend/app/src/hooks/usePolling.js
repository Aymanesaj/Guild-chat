import { useEffect, useRef } from "react";

/**
 * Runs `callback` once now and every `intervalMs` after, for as long as the
 * component is mounted. `resetKey` re-runs it immediately and restarts the
 * cadence, so a local change doesn't have to wait for the next tick.
 *
 * Timing only: the callback owns its state, its merge rules and its errors. The
 * two lists that poll here reconcile differently (rooms replace wholesale, DMs
 * merge by id), so a shared list-state shape would fight both.
 *
 * A hidden tab doesn't poll — at a 10 s cadence a forgotten background tab
 * would otherwise make six requests a minute for as long as it stays open.
 * Becoming visible runs the callback at once, which is also what makes coming
 * back to a stale tab update immediately instead of up to `intervalMs` later.
 */
export function usePolling(callback, intervalMs, resetKey) {
  // In a ref so a callback that closes over fresh state doesn't tear down and
  // restart the interval on every render. Updated in its own effect, declared
  // first so it has already run by the time the interval below starts.
  const latest = useRef(callback);

  useEffect(() => {
    latest.current = callback;
  }, [callback]);

  useEffect(() => {
    let cancelled = false;
    let running = false;

    /**
     * `force` runs even while hidden: the first load has to happen so the view
     * isn't stuck on its loading state when opened in a background tab.
     *
     * Overlapping runs are skipped rather than queued. On a slow connection
     * they would double the request count and could apply responses out of
     * order, and the next tick is only seconds away.
     */
    async function run(force) {
      if (cancelled || running || (!force && document.hidden)) return;

      running = true;
      try {
        await latest.current();
      } catch {
        // The callback reports its own failures; a thrown one shouldn't stop
        // the interval, because the next tick is the retry.
      } finally {
        running = false;
      }
    }

    function handleVisibility() {
      if (!document.hidden) run(true);
    }

    run(true);
    const timer = setInterval(run, intervalMs);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [intervalMs, resetKey]);
}
