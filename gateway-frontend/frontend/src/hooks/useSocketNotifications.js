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
    const seen = new Set();
    const displayed = new Set();
    const roomLookups = new Map();
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
      if (frame.event === "friend.added"
        && !getFriendRequestDirection(frame.data?.friendship_id)) await pendingRequests;
      if (!active) return;
      const candidate = describe(frame);
      if (!candidate) return;
      if (seen.has(candidate.id)) return;
      // Reserve before resolving names so redelivery cannot create two toasts.
      seen.add(candidate.id);
      if (seen.size > 500) seen.delete(seen.values().next().value);

      // Resolve names before showing the exact text, without a generic first toast.
      const [users, room] = await Promise.all([
        resolveUsers(candidate.userIds),
        notificationRoom(frame),
      ]);
      if (!active) return;
      // Recheck the current room after the lookup; the user may have navigated.
      const notification = describe(frame, users, room);
      if (notification) displayed.add(show(notification));
    });

    return () => {
      active = false;
      unsubscribe();
      unsubscribeRooms();
      displayed.forEach(toast.dismiss);
    };
  }, [toast, userId]);
}
