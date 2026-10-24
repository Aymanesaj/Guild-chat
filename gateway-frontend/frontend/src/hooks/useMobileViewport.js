import { useLayoutEffect, useRef } from "react";

/** Fit chat above the keyboard; keep the navigation drawer's layout stable. */
export function useMobileViewport(isPhone, isNavOpen = false) {
  const rootRef = useRef(null);
  const expandedViewportRef = useRef(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    if (!isPhone) {
      expandedViewportRef.current = null;
      root.style.removeProperty("--app-viewport-height");
      root.style.removeProperty("--app-viewport-top");
      return undefined;
    }
    const viewport = window.visualViewport;
    const resize = () => {
      // Pinch zoom should magnify the page rather than trigger a new layout.
      if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
      const height = viewport?.height ?? window.innerHeight;
      const width = window.innerWidth;
      const expanded = expandedViewportRef.current;
      // Remember the full height even while chat is fitted above the keyboard.
      // Reset on width changes so rotation doesn't reuse the old orientation.
      const expandedHeight = expanded?.width === width
        ? Math.max(expanded.height, height)
        : height;
      expandedViewportRef.current = { width, height: expandedHeight };

      // A drawer opened from a focused composer must restore the full height,
      // rather than freeze the reduced height left by the chat keyboard.
      root.style.setProperty("--app-viewport-height", `${isNavOpen ? expandedHeight : height}px`);
      root.style.setProperty("--app-viewport-top", `${isNavOpen ? 0 : viewport?.offsetTop ?? 0}px`);
    };
    resize();
    window.addEventListener("resize", resize);
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);
    return () => {
      window.removeEventListener("resize", resize);
      viewport?.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", resize);
    };
  }, [isPhone, isNavOpen]);

  return rootRef;
}
