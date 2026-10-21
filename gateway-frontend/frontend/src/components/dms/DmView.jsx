import DmList from "./DmList";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { TbMessageCircle, TbUsers } from "react-icons/tb";
import FriendsSidebar from "./FriendsSidebar";
import { sortDmRooms, syncDmRooms, toConversation } from "../../api/rooms";
import { onRoomEvent } from "../../api/messages";
import { usePresence } from "../../hooks/usePresence";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import { NavToggleButton, useNavDrawer } from "../layout/NavDrawerContext";
import { useProfileOverlay } from "../layout/ProfileOverlayContext";
import { Button, SlidePanel } from "../ui";

/**
 * `rooms` with one room.activity event applied to its preview, or `rooms`
 * itself when the event changes nothing: a room not in the list (a group room,
 * or a DM not loaded yet), or an edit/delete of a message that is no longer
 * the one being previewed.
 *
 * Only the preview changes; DmView re-sorts by it, so a new message moves its
 * conversation to the top. An edit keeps the original sent_at, so it doesn't.
 */
function applyActivity(rooms, { roomId, change, preview }) {
  const index = rooms.findIndex((room) => Number(room.id) === Number(roomId));
  if (index === -1) return rooms;
  if (change !== "new" && rooms[index].last_message?.id !== preview.id) return rooms;

  const next = [...rooms];
  next[index] = { ...rooms[index], last_message: preview };
  return next;
}

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
  // reading it from state would stale the event callback or resubscribe on
  // every preview update.
  const knownRooms = useRef([]);

  // Socket events can trigger overlapping loads. Only the newest result is
  // kept: an older one could still list
  // a conversation that has gone away.
  const loadSeq = useRef(0);
  const loadsInFlight = useRef(0);
  // room.activity received while a load is in flight. The load started from
  // the previews as they were before, so its result would undo them; they are
  // replayed on top of it. Also catches the first message of a DM whose
  // room.added load is still running, which applyActivity would skip.
  const pendingActivity = useRef([]);

  const loadRooms = useCallback(async () => {
    const seq = ++loadSeq.current;
    loadsInFlight.current += 1;
    try {
      const synced = await syncDmRooms(knownRooms.current);
      if (seq !== loadSeq.current) return;
      const next = pendingActivity.current.reduce(applyActivity, synced);
      knownRooms.current = next;
      setRooms(next);
      setLoading("success");
    } catch {
      // A failed refresh leaves the conversations already on screen; only a first
      // load with nothing to show is an error worth rendering.
      setLoading((state) => (state === "loading" ? "error" : state));
    } finally {
      loadsInFlight.current -= 1;
      if (loadsInFlight.current === 0) pendingActivity.current = [];
    }
  }, []);

  // No polling: the list loads once on mount, then follows the chat socket
  // (onRoomEvent below) — a DM someone else starts arrives as room.added, a
  // message in any DM as room.activity, and a reconnect as resync.
  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  useEffect(
    () =>
      onRoomEvent((event) => {
        if (event.type === "activity") {
          if (loadsInFlight.current > 0) pendingActivity.current.push(event);
          const next = applyActivity(knownRooms.current, event);
          if (next !== knownRooms.current) {
            knownRooms.current = next;
            setRooms(next);
          }
          return;
        }
        // "added"/"removed" may concern a group room rather than a DM; the
        // event doesn't say, and one extra GET is cheaper than guessing wrong.
        // "updated" is ignored: nothing it can change is shown here.
        if (event.type === "added" || event.type === "removed" || event.type === "resync") {
          loadRooms();
        }
      }),
    [loadRooms],
  );

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
