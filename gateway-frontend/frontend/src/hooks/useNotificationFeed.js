import { useCallback, useEffect, useRef, useState } from "react";
import { onNotificationEvent, onRoomEvent } from "../api/messages";
import {
  getNotificationUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markFriendRequestNotificationsRead,
  markNotificationsRead,
  withActor,
} from "../api/notifications";
import { applyNotificationsRead } from "../utils/notifications";

const PAGE_SIZE = 20;

/**
 * The user's stored notifications, shared by the bell and profile. The unread count loads at
 * once; the list only when the Notifications section first opens (`load`). Both then follow
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
  const known = useRef(new Set());
  const readIds = useRef(new Set());
  const confirmedReads = useRef(new Set());
  const revision = useRef(0);
  const readAllRevision = useRef(0);

  const loadUnread = useCallback(() => {
    function refresh() {
      const seq = revision.current;
      getNotificationUnreadCount().then((count) => {
        if (seq === revision.current) setUnread(count);
        else refresh(); // A socket update raced the snapshot: ask for the current count.
      }).catch(() => {});
    }
    refresh();
  }, []);

  const load = useCallback(async () => {
    listed.current = true;
    const seq = revision.current;
    const readAllSeq = readAllRevision.current;
    setState("loading");
    try {
      const page = await listNotifications({ limit: PAGE_SIZE });
      page.forEach((item) => known.current.add(item.id));
      setItems((current) => {
        const refreshed = page.map((item) => ({
          ...item, read: item.read || readIds.current.has(item.id) || readAllSeq !== readAllRevision.current,
        }));
        const ids = new Set(page.map((item) => item.id));
        const arrived = seq === revision.current ? []
          : current.filter((item) => !ids.has(item.id) && (!page.length || item.id > page[0].id));
        return [...arrived, ...refreshed];
      });
      setHasMore(page.length === PAGE_SIZE);
      setState("success");
    } catch {
      setState("error");
    }
  }, []);

  const loadMore = useCallback(async () => {
    const oldest = items.at(-1);
    if (!oldest || loadingMore) return;
    const readAllSeq = readAllRevision.current;
    setLoadingMore(true);
    try {
      const page = await listNotifications({ before: oldest.id, limit: PAGE_SIZE });
      page.forEach((item) => known.current.add(item.id));
      setItems((current) => {
        const existing = new Set(current.map((item) => item.id));
        return [...current, ...page.filter((item) => !existing.has(item.id)).map((item) => ({
          ...item, read: item.read || readIds.current.has(item.id) || readAllSeq !== readAllRevision.current,
        }))];
      });
      setHasMore(page.length === PAGE_SIZE);
    } catch {
      // the button stays: try again
    } finally {
      setLoadingMore(false);
    }
  }, [items, loadingMore]);

  const applyRead = useCallback((data, updateCount = true) => {
    revision.current += 1;
    if (data.all) {
      readAllRevision.current += 1;
      known.current.forEach((id) => {
        readIds.current.add(id);
        confirmedReads.current.add(id);
      });
    }
    (data.ids ?? []).forEach((id) => {
      readIds.current.add(id);
      confirmedReads.current.add(id);
    });
    setItems((current) => applyNotificationsRead(current, data));
    if (updateCount) setUnread(data.unread ?? 0);
  }, []);

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
        applyRead(data);
        return;
      }
      if (event !== "notification.new" || !data?.id) return;
      if (known.current.has(data.id)) return;
      known.current.add(data.id);
      revision.current += 1;
      const item = { ...data, read: data.read || readIds.current.has(data.id) };
      if (!item.read) setUnread((count) => count + 1);
      // Insert before resolving the name so a concurrent read cannot be lost.
      setItems((current) => [item, ...current]);
      const named = await withActor(data).catch(() => data);
      setItems((current) => current.map((item) => item.id === named.id ? { ...named, read: item.read } : item));
    });
    return () => {
      offRooms();
      offNotifications();
    };
  }, [applyRead, load, loadUnread]);

  /** Optimistic: the server's answer (and notification.read) sets the real count. */
  const markRead = useCallback((id) => {
    const target = items.find((item) => item.id === id);
    if (!target || target.read) return;
    const seq = ++revision.current;
    readIds.current.add(id);
    setItems((current) => applyNotificationsRead(current, { ids: [id] }));
    setUnread((count) => Math.max(0, count - 1));
    markNotificationsRead([id]).then((read) => {
      if (seq === revision.current) setUnread(read.unread);
    }).catch(() => {
      if (!confirmedReads.current.has(id)) {
        readIds.current.delete(id);
        setItems((current) => current.map((item) => item.id === id ? { ...item, read: false } : item));
      }
      loadUnread();
    });
  }, [items, loadUnread]);

  const markFriendRequestsRead = useCallback(() => {
    const seq = revision.current;
    return markFriendRequestNotificationsRead().then((read) => {
      const current = seq === revision.current;
      applyRead(read, current);
      if (!current) loadUnread();
    }).catch(loadUnread);
  }, [applyRead, loadUnread]);

  const markAllRead = useCallback(() => {
    const seq = ++revision.current;
    const readAllSeq = ++readAllRevision.current;
    const previousReadIds = new Set(readIds.current);
    known.current.forEach((id) => readIds.current.add(id));
    setItems((current) => applyNotificationsRead(current, { all: true }));
    setUnread(0);
    markAllNotificationsRead().then((read) => {
      if (seq === revision.current) setUnread(read.unread);
    }).catch(() => {
      if (readAllSeq === readAllRevision.current) {
        readIds.current = new Set([...previousReadIds, ...confirmedReads.current]);
        load();
      }
      loadUnread();
    });
  }, [load, loadUnread]);

  return { unread, items, state, hasMore, loadingMore, load, loadMore, markRead, markAllRead, markFriendRequestsRead };
}
