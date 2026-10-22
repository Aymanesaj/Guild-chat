export type MediaPurpose = "AVATAR" | "CHAT_IMAGE";
export type CallerService = "IDENTITY" | "CHAT";

export type ImageContentType =
  | "image/jpeg"
  | "image/png"
  | "image/webp";

const allowedContentTypes: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

// Initial limits; confirm CHAT_IMAGE's limit with your team.
const policies = {
  AVATAR: {
    caller: "IDENTITY",
    maxBytes: 5 * 1024 * 1024,
  },
  CHAT_IMAGE: {
    caller: "CHAT",
    maxBytes: 10 * 1024 * 1024,
  },
} as const;

export function validateUploadRequest(
  caller: CallerService,
  purpose: MediaPurpose,
  contentType: string,
): ImageContentType {
  const policy = policies[purpose];

  if (!policy) {
    throw new Error("Unsupported media purpose");
  }

  if (policy.caller !== caller) {
    throw new Error("Caller is not allowed to upload this media purpose");
  }

  if (!allowedContentTypes.includes(contentType)) {
    throw new Error("Only JPEG, PNG, and WebP images are allowed");
  }

  return contentType as ImageContentType;
}

export function getMaxUploadBytes(purpose: MediaPurpose): number {
  const policy = policies[purpose];

  if (!policy) {
    throw new Error("Unsupported media purpose");
  }

  return policy.maxBytes;
}