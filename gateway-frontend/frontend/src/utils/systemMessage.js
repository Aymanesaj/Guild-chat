/**
 * The sentence shown for a system message (see chat-service API_CONTRACT.md,
 * "System messages"). Uses "you" for the current user. Unknown types get a
 * neutral line so a future event type never breaks the room.
 */
const ROLE_LABELS = { OWNER: "owner", ADMIN: "admin", MEMBER: "member" };

export function describeSystemMessage(system, currentUserId) {
  if (!system) return "";

  const actorIsMe = system.actor_id === currentUserId;
  const targetIsMe = system.target_id === currentUserId;
  const actor = actorIsMe ? "You" : system.actor_username;
  const target = targetIsMe ? "you" : system.target_username;
  const targetPossessive = targetIsMe ? "your" : `${system.target_username}'s`;
  const role = ROLE_LABELS[system.role] ?? system.role;
  const previousRole =
    ROLE_LABELS[system.previous_role] ?? system.previous_role;

  switch (system.type) {
    case "ROOM_CREATED":
      return `${actor} created the room "${system.name}"`;
    case "MEMBER_JOINED":
      return `${actor} added ${target}`;
    case "MEMBER_LEFT":
      return `${actor} left`;
    case "MEMBER_KICKED":
      return `${actor} removed ${target}`;
    case "OWNERSHIP_TRANSFERRED":
      return targetIsMe
        ? "You are now the owner"
        : `${system.target_username} is now the owner`;
    case "ROLE_CHANGED":
      return `${actor} changed ${targetPossessive} role from ${previousRole} to ${role}`;
    case "ROOM_RENAMED":
      return `${actor} renamed the room to "${system.name}"`;
    default:
      return "Room updated";
  }
}
