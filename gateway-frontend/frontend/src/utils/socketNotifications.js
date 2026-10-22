import { describeSystemMessage } from "./systemMessage.js";

/** Convert notification candidates to display text; all other frames stay quiet. */
export function socketNotification({ event, data }, { userId, activeRoomId, users = new Map(), requestDirection, room }) {
  if (!userId || !data) return null;
  const username = (id) => users.get(id)?.username ?? "Someone";

  if (event === "friend.request.received" || event === "friend.added") {
    if (!data.friendship_id || !data.user_id || data.user_id === userId) return null;
    // Suppress the accepting side; a missing cache must not drop a real friendship event.
    if (event === "friend.added" && requestDirection === "incoming") return null;
    return {
      id: `${event}:${data.friendship_id}`,
      destination: { type: "profile", tab: event === "friend.request.received" ? "requests" : "friends" },
      userIds: [data.user_id],
      message: event === "friend.request.received"
        ? `${username(data.user_id)} sent you a friend request.`
        : requestDirection === "outgoing"
          ? `${username(data.user_id)} accepted your friend request.`
          : `You and ${username(data.user_id)} are now friends.`,
    };
  }

  if (event === "room.added" || event === "room.removed") {
    if (data.room_id == null) return null;
    return {
      id: `${event}:${data.room_id}`,
      destination: event === "room.added" ? { type: "room", roomId: data.room_id } : { type: "conversations" },
      // Access changes have no unique event ID. A later rejoin/removal is legitimate.
      dedupeMs: 5000,
      userIds: [],
      message: event === "room.added"
        ? "A room is now available in your conversations."
        : "You no longer have access to a room.",
    };
  }

  if (event !== "room.activity" || data.change !== "new") return null;
  const message = data.message;
  if (!message?.id || message.deleted || data.room_id == null) return null;
  if (activeRoomId != null && String(data.room_id) === String(activeRoomId)) return null;

  const system = message.system;
  if (system) {
    if (system.actor_id === userId) return null;
    // room.added already tells the newly added member about their room access.
    if (system.type === "MEMBER_JOINED" && system.target_id === userId) return null;
    return {
      id: `message:${message.id}`,
      destination: { type: "room", roomId: data.room_id },
      userIds: [system.actor_id, system.target_id].filter(Boolean),
      message: describeSystemMessage({
        ...system,
        actor_username: username(system.actor_id),
        target_username: username(system.target_id),
      }, userId),
    };
  }

  if (!message.sender_id || message.sender_id === userId || message.content_type === "system") return null;
  return {
    id: `message:${message.id}`,
    destination: { type: "room", roomId: data.room_id },
    userIds: [message.sender_id],
    message: room?.type === "group"
      ? room.name ? `New message in ${room.name}.` : "New message in a room."
      : room?.type === "dm" ? `${username(message.sender_id)} sent a new message.` : "New message.",
  };
}
