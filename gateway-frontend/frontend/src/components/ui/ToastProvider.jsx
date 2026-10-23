import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styled, { keyframes } from "styled-components";
import { TbAlertCircle, TbBell, TbCircleCheck, TbX } from "react-icons/tb";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { PHONE_QUERY } from "../../constants/breakpoints";

const ToastContext = createContext(null);
const MAX_TOASTS = 4;
const EXIT_MS = 180;
const DEFAULT_COMPOSER_HEIGHT = 88;

/**
 * Shared feedback surface for actions and live notifications.
 * useToast().error(message) / .success(message) / .info(message) return a dismissible ID.
 * .notify({ id, message, type, duration }) deduplicates IDs; duration: 0 persists.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [anchor, setAnchor] = useState(null);
  const viewportRef = useRef(null);
  const nextId = useRef(0);
  const isPhone = useMediaQuery(PHONE_QUERY);
  // Only mounted toasts start their timers, so queued messages get time to be read.
  const visibleToasts = toasts.slice(0, isPhone ? 1 : MAX_TOASTS);

  useEffect(() => {
    if (!isPhone) return undefined;
    const viewport = window.visualViewport;
    const position = () => {
      const visibleTop = viewport?.offsetTop ?? 0;
      const visibleBottom = visibleTop + (viewport?.height ?? window.innerHeight);
      const keyboardInset = Math.max(0, window.innerHeight - visibleBottom);
      const bounds = anchor?.getBoundingClientRect();
      const anchorVisible = bounds?.height > 0 && bounds.top < visibleBottom && bounds.bottom > visibleTop;
      // Reserve the normal input area on every screen, including views with
      // no composer. A taller reply bar can still move the toast farther up.
      const bottom = Math.max(
        keyboardInset + DEFAULT_COMPOSER_HEIGHT,
        anchorVisible ? window.innerHeight - bounds.top : 0,
      ) + 16;
      viewportRef.current?.style.setProperty("--toast-bottom", `${bottom}px`);
      viewportRef.current?.style.setProperty("--toast-max-height", `${Math.max(44, window.innerHeight - bottom - visibleTop - 16)}px`);
    };
    position();
    // The reply bar changes the composer's height; mobile keyboards change
    // the visual viewport even when the layout viewport stays the same size.
    const observer = anchor ? new ResizeObserver(position) : null;
    if (anchor) observer.observe(anchor);
    window.addEventListener("resize", position);
    viewport?.addEventListener("resize", position);
    viewport?.addEventListener("scroll", position);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", position);
      viewport?.removeEventListener("resize", position);
      viewport?.removeEventListener("scroll", position);
    };
  }, [anchor, isPhone]);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  // Enrich an existing toast without resetting its timer or restoring a dismissed one.
  const update = useCallback((id, message) => {
    if (!message) return;
    setToasts((current) => current.map((toast) =>
      toast.id === id ? { ...toast, message } : toast,
    ));
  }, []);

  const notify = useCallback(({ message, type = "success", duration, id, onActivate }) => {
    if (!message) return;
    const toast = {
      id: id ?? `toast-${++nextId.current}`,
      message,
      type,
      onActivate,
      duration: duration ?? (type === "error" ? 6500 : 4500),
    };
    setToasts((current) => {
      if (current.some((item) => item.id === toast.id)) return current;
      return [...current, toast];
    });
    return toast.id;
  }, []);

  const api = useMemo(() => ({
    notify,
    error: (message, options) => notify({ ...options, message, type: "error" }),
    success: (message, options) => notify({ ...options, message, type: "success" }),
    info: (message, options) => notify({ ...options, message, type: "info" }),
    update,
    dismiss,
    setAnchor,
  }), [notify, update, dismiss, setAnchor]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <Viewport ref={viewportRef} aria-label="Notifications">
          {visibleToasts.map((toast) => <Toast key={toast.id} toast={toast} onDismiss={dismiss} />)}
        </Viewport>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error("useToast must be used within ToastProvider");
  return toast;
}

function Toast({ toast, onDismiss }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [exiting, setExiting] = useState(false);
  const remaining = useRef(toast.duration);
  const isError = toast.type === "error";
  const Icon = isError ? TbAlertCircle : toast.type === "info" ? TbBell : TbCircleCheck;

  useEffect(() => {
    if (!toast.duration || hovered || focused || exiting) return;
    const started = performance.now();
    const timer = window.setTimeout(() => setExiting(true), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (performance.now() - started));
    };
  }, [toast.duration, hovered, focused, exiting]);

  useEffect(() => {
    if (!exiting) return;
    const timer = window.setTimeout(() => onDismiss(toast.id), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [exiting, onDismiss, toast.id]);

  return (
    <ToastCard
      $type={toast.type}
      $exiting={exiting}
      // Touch browsers can leave compatibility mouse hover active after a tap,
      // pinning this toast and blocking the phone's single-toast queue.
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <ToastContent role={isError ? "alert" : "status"} aria-atomic="true">
        <ToastBody
          as={toast.onActivate ? "button" : "div"}
          type={toast.onActivate ? "button" : undefined}
          $actionable={Boolean(toast.onActivate)}
          onClick={toast.onActivate ? () => {
            if (exiting) return;
            setExiting(true);
            toast.onActivate();
          } : undefined}
        >
          <Icon size={18} aria-hidden="true" />
          <span>{toast.message}</span>
        </ToastBody>
      </ToastContent>
      <CloseButton type="button" onClick={() => setExiting(true)} aria-label="Dismiss notification">
        <TbX size={16} aria-hidden="true" />
      </CloseButton>
    </ToastCard>
  );
}

const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
`;

const fadeAway = keyframes`
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(-8px); }
`;

const Viewport = styled.section`
  position: fixed;
  left: max(var(--space-4), env(safe-area-inset-left));
  bottom: calc(104px + env(safe-area-inset-bottom));
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: min(248px, calc(100vw - 32px));
  max-height: calc(100dvh - 128px - env(safe-area-inset-bottom));
  overflow-x: hidden;
  overflow-y: auto;
  /* The fade-up transform briefly extends past the viewport's scroll bounds. */
  scrollbar-width: none;
  pointer-events: none;

  &::-webkit-scrollbar {
    display: none;
  }

  @media ${PHONE_QUERY} {
    top: auto;
    bottom: max(var(--toast-bottom, 104px), calc(104px + env(safe-area-inset-bottom)));
    left: max(var(--space-4), env(safe-area-inset-left));
    right: max(var(--space-4), env(safe-area-inset-right));
    width: auto;
    max-width: 420px;
    margin-inline: auto;
    max-height: var(--toast-max-height, calc(100dvh - 32px));
  }
`;

const ToastCard = styled.div`
  --toast-color: ${({ $type }) => $type === "error" ? "var(--danger)" : $type === "info" ? "var(--info)" : "var(--success)"};
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-2);
  padding: 10px var(--space-3);
  border: 1px solid color-mix(in srgb, var(--toast-color) 45%, var(--border-strong));
  border-left: 3px solid var(--toast-color);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--toast-color) 12%, var(--bg-elevated));
  box-shadow: var(--shadow-md);
  pointer-events: auto;
  animation: ${({ $exiting }) => $exiting ? fadeAway : fadeUp}
    ${({ $exiting }) => $exiting ? `${EXIT_MS}ms` : "240ms"} var(--ease) both;

`;

const ToastContent = styled.div`
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--text-primary);
  overflow-wrap: anywhere;
`;

const ToastBody = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  overflow-wrap: anywhere;
  cursor: ${({ $actionable }) => $actionable ? "pointer" : "inherit"};

  > svg { flex-shrink: 0; color: var(--toast-color); }
  > span { min-width: 0; }
  &:hover > span { text-decoration: ${({ $actionable }) => $actionable ? "underline" : "none"}; }
  &:focus-visible { outline-color: var(--toast-color); }

  @media ${PHONE_QUERY} {
    min-height: 44px;
  }
`;

const CloseButton = styled.button`
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);

  &:hover { background: var(--bg-hover); color: var(--text-primary); }

  @media ${PHONE_QUERY} {
    width: 44px;
    height: 44px;
  }
`;
