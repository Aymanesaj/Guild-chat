import { useMemo, useState } from "react";
import styled from "styled-components";
import RoomHeader from "./RoomHeader";
import RoomContent from "./RoomContent";
import MessageComposer from "./MessageComposer";
import MembersSidebar from "./MembersSidebar";
import { useRoomMessages } from "../../hooks/useRoomMessages";
import { getCurrentUserId } from "../../api/tokens";

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

function RoomView({ roomId, roomName, isDm }) {
  const [isMembersOpen, setIsMembersOpen] = useState(false);
  // Tagged with the room it belongs to and read back through that tag, so a
  // half-written reply cannot follow the user into another room. Derived
  // rather than reset in an effect, which would render the stale one once.
  const [reply, setReply] = useState({ roomId, message: null });
  const replyingTo = reply.roomId === roomId ? reply.message : null;
  const setReplyingTo = (message) => setReply({ roomId, message });

  const { messages, messagesById, state, sending, send, edit } = useRoomMessages(roomId);

  // Read once per view, not once per message row.
  const currentUserId = useMemo(() => getCurrentUserId(), []);

  return (
    <RoomViewShell>
      <RoomMain>
        <RoomHeader
          roomName={roomName}
          isDm={isDm}
          onToggleMembers={() => setIsMembersOpen((open) => !open)}
        />

        <RoomContent
          roomChat={messages}
          state={state}
          roomName={roomName}
          isDm={isDm}
          messagesById={messagesById}
          currentUserId={currentUserId}
          onReply={setReplyingTo}
          onEdit={edit}
        />
        <MessageComposer
          roomName={roomName}
          isDm={isDm}
          onSend={send}
          disabled={sending}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
        />
      </RoomMain>

      {!isDm && isMembersOpen && <MembersSidebar roomId={roomId} />}
    </RoomViewShell>
  );
}

export default RoomView;