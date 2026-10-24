/** Only external friend requests, acceptances, room additions and new messages notify. */
export function socketNotification({ event, data }, { userId, activeRoomId, users = new Map(), requestDirection, room }) {
  if (!userId || !data) return null;
  const username = (id) => users.get(id)?.username ?? "Someone";

  if (event === "friend.request.received" || event === "friend.added") {
    if (!data.friendship_id || !data.user_id || data.user_id === userId) return null;
    // Direction is recorded when sending, receiving or loading pending requests.
    // Keep the accepting side silent, including when direction is unknown.
    if (event === "friend.added" && requestDirection !== "outgoing") return null;
    return {
      id: `${event}:${data.friendship_id}`,
      destination: { type: "profile", tab: event === "friend.request.received" ? "requests" : "friends" },
      userIds: event === "friend.added" ? [data.user_id] : [],
      message: event === "friend.request.received"
        ? "you got a new friend request"
        : `${username(data.user_id)} accepted your friend request.`,
    };
  }

  if (event !== "room.activity" || data.change !== "new") return null;
  const message = data.message;
  if (!message?.id || message.deleted || data.room_id == null) return null;
  const system = message.system;
  const addedToRoom = system?.type === "MEMBER_JOINED" && system.target_id === userId;
  if (!addedToRoom && activeRoomId != null && String(data.room_id) === String(activeRoomId)) return null;

  if (system) {
    if (!addedToRoom || !system.actor_id || system.actor_id === userId) return null;
    return {
      id: `room.added:${message.id}`,
      destination: { type: "room", roomId: data.room_id },
      userIds: [system.actor_id],
      message: `${username(system.actor_id)} added you to room ${room?.name || data.room_id}.`,
    };
  }

  if (!message.sender_id || message.sender_id === userId || message.content_type === "system") return null;
  return {
    id: `message:${message.id}`,
    destination: { type: "room", roomId: data.room_id },
    userIds: [message.sender_id],
    message: room?.type === "group"
      ? `You have a new message from room ${room.name || data.room_id}.`
      : `You have a new message from ${username(message.sender_id)}.`,
  };
}
