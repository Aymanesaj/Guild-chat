import { useState } from "react";
import styled from "styled-components";
import { useToast } from "../ui/ToastProvider";
import { Link } from "react-router-dom";
import { TbHash, TbLogout, TbMessageCircle, TbPlus } from "react-icons/tb";
import { useProfileOverlay } from "./ProfileOverlayContext";
import { createRoom } from "../../api/rooms";
import CreateRoomInput from "./CreateRoomInput";
import RoomOptionsButton from "./RoomOptionsButton";
import { useAvatarUrl } from "../../hooks/useAvatarUrl";
import { Avatar, IconButton, InlineError, StatusText } from "../ui";
import NotificationBell, { UnreadBadge } from "./NotificationBell";
import { useUnread, useUnreadCount } from "./UnreadContext";
import { formatUnread } from "../../utils/notifications";

const SidebarRoot = styled.aside`
  display: flex;
  flex-direction: column;
  width: 280px;
  flex-shrink: 0;
  padding: var(--space-4);
  border-right: 1px solid var(--border-subtle);
  background: var(--bg-surface);
`;

const SidebarHeaderBox = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
`;

const SidebarTitle = styled.h1`
  margin: 0;
  font-size: var(--text-xl);
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--accent-500);
`;

const SidebarSection = styled.section`
  padding-top: var(--space-5);
  min-height: 0;
  display: flex;
  flex-direction: column;
`;

const SectionTitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

const RoomListNav = styled.nav`
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: var(--space-2);
  overflow-y: auto;
  min-height: 0;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;

/** Shared shape for the room rows and the Direct Messages entry. */
const NavItemButton = styled.button`
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  border: 0;
  border-radius: var(--radius-sm);
  padding: var(--space-2) 10px;
  background: ${({ $active }) => ($active ? "var(--accent-soft)" : "transparent")};
  color: ${({ $active }) => ($active ? "var(--text-primary)" : "var(--text-secondary)")};
  font-size: var(--text-md);
  font-weight: ${({ $active }) => ($active ? 600 : 500)};
  text-align: left;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);

  /* Accent bar marking the active entry. */
  &::before {
    content: "";
    position: absolute;
    left: 0;
    top: 50%;
    width: 3px;
    height: ${({ $active }) => ($active ? "60%" : "0")};
    border-radius: var(--radius-pill);
    background: var(--accent-500);
    transform: translateY(-50%);
    transition: height var(--dur) var(--ease);
  }

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  svg {
    flex-shrink: 0;
    color: var(--text-tertiary);
  }

  &:hover svg,
  &[data-active="true"] svg {
    color: var(--accent-400);
  }

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

/** Pushed to the end of a nav row, before the room options button. */
const RowBadge = styled(UnreadBadge)`
  margin-left: auto;
`;

const DirectMessagesSection = styled.section`
  padding-top: var(--space-4);
`;

const RoomRow = styled.div`
  position: relative;

  > button:first-child {
    padding-right: 38px;
  }

  &:hover .room-options-trigger,
  &:focus-within .room-options-trigger {
    opacity: 1;
    pointer-events: auto;
  }
`;

const ProfilePreviewBox = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: auto;
  padding: var(--space-4) var(--space-2) var(--space-1);
  border-top: 1px solid var(--border-subtle);

  strong,
  span {
    display: block;
  }

  span {
    color: var(--text-tertiary);
    font-size: var(--text-xs);
  }
`;

const ProfileIdentity = styled.div`
  min-width: 0;
`;

const LegalLinks = styled.nav`
  display: flex;
  justify-content: center;
  gap: var(--space-3);
  padding-top: var(--space-2);
  font-size: var(--text-xs);

  a {
    color: var(--text-tertiary);
    text-decoration: none;

    &:hover {
      color: var(--text-primary);
      text-decoration: underline;
    }
  }
`;

export const ProfileName = styled.button`
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--text-primary);
  font-weight: 600;
  text-align: left;
  transition: color var(--dur-fast) var(--ease);

  &:hover {
    color: var(--accent-400);
  }
`;

/**
 * The rooms list belongs to AppShell: it is kept current for the whole session, and
 * the shell is the only place that knows both the list and the open room, which
 * is what it takes to notice we were removed from the room being viewed.
 */
function Sidebar({
  isDirectMessages,
  activeRoomId,
  rooms,
  roomsState,
  onRoomCreated,
  onRoomUpdated,
  onRoomLeft,
  onRoomChange,
  onDirectMessages,
  onLogout,
  onNavigateNotification,
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const toast = useToast();

  async function handleCreateRoom(name, description) {
    try {
      const newRoom = await createRoom(name, description);
      // Shown straight away rather than waiting for a refetch, which also stops the
      // navigation below from landing on a room the list doesn't have yet.
      onRoomCreated(newRoom);
      setCreateOpen(false);
      onRoomChange(newRoom);
      toast.success(`Room #${newRoom.name} created.`);
    } catch (err) {
      toast.error(err?.message || "Failed to create room");
    }
  }

  return (
    <SidebarRoot>
      <SidebarHeader rooms={rooms} onNavigateNotification={onNavigateNotification} />

      <DirectMessagesButton
        isDirectMessages={isDirectMessages}
        onDirectMessages={onDirectMessages}
      />

      <RoomsSection
        rooms={rooms}
        isDirectMessages={isDirectMessages}
        activeRoomId={activeRoomId}
        onRoomChange={onRoomChange}
        onRoomUpdated={onRoomUpdated}
        onRoomLeft={onRoomLeft}
        state={roomsState}
        onCreate={() => setCreateOpen((s) => !s)}
        createOpen={createOpen}
        onSubmitCreate={handleCreateRoom}
        onCancelCreate={() => setCreateOpen(false)}
      />

      <ProfilePreview onLogout={onLogout} />

      {/* Opened in a new tab so reading them doesn't drop the current room. */}
      <LegalLinks aria-label="Legal">
        <Link to="/privacy" target="_blank">Privacy Policy</Link>
        <Link to="/terms" target="_blank">Terms of Service</Link>
      </LegalLinks>
    </SidebarRoot>
  );
}

function SidebarHeader({ rooms, onNavigateNotification }) {
  return (
    <SidebarHeaderBox>
      <SidebarTitle>GuildChat</SidebarTitle>
      <NotificationBell rooms={rooms} onNavigate={onNavigateNotification} />
    </SidebarHeaderBox>
  );
}

function RoomsSection({
  rooms, isDirectMessages, activeRoomId, onRoomChange, state,
  onRoomUpdated, onRoomLeft,
  onCreate, createOpen, onSubmitCreate, onCancelCreate,
}) {
  return (
    <SidebarSection>
      <SectionTitle
        title="Rooms"
        actionLabel="Create room"
        onCreate={onCreate}
      />

      {createOpen && (
        <CreateRoomInput
          onCreate={onSubmitCreate}
          onCancel={onCancelCreate}
        />
      )}

      {state === "loading" && (
        <StatusText>Loading rooms...</StatusText>
      )}

      {state === "error" && (
        <InlineError>Error loading rooms.</InlineError>
      )}

      <RoomListNav aria-label="Rooms">
        {rooms.map((room) => (
          <RoomButton
            key={room.id}
            room={room}
            active={!isDirectMessages && activeRoomId === room.id}
            onClick={() => onRoomChange(room)}
            onRoomUpdated={onRoomUpdated}
            onRoomLeft={onRoomLeft}
          />
        ))}
      </RoomListNav>
    </SidebarSection>
  );
}

function SectionTitle({ title, actionLabel, onCreate }) {
  return (
    <SectionTitleRow>
      <span>{title}</span>
      <IconButton
        type="button"
        $size={26}
        aria-label={actionLabel}
        title={actionLabel}
        onClick={onCreate}
      >
        <TbPlus size={18} />
      </IconButton>
    </SectionTitleRow>
  );
}

function RoomButton({ room, active, onClick, onRoomUpdated, onRoomLeft }) {
  const unread = useUnreadCount(room.id);
  return (
    <RoomRow>
      <NavItemButton
        type="button"
        $active={active}
        data-active={active}
        onClick={onClick}
        title={room.description ? `${room.name} — ${room.description}` : room.name}
      >
        <TbHash size={18} />
        <span>{room.name}</span>
        {/* The open room is being read: its count is about to clear. */}
        {!active && unread > 0 && (
          <RowBadge aria-label={`${unread} unread`}>{formatUnread(unread)}</RowBadge>
        )}
      </NavItemButton>
      <RoomOptionsButton room={room} onRoomUpdated={onRoomUpdated} onRoomLeft={onRoomLeft} />
    </RoomRow>
  );
}

function DirectMessagesButton({ isDirectMessages, onDirectMessages }) {
  const { counts, dmRooms } = useUnread();
  // Conversations, not messages: "2" means two DMs are waiting.
  const waiting = dmRooms.filter((room) => counts.get(String(room.id)) > 0).length;
  return (
    <DirectMessagesSection>
      <NavItemButton
        type="button"
        $active={isDirectMessages}
        data-active={isDirectMessages}
        onClick={onDirectMessages}
        title="Direct Messages"
      >
        <TbMessageCircle size={18} />
        <span>Direct Messages</span>
        {waiting > 0 && (
          <RowBadge aria-label={`${waiting} unread conversations`}>{formatUnread(waiting)}</RowBadge>
        )}
      </NavItemButton>
    </DirectMessagesSection>
  );
}

function ProfilePreview({ onLogout }) {
  const { currentUser, openProfile } = useProfileOverlay();
  const toast = useToast();
  const { avatarUrl } = useAvatarUrl(currentUser?.avatar);
  const name = currentUser?.display_name || currentUser?.username;

  function handleOpenProfile() {
    openProfile().catch((error) => toast.error(error?.message || "Failed to load profile."));
  }

  return (
    <ProfilePreviewBox>
      <Avatar src={avatarUrl} name={name} $size={36} />

      <ProfileIdentity>
        <ProfileName onClick={handleOpenProfile}>{name}</ProfileName>
        <span>@{currentUser?.username}</span>
      </ProfileIdentity>

      <IconButton
        type="button"
        onClick={onLogout}
        aria-label="Log out"
        title="Log out"
        style={{ marginLeft: "auto" }}
      >
        <TbLogout size={18} />
      </IconButton>
    </ProfilePreviewBox>
  );
}

export default Sidebar;
