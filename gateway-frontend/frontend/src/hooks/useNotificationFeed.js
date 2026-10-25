import { useCallback, useEffect, useRef, useState } from "react";
import { onNotificationEvent, onRoomEvent } from "../api/messages";
import {
  getNotificationUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
  withActor,
} from "../api/notifications";
import { applyNotificationsRead } from "../utils/notifications";

const PAGE_SIZE = 20;

/**
 * The user's stored notifications for the bell. The unread count loads at
 * once; the list only when the panel first opens (`load`). Both then follow
 * the socket: notification.new prepends, notification.read (from any tab)
 * marks read and sets the count. A reconnect reloads what is on screen.
 */
export function useNotificationFeed() {
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState([]);
  const [state, setState] = useState("idle"); // "idle" | "loading" | "success" | "error"
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const listed = useRef(false); // the list was asked for: keep it live

  const loadUnread = useCallback(() => {
    getNotificationUnreadCount().then(setUnread).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    listed.current = true;
    setState("loading");
    try {
      const page = await listNotifications({ limit: PAGE_SIZE });
      setItems(page);
      setHasMore(page.length === PAGE_SIZE);
      setState("success");
    } catch {
      setState("error");
    }
  }, []);

  const loadMore = useCallback(async () => {
    const oldest = items.at(-1);
    if (!oldest || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listNotifications({ before: oldest.id, limit: PAGE_SIZE });
      setItems((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...page.filter((item) => !known.has(item.id))];
      });
      setHasMore(page.length === PAGE_SIZE);
    } catch {
      // the button stays: try again
    } finally {
      setLoadingMore(false);
    }
  }, [items, loadingMore]);

  useEffect(() => {
    loadUnread();
  }, [loadUnread]);

  useEffect(() => {
    const offRooms = onRoomEvent((event) => {
      if (event.type !== "resync") return;
      loadUnread();
      if (listed.current) load();
    });
    const offNotifications = onNotificationEvent(async ({ event, data }) => {
      if (event === "notification.read") {
        setItems((current) => applyNotificationsRead(current, data));
        setUnread(data.unread ?? 0);
        return;
      }
      if (event !== "notification.new" || !data?.id) return;
      if (!data.read) setUnread((count) => count + 1);
      const named = await withActor(data).catch(() => data);
      setItems((current) => (current.some((item) => item.id === named.id) ? current : [named, ...current]));
    });
    return () => {
      offRooms();
      offNotifications();
    };
  }, [load, loadUnread]);

  /** Optimistic: the server's answer (and notification.read) sets the real count. */
  const markRead = useCallback((id) => {
    const target = items.find((item) => item.id === id);
    if (!target || target.read) return;
    setItems((current) => applyNotificationsRead(current, { ids: [id] }));
    setUnread((count) => Math.max(0, count - 1));
    markNotificationsRead([id]).then((read) => setUnread(read.unread)).catch(() => {});
  }, [items]);

  const markAllRead = useCallback(() => {
    setItems((current) => applyNotificationsRead(current, { all: true }));
    setUnread(0);
    markAllNotificationsRead().then((read) => setUnread(read.unread)).catch(loadUnread);
  }, [loadUnread]);

  return { unread, items, state, hasMore, loadingMore, load, loadMore, markRead, markAllRead };
}
