import { useState } from "react";
import DmView from "../dms/DmView";
import RoomView from "../rooms/RoomView";

function MainPanel({ activeView }) {
  // Kept above RoomView so drafts survive room switches and visits to the DM list.
  // This state is discarded with the signed-in app on logout.
  const [drafts, setDrafts] = useState({});

  if (activeView === true) {
    return <DmView />;
  }

  const isDm = activeView.type === "dm";
  const roomName = isDm ? activeView.peer?.username ?? "Direct message" : activeView.name;
  const roomKey = String(activeView.id);

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
      roomId={activeView.id}
      roomName={roomName}
      isDm={isDm}
      peer={activeView.peer}
      draft={drafts[roomKey] ?? ""}
      onDraftChange={updateDraft}
    />
  );
}

export default MainPanel;
