import DmList from "./DmList";
import { useCallback, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { TbMessageCircle, TbUsers } from "react-icons/tb";
import FriendsSidebar from "./FriendsSidebar";
import { sortDmRooms, syncDmRooms, toConversation } from "../../api/rooms";
import { usePolling } from "../../hooks/usePolling";
import { usePresence } from "../../hooks/usePresence";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import { NavToggleButton, useNavDrawer } from "../layout/NavDrawerContext";
import { useProfileOverlay } from "../layout/ProfileOverlayContext";
import { Button, SlidePanel } from "../ui";

/**
 * A DM someone else starts arrives with no notification of any kind: org-service
 * owns rooms and cannot push, so the only way to find out is to ask again. Tied
 * to this component's lifetime on purpose — MainPanel unmounts the DM view when
 * a room is opened, which stops the polling with it.
 */
const DMS_POLL_MS = 10_000;

const DmViewShell = styled.section`
  display: flex;
  height: 100%;
  min-width: 0;
  background: var(--bg-base);
`;

const DmMain = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  padding: var(--space-4);
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

/* Same trade-off as the room header's Members button: on phones the label
   gives way to the hamburger. */
const FriendsButton = styled(Button)`
  margin-left: auto;

  @media (max-width: 700px) {
    span {
      display: none;
    }
  }
`;

function DmView() {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState("loading");
  const [isFriendsOpen, setFriendsOpen] = useState(false);
  const { isPhone, closeNav } = useNavDrawer();
  const { profile, previewUser } = useProfileOverlay();

  const closeFriends = useCallback(() => setFriendsOpen(false), []);

  // Yields Escape to anything stacked above the drawer — see AppShell.
  useEscapeKey(closeFriends, isPhone && isFriendsOpen && !profile && !previewUser);

  function toggleFriends() {
    setFriendsOpen(!isFriendsOpen);
    // Only one drawer at a time on a phone.
    if (!isFriendsOpen) closeNav();
  }

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
      <DmMain>
        <PanelHeader>
          <NavToggleButton />
          <TbMessageCircle size={20} />
          <h2>Direct Messages</h2>

          <FriendsButton
            type="button"
            $variant="ghost"
            $size="sm"
            onClick={toggleFriends}
            title="Toggle friends"
            aria-label="Toggle friends"
          >
            <TbUsers size={18} />
            <span>Friends</span>
          </FriendsButton>
        </PanelHeader>

        <DmList
          conversations={withPresence}
          state={ loading }
        />
      </DmMain>

      {isFriendsOpen && (
        <SlidePanel
          $asOverlay={isPhone}
          $open={isFriendsOpen}
          $side="right"
          onClose={closeFriends}
        >
          <FriendsSidebar onClose={closeFriends} />
        </SlidePanel>
      )}
    </DmViewShell>
  );
}

export default DmView;