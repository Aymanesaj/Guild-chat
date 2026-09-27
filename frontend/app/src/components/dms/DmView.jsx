import DmList from "./DmList";
import { useCallback, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { TbMessageCircle } from "react-icons/tb";
import { sortDmRooms, syncDmRooms, toConversation } from "../../api/rooms";
import { usePolling } from "../../hooks/usePolling";
import { usePresence } from "../../hooks/usePresence";
import { NavToggleButton } from "../layout/NavDrawerContext";

/**
 * A DM someone else starts arrives with no notification of any kind: org-service
 * owns rooms and cannot push, so the only way to find out is to ask again. Tied
 * to this component's lifetime on purpose — MainPanel unmounts the DM view when
 * a room is opened, which stops the polling with it.
 */
const DMS_POLL_MS = 10_000;

const DmViewShell = styled.section`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  padding: var(--space-4);
  background: var(--bg-base);
`;

const PanelHeader = styled.header`
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-4) var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-tertiary);

  h2 {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--text-lg);
    font-weight: 600;
  }
`;

function DmView() {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState("loading");

  // syncDmRooms needs the current list to know which previews it can keep, and
  // reading it from state would either stale the closure or restart the polling
  // interval on every tick.
  const knownRooms = useRef([]);

  const loadRooms = useCallback(async () => {
    try {
      const next = await syncDmRooms(knownRooms.current);
      knownRooms.current = next;
      setRooms(next);
      setLoading("success");
    } catch {
      // A failed tick leaves the conversations already on screen; only a first
      // load with nothing to show is an error worth rendering.
      setLoading((state) => (state === "loading" ? "error" : state));
    }
  }, []);

  usePolling(loadRooms, DMS_POLL_MS);

  const conversations = useMemo(
    () => sortDmRooms(rooms).map(toConversation),
    [rooms],
  );

  const presence = usePresence(conversations.map((conversation) => conversation.userId));
  const withPresence = conversations.map((conversation) => ({
    ...conversation,
    status: presence.get(conversation.userId) ?? conversation.status,
  }));

  return (
    <DmViewShell>
      <PanelHeader>
        <NavToggleButton />
        <TbMessageCircle size={20} />
        <h2>Direct Messages</h2>
      </PanelHeader>

      <DmList
        conversations={withPresence}
        state={ loading }
      />
    </DmViewShell>
  );
}

export default DmView;