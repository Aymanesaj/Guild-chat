import { useEffect } from "react";
import styled from "styled-components";
import { TbHash, TbX } from "react-icons/tb";
import { useUnread } from "./UnreadContext";
import { useRoomNavigation } from "./RoomNavigationContext";
import { UnreadBadge } from "./NotificationBell";
import UserAvatar from "../profile/UserAvatar";
import { Button, IconButton, Spinner } from "../ui";
import {
  describeNotification,
  formatUnread,
  notificationDestination,
  timeAgo,
} from "../../utils/notifications";

const Panel = styled.section`
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
`;

const PanelHeader = styled.header`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);

  h2 {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 700;
  }
`;

const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-2);
`;

const PanelBody = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: var(--space-2);

  overscroll-behavior-y: contain;
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

function NotificationsPanel({ feed, rooms, onNavigate, onClose, showCloseButton = false }) {
  const { unreadConversations } = useUnread();
  const { navigateToRoom } = useRoomNavigation();
  const { load, state } = feed;

  useEffect(() => {
    if (state === "idle") load();
  }, [state, load]);

  function openConversation(room) {
    onClose();
    navigateToRoom(room.type === "dm"
      ? { id: room.id, name: null, type: "dm", peer: room.peer ?? null }
      : room);
  }

  function openNotification(notification) {
    feed.markRead(notification.id);
    const destination = notificationDestination(notification);
    if (destination) onNavigate(destination);
  }

  const roomName = (roomId) => rooms.find((room) => String(room.id) === String(roomId))?.name;

  return (
    <Panel aria-label="Notifications">
      <PanelHeader>
        <h2>Notifications</h2>
        <HeaderActions>
          <Button
            type="button"
            $variant="ghost"
            $size="sm"
            onClick={feed.markAllRead}
            disabled={feed.unread === 0}
          >
            Mark all read
          </Button>
          {showCloseButton && (
            <IconButton type="button" onClick={onClose} aria-label="Close notifications">
              <TbX size={20} />
            </IconButton>
          )}
        </HeaderActions>
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
  );
}

export default NotificationsPanel;
