import { useEffect } from "react";

/**
 * Closes the topmost thing on Escape.
 *
 * Several overlays listen on the document at once — a profile preview can sit
 * over an open drawer — so one keypress would otherwise close all of them. The
 * contract: skip an event someone else already handled, then mark it handled.
 * Whoever React ran first wins, which is the most recently mounted listener.
 */
export function useEscapeKey(onEscape, enabled = true) {
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      onEscape();
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onEscape, enabled]);
}
