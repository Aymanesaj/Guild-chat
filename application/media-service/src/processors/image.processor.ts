import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";
import { getMaxUploadBytes } from "../media/media-policy.js";
import type { MediaPurpose } from "../media/media-policy.js";

const MAX_PIXELS = 20_000_000;
const MAX_DIMENSION = 10_000;
const MAX_CONCURRENT_JOBS = 2;
const PROCESSING_TIMEOUT_SECONDS = 10;

let activeJobs = 0;

export class ImageProcessorBusyError extends Error {
  constructor() {
    super("Image processor is busy; retry later");
    this.name = "ImageProcessorBusyError";
  }
}

export async function processImage(
  input: Buffer,
  purpose: MediaPurpose,
) {
  if (input.length === 0) {
    throw new Error("Image is empty");
  }

  if (input.length > getMaxUploadBytes(purpose)) {
    throw new Error("Image exceeds the upload size limit");
  }

  if (activeJobs >= MAX_CONCURRENT_JOBS) {
    throw new ImageProcessorBusyError();
  }

  activeJobs++;

  try {
    const detectedType = await fileTypeFromBuffer(input);

    if (
      !detectedType ||
      !["jpg", "png", "webp"].includes(detectedType.ext)
    ) {
      throw new Error("Only static JPEG, PNG, and WebP are supported");
    }

    const image = sharp(input, {
      limitInputPixels: MAX_PIXELS,
      failOn: "warning",
    });

    const metadata = await image.metadata();

    if (
      !metadata.format ||
      !["jpeg", "png", "webp"].includes(metadata.format)
    ) {
      throw new Error("Unsupported image format");
    }

    if ((metadata.pages ?? 1) > 1) {
      throw new Error("Animated images are not supported");
    }

    const { width, height } = metadata;

    if (
      !width ||
      !height ||
      width > MAX_DIMENSION ||
      height > MAX_DIMENSION ||
      width * height > MAX_PIXELS
    ) {
      throw new Error("Image dimensions exceed the allowed limits");
    }

    // Apply EXIF orientation before resizing and stripping metadata.
    image.autoOrient();

    if (purpose === "AVATAR") {
      image.resize(512, 512, {
        fit: "cover",
        position: "centre",
      });
    } else {
      image.resize(2048, 2048, {
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    const { data, info } = await image
      .webp({ quality: 80 })
      .timeout({ seconds: PROCESSING_TIMEOUT_SECONDS })
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: data,
      contentType: "image/webp" as const,
      width: info.width,
      height: info.height,
      sizeBytes: data.length,
    };
  } finally {
    activeJobs--;
  }
}