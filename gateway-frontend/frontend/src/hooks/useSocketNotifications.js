import { useEffect, useEffectEvent, useRef } from "react";
import { onNotificationEvent, onRoomEvent } from "../api/messages";
import { getRoom } from "../api/rooms";
import { resolveUsers } from "../api/users";
import { useToast } from "../components/ui/ToastProvider";
import { socketNotification } from "../utils/socketNotifications";

/** One listener per session; activity toasts and the feed use the same notifications. */
export function useSocketNotifications(userId, activeRoomId, onNavigate, rooms = [], feed) {
  const toast = useToast();
  const displayed = useRef(new Map());
  const findRoom = useEffectEvent((roomId) => rooms.find((room) => String(room.id) === String(roomId)));
  const isRead = useEffectEvent((id) => feed?.items.some((item) => item.id === id && item.read));
  const describe = useEffectEvent((frame, users, room) =>
    socketNotification(frame, { userId, activeRoomId, users, room: findRoom(frame.data?.room_id) ?? room }),
  );
  const activate = useEffectEvent((notification) => {
    if (notification.notificationId) feed?.markRead(notification.notificationId);
    toast.dismiss(notification.id);
    displayed.current.delete(notification.id);
    if (notification.destination) onNavigate(notification.destination);
  });
  const show = useEffectEvent((notification) =>
    toast.info(notification.message, {
      id: notification.id,
      duration: 6000,
      onActivate: () => activate(notification),
    }),
  );

  // Local optimistic reads dismiss toasts immediately, before the socket echo.
  useEffect(() => {
    for (const [id, notification] of displayed.current) {
      if (notification.notificationId && feed?.items.some((item) => item.id === notification.notificationId && item.read)) {
        toast.dismiss(id);
        displayed.current.delete(id);
      }
    }
  }, [feed?.items, toast]);

  useEffect(() => {
    let active = true;
    const seen = new Set();
    const pending = new Map();
    const readIds = new Set();
    const roomReads = new Map();
    const roomLookups = new Map();
    const shown = displayed.current;
    const notificationRoom = (frame) => {
      const roomId = frame.data?.room_id;
      if (roomId == null) return undefined;
      const known = findRoom(roomId);
      if (known) return known;
      const key = String(roomId);
      if (!roomLookups.has(key)) {
        roomLookups.set(key, getRoom(roomId).catch(() => {
          roomLookups.delete(key);
          return undefined;
        }));
      }
      return roomLookups.get(key);
    };
    const alreadyRead = (notification) => notification.notificationId
      ? readIds.has(notification.notificationId) || isRead(notification.notificationId)
      : notification.messageId <= (roomReads.get(String(notification.roomId)) ?? "");
    const dismissRead = () => {
      for (const [id, notification] of shown) {
        if (alreadyRead(notification)) {
          toast.dismiss(id);
          shown.delete(id);
        }
      }
    };
    const unsubscribeRooms = onRoomEvent((event) => {
      if (event.type === "resync") {
        // Queued toasts may have been read while disconnected; the feed refetches.
        shown.forEach((_, id) => toast.dismiss(id));
        shown.clear();
        pending.forEach((notification) => { notification.cancelled = true; });
        roomLookups.clear();
      }
      if (event.type !== "read" || !event.lastReadId) return;
      const key = String(event.roomId);
      roomReads.set(key, [roomReads.get(key) ?? "", event.lastReadId].sort().at(-1));
      dismissRead();
    });
    const unsubscribe = onNotificationEvent(async (frame) => {
      if (frame.event === "notification.read") {
        (frame.data.ids ?? []).forEach((id) => readIds.add(id));
        if (frame.data.all) {
          [...shown.values(), ...pending.values()].forEach((notification) => {
            if (notification.notificationId) readIds.add(notification.notificationId);
          });
        }
        dismissRead();
        return;
      }
      if (!active) return;
      const candidate = describe(frame);
      if (!candidate || seen.has(candidate.id) || alreadyRead(candidate)) return;
      seen.add(candidate.id);
      if (seen.size > 500) seen.delete(seen.values().next().value);
      pending.set(candidate.id, candidate);
      try {
        const [users, room] = await Promise.all([
          resolveUsers(candidate.userIds).catch(() => new Map()),
          notificationRoom(frame),
        ]);
        if (!active || candidate.cancelled || alreadyRead(candidate)) return;
        const notification = describe(frame, users, room);
        if (notification) {
          show(notification);
          shown.set(notification.id, notification);
        }
      } finally {
        pending.delete(candidate.id);
      }
    });

    return () => {
      active = false;
      unsubscribe();
      unsubscribeRooms();
      shown.forEach((_, id) => toast.dismiss(id));
      shown.clear();
    };
  }, [toast, userId]);
}
