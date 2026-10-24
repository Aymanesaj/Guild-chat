/** Chat images. The limits mirror chat-service (4 per message) and media-service (CHAT_IMAGE). */
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGES = 4;

/** Why this file can't be attached, or null when it can. */
export function imageFileError(file) {
  if (!IMAGE_TYPES.includes(file?.type)) return "Only JPEG, PNG and WebP images are supported.";
  if (file.size > MAX_IMAGE_BYTES) return "Images must be 10 MB or less.";
  return null;
}

/**
 * The picked files that can join the `attached` ones already in the composer,
 * in order, and the first reason one was left out (null when none was).
 */
export function pickImages(picked, attached = 0) {
  const accepted = [];
  let error = null;

  for (const file of picked) {
    const problem = imageFileError(file)
      ?? (attached + accepted.length >= MAX_IMAGES ? `You can attach up to ${MAX_IMAGES} images per message.` : null);
    if (problem) error ??= problem;
    else accepted.push(file);
  }
  return { accepted, error };
}

/** One line for previews and reply quotes: a message may have images and no text. */
export function messagePreviewText(message) {
  if (!message) return "";
  if (message.deleted) return "Message deleted";
  if (message.content) return message.content;

  const images = message.attachments?.length ?? 0;
  if (images === 1) return "Image";
  if (images > 1) return `${images} images`;
  return "";
}

/** CSS aspect-ratio for an image, so its space is kept before it loads. */
export function imageAspectRatio(image) {
  return image?.width > 0 && image?.height > 0 ? `${image.width} / ${image.height}` : "4 / 3";
}
