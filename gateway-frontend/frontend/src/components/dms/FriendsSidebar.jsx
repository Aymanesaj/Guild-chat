import { useEffect, useState } from "react";
import styled from "styled-components";
import { useToast } from "../ui/ToastProvider";
import { TbSend, TbUsersGroup, TbX } from "react-icons/tb";

import { getFriendsList } from "../../api/friends";
import { getOrCreateDm } from "../../api/rooms";
import { usePresence } from "../../hooks/usePresence";
import { useNavDrawer } from "../layout/NavDrawerContext";
import { useRoomNavigation } from "../layout/RoomNavigationContext";
import {
  EmptyState,
  IconButton,
  InlineError,
  StatusDot,
  StatusText,
} from "../ui";
import UserAvatar from "../profile/UserAvatar";
import FriendRequestForm from "../profile/FriendRequestForm";

const FriendsSidebarRoot = styled.aside`
  display: flex;
  width: 260px;
  flex-direction: column;
  flex-shrink: 0;
  min-height: 0;
  padding: var(--space-4);
  border-left: 1px solid var(--border-subtle);
  background: var(--bg-surface);

  @media (max-width: 700px) {
    width: 100%;
    border-left: 0;
  }
`;

const SidebarHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
`;

const FriendsTitle = styled.h3`
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

const ListArea = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-top: var(--space-3);
`;

const FriendRow = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 6px var(--space-2);
  border-radius: var(--radius-sm);
  transition: background var(--dur-fast) var(--ease);

  &:hover {
    background: var(--bg-hover);
  }
`;

const AvatarWrap = styled.span`
  position: relative;
  display: block;
  flex-shrink: 0;
`;

const FriendStatus = styled(StatusDot)`
  position: absolute;
  right: -1px;
  bottom: -1px;
`;

const FriendName = styled.span`
  flex: 1;
  min-width: 0;
  color: var(--text-primary);
  font-size: var(--text-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StartForm = styled(FriendRequestForm)`
  margin: var(--space-3) auto 0;
`;

/* Friends one click away from the DM home, so starting a chat doesn't mean a
   trip through the profile overlay. */
function FriendsSidebar({ onClose }) {
  const { isPhone } = useNavDrawer();
  const { navigateToRoom } = useRoomNavigation();

  const [loading, setLoading] = useState("loading");
  const [friends, setFriends] = useState([]);
  const [openingId, setOpeningId] = useState(null);
  const toast = useToast();

  const presence = usePresence(friends.map((friend) => friend.id));

  useEffect(() => {
    let cancelled = false;

    getFriendsList()
      .then((data) => {
        if (cancelled) return;
        setFriends(Array.isArray(data) ? data : []);
        setLoading("success");
      })
      .catch(() => !cancelled && setLoading("error"));

    return () => {
      cancelled = true;
    };
  }, []);

  /* Opening the room is enough — the composer is waiting there. Navigating
     away from the DM home unmounts this panel with it. */
  const handleOpenDm = async (friend) => {
    if (openingId) return;

    setOpeningId(friend.id);

    try {
      const room = await getOrCreateDm(friend.id);
      navigateToRoom(room);
    } catch (error) {
      toast.error(error?.message || `Couldn't open a chat with ${friend.username}.`);
      setOpeningId(null);
    }
  };

  return (
    <FriendsSidebarRoot>
      <SidebarHeader>
        <FriendsTitle>Friends — {friends.length}</FriendsTitle>

        {/* Desktop closes this from the header toggle, which the drawer
            covers on a phone. */}
        {isPhone && (
          <IconButton
            type="button"
            $size={26}
            onClick={onClose}
            aria-label="Close friends"
            title="Close friends"
          >
            <TbX size={18} />
          </IconButton>
        )}
      </SidebarHeader>

      <ListArea>
        {loading === "loading" && <StatusText>Loading friends...</StatusText>}
        {loading === "error" && <InlineError>Error loading friends.</InlineError>}
        {loading === "success" &&
          (friends.length > 0 ? (
            friends.map((friend) => {
              const status = presence.get(friend.id) ?? friend.status;

              return (
                <FriendRow key={friend.id}>
                  <AvatarWrap>
                    <UserAvatar avatar={friend.avatar} name={friend.username} $size={28} />
                    <FriendStatus
                      $online={status === "online"}
                      $size={10}
                      $ring="var(--bg-surface)"
                      aria-label={status}
                    />
                  </AvatarWrap>

                  <FriendName>{friend.username}</FriendName>

                  <IconButton
                    type="button"
                    $size={26}
                    onClick={() => handleOpenDm(friend)}
                    disabled={openingId === friend.id}
                    aria-label={`Message ${friend.username}`}
                    title={`Message ${friend.username}`}
                  >
                    <TbSend size={16} />
                  </IconButton>
                </FriendRow>
              );
            })
          ) : (
            <EmptyState
              icon={TbUsersGroup}
              title="No friends yet."
              hint="Send a request to start chatting."
            >
              <StartForm />
            </EmptyState>
          ))}
      </ListArea>
    </FriendsSidebarRoot>
  );
}

export default FriendsSidebar;
