export const MAX_MESSAGE_BYTES = 4000;
export const MAX_MESSAGE_INPUT_BYTES = 5000;
export const MESSAGE_SIZE_ERROR = "Messages cannot exceed 4,000 bytes.";

const encoder = new TextEncoder();

export function messageByteLength(content) {
  return encoder.encode(content).byteLength;
}

/** Bound typing and pastes without cutting a Unicode code point in half. */
export function limitMessageInput(content, maxBytes = MAX_MESSAGE_INPUT_BYTES) {
  const candidate = content.slice(0, maxBytes);
  if (messageByteLength(candidate) <= maxBytes) return candidate;

  let bytes = 0;
  let end = 0;
  for (const character of candidate) {
    bytes += messageByteLength(character);
    if (bytes > maxBytes) break;
    end += character.length;
  }
  return candidate.slice(0, end);
}

export function assertMessageSize(content) {
  if (messageByteLength(content) > MAX_MESSAGE_BYTES) {
    throw new Error(MESSAGE_SIZE_ERROR);
  }
}
