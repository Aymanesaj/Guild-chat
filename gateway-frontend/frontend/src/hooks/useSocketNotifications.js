import { useEffect, useEffectEvent } from "react";
import { onNotificationEvent, onRoomEvent } from "../api/messages";
import { loadFriendRequestDirections } from "../api/friends";
import { getRoom } from "../api/rooms";
import { resolveUsers } from "../api/users";
import { useToast } from "../components/ui/ToastProvider";
import { socketNotification } from "../utils/socketNotifications";
import { getFriendRequestDirection, rememberFriendRequestDirection } from "../utils/friendRequestDirections";

/** One notification listener per signed-in shell; uses the existing chat socket. */
export function useSocketNotifications(userId, activeRoomId, onNavigate, rooms = []) {
  const toast = useToast();
  const findRoom = useEffectEvent((roomId) => rooms.find((room) => String(room.id) === String(roomId)));
  const describe = useEffectEvent((frame, users, room) =>
    socketNotification(frame, {
      userId, activeRoomId, users,
      room: findRoom(frame.data?.room_id) ?? room,
      requestDirection: getFriendRequestDirection(frame.data?.friendship_id),
    }),
  );
  const show = useEffectEvent((notification) =>
    toast.info(notification.message, {
      id: notification.id,
      duration: 6000,
      onActivate: () => onNavigate(notification.destination),
    }),
  );

  useEffect(() => {
    let active = true;
    const seen = new Map();
    const displayed = new Set();
    const roomLookups = new Map();
    const notificationRoom = (frame) => {
      if (frame.event !== "room.activity" || frame.data.message?.system) return undefined;
      const roomId = frame.data.room_id;
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
    const loadDirections = () => loadFriendRequestDirections()
      .catch(() => {});
    let pendingRequests = loadDirections();
    const unsubscribeRooms = onRoomEvent((event) => {
      if (event.type === "resync") pendingRequests = loadDirections();
    });
    const unsubscribe = onNotificationEvent(async (frame) => {
      if (frame.event === "friend.request.sent") {
        rememberFriendRequestDirection(frame.data?.friendship_id, "outgoing", userId);
        return;
      }
      if (frame.event === "friend.request.received") {
        rememberFriendRequestDirection(frame.data?.friendship_id, "incoming", userId);
      }
      if (frame.event === "friend.added") await pendingRequests;
      if (!active) return;
      const candidate = describe(frame);
      if (!candidate) return;
      const now = Date.now();
      const previous = seen.get(candidate.id);
      if (previous != null && now - previous < (candidate.dedupeMs ?? Infinity)) return;
      // Reserve before resolving names: redelivery may arrive while REST is in flight.
      seen.delete(candidate.id);
      seen.set(candidate.id, now);
      if (seen.size > 500) seen.delete(seen.keys().next().value);

      const [users, room] = await Promise.all([
        resolveUsers(candidate.userIds),
        notificationRoom(frame),
      ]);
      if (!active) return;
      // Recheck the current room after the lookup; the user may have navigated.
      const notification = describe(frame, users, room);
      if (!notification) return;
      displayed.add(show(notification));
    });

    return () => {
      active = false;
      unsubscribe();
      unsubscribeRooms();
      displayed.forEach(toast.dismiss);
    };
  }, [toast, userId]);
}
