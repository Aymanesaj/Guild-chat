import { useEffect, useState } from "react";
import DmView from "../dms/DmView";
import RoomView from "../rooms/RoomView";
import { getOrCreateDm, openDm } from "../../api/rooms";
import { onRoomEvent, sendMessage } from "../../api/messages";
import { assertMessageSize } from "../../utils/messageContent";

function MainPanel({ activeView, onRoomInitialized, onHideDm }) {
  // Kept above RoomView so drafts survive room switches and visits to the DM list.
  // This state is discarded with the signed-in app on logout.
  const [drafts, setDrafts] = useState({});

  // The peer may send first while this local conversation is open. Discover
  // that persisted room without creating one, then load and subscribe normally.
  useEffect(() => {
    if (!activeView?.isDraft) return undefined;
    let cancelled = false;
    let seq = 0;
    const refresh = async () => {
      const requestSeq = ++seq;
      try {
        const room = await openDm(activeView.peer);
        if (!cancelled && requestSeq === seq && !room.isDraft) {
          onRoomInitialized(activeView.id, room);
        }
      } catch {
        // A discovery failure leaves the local draft and its composer intact.
      }
    };
    const unsubscribe = onRoomEvent((event) => {
      if (["added", "activity", "resync"].includes(event.type)) refresh();
    });
    refresh();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [activeView, onRoomInitialized]);

  if (activeView === true) {
    return <DmView />;
  }

  const isDm = activeView.type === "dm";
  const roomName = isDm ? activeView.peer?.username ?? "Direct message" : activeView.name;
  // A DM keeps its composer (and draft) when its temporary ID becomes real.
  const peerId = activeView.peer_id ?? activeView.peer?.id;
  const roomKey = isDm && peerId ? `dm:${peerId}` : String(activeView.id);

  const sendFirstMessage = async (content) => {
    const text = content.trim();
    if (!text) return;
    assertMessageSize(text);
    const room = await getOrCreateDm(peerId);
    await sendMessage(room.id, text);
    onRoomInitialized(activeView.id, room);
  };

  const updateDraft = (value) => {
    setDrafts((current) => {
      const previous = current[roomKey] ?? "";
      const next = typeof value === "function" ? value(previous) : value;
      if (next === previous) return current;
      const updated = { ...current };
      if (next) updated[roomKey] = next;
      else delete updated[roomKey];
      return updated;
    });
  };

  return (
    <RoomView
      key={roomKey}
      roomId={activeView.isDraft ? null : activeView.id}
      roomName={roomName}
      roomDescription={activeView.description}
      isDm={isDm}
      onHideDm={isDm && !activeView.isDraft && !String(activeView.id).startsWith("draft-dm:")
        ? () => onHideDm(activeView.id) : undefined}
      peer={activeView.peer}
      draft={drafts[roomKey] ?? ""}
      onDraftChange={updateDraft}
      onSendDraft={activeView.isDraft ? sendFirstMessage : undefined}
    />
  );
}

export default MainPanel;
