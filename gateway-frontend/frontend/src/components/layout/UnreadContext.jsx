import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { onRoomEvent } from "../../api/messages";
import { getUnreadCounts, markRoomRead } from "../../api/notifications";
import { getDmRooms } from "../../api/rooms";
import { applyUnreadEvent } from "../../utils/notifications";

/**
 * Unread message counts for every conversation, groups and DMs, wherever the
 * user is in the app: the sidebar, the DM list and the bell all read them here.
 *
 * Counts load once per room from GET /rooms/unread, then follow the socket:
 * +1 for someone else's new message (unless the room is open and the tab
 * visible), and the server's count on room.read. A reconnect reloads them all.
 *
 * DM rooms are loaded here, not taken from DmView: that list only exists while
 * it is on screen, and the bell needs DM counts from anywhere.
 */
const UnreadContext = createContext({
  counts: new Map(),
  dmRooms: [],
  unreadConversations: [],
  markRead: () => {},
});

const isVisible = () => typeof document === "undefined" || document.visibilityState === "visible";

export function UnreadProvider({ userId, groupRooms, activeRoomId, children }) {
  const [counts, setCounts] = useState(() => new Map());
  const [dmRooms, setDmRooms] = useState([]);

  // Read from socket callbacks without resubscribing on every change.
  const activeKey = useRef(null);
  const loaded = useRef(new Set()); // room ids whose count is loaded or loading
  const roomIds = useRef([]);
  const lastMarked = useRef(new Map()); // room id -> newest message id sent as read

  const allIds = useMemo(
    () => [...groupRooms, ...dmRooms].map((room) => String(room.id)),
    [groupRooms, dmRooms],
  );

  useEffect(() => {
    activeKey.current = activeRoomId == null ? null : String(activeRoomId);
    roomIds.current = allIds;
  }, [activeRoomId, allIds]);

  const loadCounts = useCallback(async (ids) => {
    if (!ids.length) return;
    ids.forEach((id) => loaded.current.add(id));
    const fetched = await getUnreadCounts(ids.map(Number));
    setCounts((previous) => {
      const next = new Map(previous);
      fetched.forEach((count, id) => next.set(String(id), count));
      return next;
    });
  }, []);

  const loadDmRooms = useCallback(() => {
    getDmRooms().then(setDmRooms).catch(() => {}); // badges are optional
  }, []);

  useEffect(() => {
    loadDmRooms();
  }, [loadDmRooms]);

  // Only rooms not loaded yet: a new room, a new DM.
  useEffect(() => {
    loadCounts(allIds.filter((id) => !loaded.current.has(id)));
  }, [allIds, loadCounts]);

  useEffect(
    () =>
      onRoomEvent((event) => {
        if (event.type === "resync") {
          loaded.current = new Set();
          lastMarked.current = new Map();
          loadCounts(roomIds.current);
          loadDmRooms();
          return;
        }
        // A DM someone else opens arrives as room.added; it may be a group too.
        if (event.type === "added" || event.type === "removed") loadDmRooms();
        setCounts((previous) =>
          applyUnreadEvent(previous, event, {
            userId,
            isReading: (key) => key === activeKey.current && isVisible(),
          }),
        );
      }),
    [userId, loadCounts, loadDmRooms],
  );

  /**
   * The user has seen the room up to messageId. Clears the badge at once; the
   * server's room.read then sets the real count (newer messages may exist).
   * Message ids are ObjectIds of equal length, so string order is time order.
   */
  const markRead = useCallback((roomId, messageId) => {
    const key = String(roomId);
    if (!messageId || lastMarked.current.get(key) >= messageId) return;
    lastMarked.current.set(key, messageId);
    setCounts((previous) => (previous.get(key) ? new Map(previous).set(key, 0) : previous));
    markRoomRead(roomId, messageId).catch(() => lastMarked.current.delete(key));
  }, []);

  /** For the bell: every conversation with something unread, groups first. */
  const unreadConversations = useMemo(() => {
    const unread = (room) => counts.get(String(room.id)) > 0;
    return [
      ...groupRooms.filter(unread).map((room) => ({ room, count: counts.get(String(room.id)) })),
      ...dmRooms.filter(unread).map((room) => ({ room, count: counts.get(String(room.id)) })),
    ];
  }, [counts, groupRooms, dmRooms]);

  const value = useMemo(
    () => ({ counts, dmRooms, unreadConversations, markRead }),
    [counts, dmRooms, unreadConversations, markRead],
  );

  return <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>;
}

export function useUnread() {
  return useContext(UnreadContext);
}

/** One room's unread count (0 when unknown). */
export function useUnreadCount(roomId) {
  const { counts } = useUnread();
  return roomId == null ? 0 : counts.get(String(roomId)) ?? 0;
}
