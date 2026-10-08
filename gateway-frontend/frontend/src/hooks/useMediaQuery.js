import { useCallback, useSyncExternalStore } from "react";

// Subscribes to a CSS media query from JS, for the cases where a layout choice
// has to drive behaviour — open/close state, aria, focus — and not just styling.
//
// matchMedia is an external store, so it is read through useSyncExternalStore
// rather than mirrored into state: the first render already sees the real value
// instead of painting a desktop frame on every phone load.
export function useMediaQuery(query) {
  const subscribe = useCallback(
    (onChange) => {
      if (typeof window === "undefined" || !window.matchMedia) {
        return () => {};
      }

      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);

      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return false;
    }

    return window.matchMedia(query).matches;
  }, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
