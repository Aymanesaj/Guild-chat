import { useLayoutEffect, useRef } from "react";

/** Fit the phone shell above the keyboard, including browsers that pan the viewport. */
export function useMobileViewport(isPhone) {
  const rootRef = useRef(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!isPhone || !root) return undefined;
    const viewport = window.visualViewport;
    const resize = () => {
      // Pinch zoom should magnify the page rather than trigger a new layout.
      if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
      root.style.setProperty("--app-viewport-height", `${viewport?.height ?? window.innerHeight}px`);
      root.style.setProperty("--app-viewport-top", `${viewport?.offsetTop ?? 0}px`);
    };
    resize();
    window.addEventListener("resize", resize);
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);
    return () => {
      window.removeEventListener("resize", resize);
      viewport?.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", resize);
      root.style.removeProperty("--app-viewport-height");
      root.style.removeProperty("--app-viewport-top");
    };
  }, [isPhone]);

  return rootRef;
}
