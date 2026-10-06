export const ALLOWED_AVATAR_TYPES: Record< string, string > = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
};

export const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

export const AVATAR_DIR = process.env.AVATAR_DIR ?? "/tmp/identity-avatars";

export const AVATAR_MIME_BY_EXTENSION: Record<string, string> = {
    jpg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
};