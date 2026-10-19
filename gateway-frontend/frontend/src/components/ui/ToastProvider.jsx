import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styled, { keyframes } from "styled-components";
import { TbAlertCircle, TbCircleCheck, TbX } from "react-icons/tb";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { PHONE_QUERY } from "../../constants/breakpoints";

const ToastContext = createContext(null);
const MAX_TOASTS = 4;
const EXIT_MS = 180;

/**
 * Shared feedback surface for actions and future notification events.
 * useToast().error(message) / .success(message) return a dismissible ID.
 * .notify({ id, message, type, duration }) deduplicates IDs; duration: 0 persists.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);
  const isPhone = useMediaQuery(PHONE_QUERY);
  // Only mounted toasts start their timers, so queued messages get time to be read.
  const visibleToasts = toasts.slice(0, isPhone ? 1 : MAX_TOASTS);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(({ message, type = "success", duration, id }) => {
    if (!message) return;
    const toast = {
      id: id ?? `toast-${++nextId.current}`,
      message,
      type,
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
    dismiss,
  }), [notify, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <Viewport aria-label="Notifications">
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
  const Icon = isError ? TbAlertCircle : TbCircleCheck;

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
      $error={isError}
      $exiting={exiting}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <Icon size={18} aria-hidden="true" />
      <ToastContent role={isError ? "alert" : "status"} aria-atomic="true">
        {toast.message}
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
    top: calc(72px + env(safe-area-inset-top));
    bottom: auto;
    left: max(var(--space-4), env(safe-area-inset-left));
    right: max(var(--space-4), env(safe-area-inset-right));
    width: auto;
    max-height: calc(100dvh - 88px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
  }
`;

const ToastCard = styled.div`
  --toast-color: ${({ $error }) => $error ? "var(--danger)" : "var(--success)"};
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

  > svg { flex-shrink: 0; color: var(--toast-color); }
`;

const ToastContent = styled.div`
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--text-primary);
  overflow-wrap: anywhere;
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
`;
