import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const BOTTOM_THRESHOLD = 48;
const TOP_THRESHOLD = 96;

/** Open at the latest message; follow updates until the reader scrolls away. */
export function useChatScroll(messages, state, currentUserId, {
  hasOlder, loadingOlder, olderError, onLoadOlder,
} = {}) {
  const scrollRef = useRef(null);
  const contentRef = useRef(null);
  const topRef = useRef(null);
  const following = useRef(true);
  const lastMessageId = useRef(null);
  const firstMessageId = useRef(null);
  const anchor = useRef(null);
  const lastScrollTop = useRef(0);
  const scrollDirection = useRef("up");
  const replyJumpCleanup = useRef(null);
  const replyHighlight = useRef(null);
  const [jumpDirection, setJumpDirection] = useState(null);

  const updateJumpVisibility = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.clientHeight - node.scrollTop;
    if (following.current || distanceFromBottom <= BOTTOM_THRESHOLD) {
      setJumpDirection(null);
    } else if (node.scrollTop <= TOP_THRESHOLD || scrollDirection.current === "down") {
      setJumpDirection("down");
    } else {
      setJumpDirection(distanceFromBottom >= node.clientHeight ? "up" : null);
    }
  }, []);

  const rememberAnchor = useCallback(() => {
    const node = scrollRef.current;
    if (!node || !contentRef.current) return;
    const top = node.getBoundingClientRect().top;
    anchor.current = null;
    for (const message of contentRef.current.querySelectorAll("[data-message-id]")) {
      const bounds = message.getBoundingClientRect();
      if (bounds.bottom > top) {
        anchor.current = { id: message.id, offset: bounds.top - top };
        break;
      }
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    following.current = true;
    node.scrollTop = node.scrollHeight;
    lastScrollTop.current = node.scrollTop;
    setJumpDirection(null);
  }, []);

  const scrollToTop = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    following.current = false;
    node.scrollTop = 0;
    lastScrollTop.current = 0;
    updateJumpVisibility();
    rememberAnchor();
  }, [rememberAnchor, updateJumpVisibility]);

  const scrollToMessage = useCallback((messageId) => {
    const node = scrollRef.current;
    const target = document.getElementById(`message-${messageId}`);
    if (!node || !target || !node.contains(target)) return false;

    replyJumpCleanup.current?.();
    replyHighlight.current?.cancel();
    // Stop following before the first smooth-scroll frame, so a resize or a
    // live message cannot pull the reader back to the bottom during the jump.
    following.current = false;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const destination = node.scrollTop + target.getBoundingClientRect().top -
      node.getBoundingClientRect().top - (node.clientHeight - target.offsetHeight) / 2;
    const top = Math.max(0, Math.min(destination, node.scrollHeight - node.clientHeight));

    let fallback;
    const cleanup = () => {
      node.removeEventListener("scrollend", highlight);
      window.clearTimeout(fallback);
      replyJumpCleanup.current = null;
    };
    const highlight = () => {
      cleanup();
      if (!target.isConnected) return;
      // Web Animations lets repeated clicks restart the effect without
      // remounting a row, and releases the normal hover styling on completion.
      replyHighlight.current = target.animate([
        { backgroundColor: "var(--bg-hover)" },
        { backgroundColor: "var(--bg-hover)", offset: reducedMotion ? 0.999 : 0.3 },
        { backgroundColor: "transparent" },
      ], { duration: reducedMotion ? 1400 : 2000, easing: "ease-out" });
    };

    replyJumpCleanup.current = cleanup;
    if (reducedMotion || Math.abs(node.scrollTop - top) < 1) {
      node.scrollTo({ top, behavior: "instant" });
      highlight();
    } else {
      node.addEventListener("scrollend", highlight, { once: true });
      // Fallback for browsers without the scrollend event.
      fallback = window.setTimeout(highlight, 900);
      node.scrollTo({ top, behavior: "smooth" });
    }
    return true;
  }, []);

  useEffect(() => () => {
    replyJumpCleanup.current?.();
    replyHighlight.current?.cancel();
  }, []);

  const onScroll = useCallback(() => {
    const node = scrollRef.current;
    // A layout change can emit scroll without the reader changing position.
    // Keep following in that case, including when a phone keyboard opens.
    if (!node || node.scrollTop === lastScrollTop.current) return;
    scrollDirection.current = node.scrollTop > lastScrollTop.current ? "down" : "up";
    lastScrollTop.current = node.scrollTop;
    following.current = node.scrollHeight - node.clientHeight - node.scrollTop <= BOTTOM_THRESHOLD;
    updateJumpVisibility();
    rememberAnchor();
  }, [rememberAnchor, updateJumpVisibility]);

  useLayoutEffect(() => {
    if (state !== "success") {
      following.current = true;
      lastMessageId.current = null;
      firstMessageId.current = null;
      anchor.current = null;
      scrollDirection.current = "up";
      setJumpDirection(null);
      return;
    }

    const latest = messages.at(-1);
    const newOwnMessage = latest && latest.id !== lastMessageId.current &&
      Boolean(currentUserId) && latest.sender_id === currentUserId;
    if (newOwnMessage) following.current = true;
    const prepended = firstMessageId.current && messages[0]?.id !== firstMessageId.current &&
      messages.some((message) => message.id === firstMessageId.current);
    if (following.current) {
      scrollToBottom();
    } else if (prepended && anchor.current && scrollRef.current) {
      // Preserve the visible message's exact position, even if a live message
      // arrives in the same render or the browser already adjusted its anchor.
      const element = document.getElementById(anchor.current.id);
      const node = scrollRef.current;
      if (element) {
        node.scrollTop += element.getBoundingClientRect().top -
          node.getBoundingClientRect().top - anchor.current.offset;
        lastScrollTop.current = node.scrollTop;
      }
      updateJumpVisibility();
    }
    firstMessageId.current = messages[0]?.id ?? null;
    lastMessageId.current = latest?.id ?? null;
    rememberAnchor();
  }, [messages, state, currentUserId, scrollToBottom, rememberAnchor, updateJumpVisibility]);

  useLayoutEffect(() => {
    if (state !== "success" || !scrollRef.current || !contentRef.current) return;

    // Track text reflow, edits, font loading and viewport/composer resizing too.
    const observer = new ResizeObserver(() => {
      if (following.current) scrollToBottom();
      else updateJumpVisibility();
      rememberAnchor();
    });
    observer.observe(scrollRef.current, { box: "border-box" });
    observer.observe(contentRef.current, { box: "border-box" });
    return () => observer.disconnect();
  }, [state, scrollToBottom, rememberAnchor, updateJumpVisibility]);

  useEffect(() => {
    if (state !== "success" || !hasOlder || loadingOlder || olderError || !topRef.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) onLoadOlder?.();
    }, { root: scrollRef.current, rootMargin: `${TOP_THRESHOLD}px 0px 0px`, threshold: 0 });
    observer.observe(topRef.current);
    return () => observer.disconnect();
  }, [state, hasOlder, loadingOlder, olderError, onLoadOlder]);

  return { scrollRef, contentRef, topRef, onScroll, scrollToTop, scrollToBottom, scrollToMessage, jumpDirection };
}
