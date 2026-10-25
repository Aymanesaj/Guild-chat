import { useEffect, useRef } from "react";
import styled from "styled-components";
import { TbX } from "react-icons/tb";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import { Card, IconButton, fadeIn } from "../ui";
import NotificationsPanel from "./NotificationsPanel";
import NotificationOptionsButton from "./NotificationOptionsButton";

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: var(--z-overlay);
  display: flex;
  justify-content: center;
  align-items: center;
  padding: max(4dvh, env(safe-area-inset-top)) env(safe-area-inset-right)
    max(4dvh, env(safe-area-inset-bottom)) env(safe-area-inset-left);
  overflow: hidden;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(8px);
  animation: ${fadeIn} var(--dur) var(--ease);
`;

const NotificationsCard = styled(Card)`
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: 640px;
  max-width: 90vw;
  height: 85vh;
  height: 85dvh;
  max-height: 100%;
  overflow: hidden;
  color: var(--text-primary);
`;

const Header = styled.header`
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);

  h2 {
    flex: 1;
    margin: 0;
    font-size: var(--text-md);
    font-weight: 700;
  }
`;

export default function NotificationsOverlay({ feed, rooms, onNavigate, onClose }) {
  const overlayRef = useRef(null);
  useEscapeKey(onClose);

  useEffect(() => {
    const previousFocus = document.activeElement;
    overlayRef.current.querySelector('[aria-label="Close notifications"]').focus();
    return () => {
      if (previousFocus?.isConnected && !previousFocus.closest("[inert]")) previousFocus.focus();
    };
  }, []);

  function handleKeyDown(event) {
    if (event.key !== "Tab") return;
    const buttons = [...overlayRef.current.querySelectorAll("button:not(:disabled)")];
    const first = buttons[0];
    const last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <Overlay
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <NotificationsCard
        ref={overlayRef}
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
        onKeyDown={handleKeyDown}
      >
        <Header>
          <h2>Notifications</h2>
          <NotificationOptionsButton feed={feed} />
          <IconButton type="button" onClick={onClose} aria-label="Close notifications">
            <TbX size={20} />
          </IconButton>
        </Header>
        <NotificationsPanel
          feed={feed}
          rooms={rooms}
          onNavigate={onNavigate}
          onClose={onClose}
        />
      </NotificationsCard>
    </Overlay>
  );
}
