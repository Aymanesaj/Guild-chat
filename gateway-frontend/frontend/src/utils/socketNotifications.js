import { describeNotification, notificationDestination } from "./notifications";

/** Activity toasts share stored notification ids; message toasts follow room reads. */
export function socketNotification({ event, data }, { userId, activeRoomId, users = new Map(), room }) {
  if (!userId || !data) return null;

  if (event === "notification.new") {
    if (!data.id || data.read || data.actor_id === userId) return null;
    if (["ROOM_ADDED", "ROLE_CHANGED"].includes(data.type)
      && activeRoomId != null && String(data.room_id) === String(activeRoomId)) return null;
    return {
      id: `notification:${data.id}`,
      notificationId: data.id,
      destination: notificationDestination(data),
      userIds: data.actor_id ? [data.actor_id] : [],
      message: describeNotification({
        ...data,
        actor_username: users.get(data.actor_id)?.username ?? data.actor_username ?? "Someone",
      }, room?.name),
    };
  }

  if (event !== "room.activity" || data.change !== "new") return null;
  const message = data.message;
  if (!message?.id || message.deleted || data.room_id == null
    || message.system || message.content_type === "system") return null;
  if (activeRoomId != null && String(data.room_id) === String(activeRoomId)) return null;
  if (!message.sender_id || message.sender_id === userId) return null;
  return {
    id: `message:${message.id}`,
    roomId: data.room_id,
    messageId: message.id,
    destination: { type: "room", roomId: data.room_id },
    userIds: [message.sender_id],
    message: room?.type === "group"
      ? `You have a new message from room ${room.name || data.room_id}.`
      : `You have a new message from ${users.get(message.sender_id)?.username ?? "Someone"}.`,
  };
}
