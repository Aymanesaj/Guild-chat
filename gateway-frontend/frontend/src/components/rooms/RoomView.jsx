import { useCallback, useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import RoomHeader from "./RoomHeader";
import RoomContent from "./RoomContent";
import MessageComposer from "./MessageComposer";
import MembersSidebar from "./MembersSidebar";
import { useNavDrawer } from "../layout/NavDrawerContext";
import { useProfileOverlay } from "../layout/ProfileOverlayContext";
import { useRoomMessages } from "../../hooks/useRoomMessages";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import { getCurrentUserId } from "../../api/tokens";
import { getMyRoomRole } from "../../api/rooms";
import { SlidePanel } from "../ui";

const RoomViewShell = styled.section`
  display: flex;
  height: 100%;
  min-width: 0;
  background: var(--bg-base);
`;

const RoomMain = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
`;

function RoomView({ roomId, roomName, isDm, peer, draft, onDraftChange, onSendDraft }) {
  const { isPhone, isNavOpen, closeNav } = useNavDrawer();
  const { profile, previewUser } = useProfileOverlay();

  // Keep the members panel associated with its room.
  const [membersPanel, setMembersPanel] = useState({ roomId, open: false });
  const isMembersOpen = membersPanel.roomId === roomId && membersPanel.open;

  const closeMembers = useCallback(
    () => setMembersPanel({ roomId, open: false }),
    [roomId],
  );

  // Yields Escape to anything stacked above the drawer — see AppShell.
  useEscapeKey(
    closeMembers,
    isPhone && isMembersOpen && !profile && !previewUser,
  );

  function toggleMembers() {
    const open = !isMembersOpen;
    setMembersPanel({ roomId, open });
    // Only one drawer at a time on a phone.
    if (open) closeNav();
  }

  // Reply targets belong to the current room, just like the composer draft.
  const [reply, setReply] = useState({ roomId, message: null });
  const replyingTo = reply.roomId === roomId ? reply.message : null;
  const setReplyingTo = (message) => setReply({ roomId, message });

  const {
    messages, messagesById, state, sending, send, edit, remove,
    hasOlder, loadingOlder, olderError, loadOlder,
  } = useRoomMessages(roomId);

  const [initializingDm, setInitializingDm] = useState(false);
  const handleSend = async (content, replyToId) => {
    if (!onSendDraft) return send(content, replyToId);
    setInitializingDm(true);
    try {
      await onSendDraft(content);
    } finally {
      setInitializingDm(false);
    }
  };

  // Read once per view, not once per message row.
  const currentUserId = useMemo(() => getCurrentUserId(), []);

  // Owners and admins may delete anyone's message. Tagged with its room like
  // the reply draft, so the previous room's role never applies here. DMs have
  // no moderators. If the lookup fails, only the user's own messages can be deleted.
  const [myRole, setMyRole] = useState({ roomId, role: null });
  useEffect(() => {
    if (isDm) return undefined;
    let cancelled = false;
    getMyRoomRole(roomId)
      .then((role) => !cancelled && setMyRole({ roomId, role }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [roomId, isDm]);
  const roleHere = !isDm && myRole.roomId === roomId ? myRole.role : null;
  const canModerate = roleHere === "owner" || roleHere === "admin";

  return (
    <RoomViewShell>
      <RoomMain>
        <RoomHeader
          roomName={roomName}
          isDm={isDm}
          onToggleMembers={toggleMembers}
        />

        <RoomContent
          roomChat={messages}
          state={state}
          roomName={roomName}
          isDm={isDm}
          peer={peer}
          messagesById={messagesById}
          currentUserId={currentUserId}
          hasOlder={hasOlder}
          loadingOlder={loadingOlder}
          olderError={olderError}
          onLoadOlder={loadOlder}
          onReply={setReplyingTo}
          onEdit={edit}
          canModerate={canModerate}
          onDelete={remove}
        />
        <MessageComposer
          roomId={roomId}
          roomName={roomName}
          isDm={isDm}
          text={draft}
          onTextChange={onDraftChange}
          focusEnabled={!profile && !previewUser && !isMembersOpen && !(isPhone && isNavOpen)}
          onSend={handleSend}
          disabled={sending || initializingDm}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
        />
      </RoomMain>

      {/* Still mounted only while open, so members are fetched lazily and a
          stale roster never outlives the room it came from. */}
      {!isDm && isMembersOpen && (
        <SlidePanel
          $asOverlay={isPhone}
          $open={isMembersOpen}
          $side="right"
          onClose={closeMembers}
        >
          <MembersSidebar roomId={roomId} onClose={closeMembers} />
        </SlidePanel>
      )}
    </RoomViewShell>
  );
}

export default RoomView;
