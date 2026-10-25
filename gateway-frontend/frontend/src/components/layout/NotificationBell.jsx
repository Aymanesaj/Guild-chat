import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";
import { TbBell, TbHash } from "react-icons/tb";
import { useNotificationFeed } from "../../hooks/useNotificationFeed";
import { useUnread } from "./UnreadContext";
import { useRoomNavigation } from "./RoomNavigationContext";
import UserAvatar from "../profile/UserAvatar";
import { Button, IconButton, Spinner } from "../ui";
import {
  describeNotification,
  formatUnread,
  notificationDestination,
  timeAgo,
} from "../../utils/notifications";

const BellButton = styled(IconButton)`
  position: relative;
`;

/** Red count on the bell, and on rooms and DMs (exported for them). */
export const UnreadBadge = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: var(--radius-pill);
  background: var(--danger);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
`;

const BellBadge = styled(UnreadBadge)`
  position: absolute;
  top: -4px;
  right: -6px;
  box-shadow: 0 0 0 2px var(--bg-surface);
`;

// A portal: the sidebar is a scroll container, and on phones a drawer.
const Layer = styled.div`
  position: fixed;
  inset: 0;
  z-index: var(--z-popover);
`;

const Panel = styled.section`
  position: fixed;
  display: flex;
  flex-direction: column;
  width: min(360px, calc(100vw - 16px));
  max-height: min(70vh, 560px);
  overflow: hidden;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-lg);
`;

const PanelHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);

  h2 {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 700;
  }
`;

const PanelBody = styled.div`
  overflow-y: auto;
  padding-bottom: var(--space-2);
`;

const SectionTitle = styled.h3`
  margin: var(--space-3) var(--space-4) var(--space-1);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

const Row = styled.button`
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  border: 0;
  padding: var(--space-2) var(--space-4);
  background: ${({ $unread }) => ($unread ? "var(--accent-soft)" : "transparent")};
  color: var(--text-primary);
  font-size: var(--text-sm);
  text-align: left;
  cursor: ${({ disabled }) => (disabled ? "default" : "pointer")};

  &:hover:not(:disabled) {
    background: var(--bg-hover);
  }
`;

const RowText = styled.span`
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 2px;

  strong {
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    color: var(--text-tertiary);
    font-size: var(--text-xs);
  }
`;

const UnreadDot = styled.span`
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: 50%;
  background: ${({ $on }) => ($on ? "var(--accent-500)" : "transparent")};
`;

const Empty = styled.p`
  margin: var(--space-2) var(--space-4);
  color: var(--text-tertiary);
  font-size: var(--text-sm);
`;

const Centered = styled.div`
  display: flex;
  justify-content: center;
  padding: var(--space-3);
`;

/** The panel's spot under the bell, kept inside the window. */
function panelPosition(rect) {
  const width = Math.min(360, window.innerWidth - 16);
  return {
    top: rect.bottom + 8,
    left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
  };
}

/**
 * The bell: unread conversations (from UnreadContext) and stored
 * notifications (friend requests, rooms, roles). `rooms` names group rooms;
 * `onNavigate` is AppShell's navigateNotification.
 */
function NotificationBell({ rooms, onNavigate }) {
  const feed = useNotificationFeed();
  const { unreadConversations } = useUnread();
  const { navigateToRoom } = useRoomNavigation();
  const [position, setPosition] = useState(null);
  const triggerRef = useRef(null);
  const titleId = useId();
  const open = position !== null;
  const total = feed.unread + unreadConversations.length;
  const { load, state: feedState } = feed;

  // The list loads the first time the panel opens, then stays live.
  useEffect(() => {
    if (open && feedState === "idle") load();
  }, [open, feedState, load]);

  // Captured before the shell's listener, which would close the mobile drawer first.
  useEffect(() => {
    if (!open) return undefined;
    function handleEscape(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setPosition(null);
      triggerRef.current?.focus();
    }
    document.addEventListener("keydown", handleEscape, true);
    return () => document.removeEventListener("keydown", handleEscape, true);
  }, [open]);

  function toggle() {
    setPosition(open ? null : panelPosition(triggerRef.current.getBoundingClientRect()));
  }

  function close() {
    setPosition(null);
    triggerRef.current?.focus();
  }

  function openConversation(room) {
    setPosition(null);
    navigateToRoom(room.type === "dm"
      ? { id: room.id, name: null, type: "dm", peer: room.peer ?? null }
      : room);
  }

  function openNotification(notification) {
    feed.markRead(notification.id);
    const destination = notificationDestination(notification);
    if (!destination) return; // nothing to open: marking it read is all
    setPosition(null);
    onNavigate?.(destination);
  }

  const roomName = (roomId) => rooms.find((room) => String(room.id) === String(roomId))?.name;

  return (
    <>
      <BellButton
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-label={total ? `Notifications, ${total} unread` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Notifications"
      >
        <TbBell size={20} />
        {total > 0 && <BellBadge aria-hidden="true">{formatUnread(total)}</BellBadge>}
      </BellButton>

      {open && createPortal(
        <Layer onMouseDown={(event) => event.target === event.currentTarget && close()}>
          <Panel role="dialog" aria-labelledby={titleId} style={position}>
            <PanelHeader>
              <h2 id={titleId}>Notifications</h2>
              <Button
                type="button"
                $variant="ghost"
                $size="sm"
                onClick={feed.markAllRead}
                disabled={feed.unread === 0}
              >
                Mark all read
              </Button>
            </PanelHeader>

            <PanelBody>
              {unreadConversations.length > 0 && (
                <>
                  <SectionTitle>Unread messages</SectionTitle>
                  {unreadConversations.map(({ room, count }) => (
                    <Row key={room.id} type="button" onClick={() => openConversation(room)}>
                      {room.type === "dm" ? (
                        <UserAvatar avatar={room.peer?.avatar} name={room.peer?.username} $size={28} />
                      ) : (
                        <TbHash size={20} aria-hidden="true" />
                      )}
                      <RowText>
                        <strong>{room.type === "dm" ? room.peer?.username ?? "Direct message" : room.name}</strong>
                        <small>{count >= 100 ? "99+ new messages" : `${count} new message${count === 1 ? "" : "s"}`}</small>
                      </RowText>
                      <UnreadBadge>{formatUnread(count)}</UnreadBadge>
                    </Row>
                  ))}
                </>
              )}

              <SectionTitle>Activity</SectionTitle>
              {feed.state === "loading" && (
                <Centered><Spinner $size={20} aria-label="Loading notifications" /></Centered>
              )}
              {feed.state === "error" && (
                <Centered>
                  <Button type="button" $variant="ghost" $size="sm" onClick={feed.load}>
                    Couldn't load notifications. Retry
                  </Button>
                </Centered>
              )}
              {feed.state === "success" && feed.items.length === 0 && <Empty>Nothing new yet.</Empty>}
              {feed.items.map((notification) => (
                <Row
                  key={notification.id}
                  type="button"
                  $unread={!notification.read}
                  onClick={() => openNotification(notification)}
                >
                  <UnreadDot $on={!notification.read} aria-label={notification.read ? undefined : "Unread"} />
                  <RowText>
                    <strong title={describeNotification(notification, roomName(notification.room_id))}>
                      {describeNotification(notification, roomName(notification.room_id))}
                    </strong>
                    <small><time dateTime={notification.created_at}>{timeAgo(notification.created_at)}</time></small>
                  </RowText>
                </Row>
              ))}
              {feed.state === "success" && feed.hasMore && (
                <Centered>
                  <Button type="button" $variant="ghost" $size="sm" onClick={feed.loadMore} disabled={feed.loadingMore}>
                    {feed.loadingMore ? "Loading..." : "Show older"}
                  </Button>
                </Centered>
              )}
            </PanelBody>
          </Panel>
        </Layer>,
        document.body,
      )}
    </>
  );
}

export default NotificationBell;
