// Match org-service's CreateRoomRequest and UpdateRoomRequest constraints.
export const MAX_ROOM_NAME_LENGTH = 100;
export const MAX_ROOM_DESCRIPTION_LENGTH = 500;

export function validateRoomDetails(name, description = "") {
  if (!name.trim()) return "Room name cannot be blank.";
  if (name.length > MAX_ROOM_NAME_LENGTH) {
    return `Room name cannot exceed ${MAX_ROOM_NAME_LENGTH} characters.`;
  }
  if (description.length > MAX_ROOM_DESCRIPTION_LENGTH) {
    return `Room description cannot exceed ${MAX_ROOM_DESCRIPTION_LENGTH} characters.`;
  }
  return "";
}
