import { randomUUID } from "node:crypto";
import type { MediaPurpose } from "./media-policy.js";

export function createMediaKeys(
  purpose: MediaPurpose,
  ownerId: string,
) {
  // Permit a single safe path segment, including UUID-style IDs.
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(ownerId)) {
    throw new Error("Invalid media owner ID");
  }

  const id = randomUUID();
  const temporaryKey = `tmp/${id}/source`;

  switch (purpose) {
    case "AVATAR":
      return {
        id,
        temporaryKey,
        finalKey: `identity/users/${ownerId}/avatars/${id}.webp`,
      };

    case "CHAT_IMAGE":
      return {
        id,
        temporaryKey,
        finalKey: `chat/attachments/${id}.webp`,
      };

    default:
      throw new Error("Unsupported media purpose");
  }
}