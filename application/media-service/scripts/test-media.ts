import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { prisma } from "../src/database/prisma.js";
import {
  createUpload,
  finalizeUpload,
  deleteMedia,
} from "../src/media/media.service.js";

const ownerId = `test-${randomUUID()}`;
let uploadId: string | undefined;
let deletionConfirmed = false;
let stage = "creating test image";

try {
  const image = await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 3,
      background: { r: 40, g: 100, b: 180 },
    },
  })
    .png()
    .toBuffer();

  stage = "creating upload session";

  const upload = await createUpload("IDENTITY", {
    ownerId,
    purpose: "AVATAR",
    contentType: "image/png",
  });

  uploadId = upload.uploadId;
  console.log("PASS: upload session created");

  stage = "uploading image to R2";

  const response = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": upload.requiredContentType,
    },
    body: new Uint8Array(image),
    signal: AbortSignal.timeout(15_000),
  });

  // Consume the response without logging its URL or contents.
  await response.arrayBuffer();

  if (!response.ok) {
    throw new Error(`R2 PUT returned HTTP ${response.status}`);
  }

  console.log("PASS: image uploaded to R2");

  const finalizeInput = {
    uploadId,
    ownerId,
    purpose: "AVATAR" as const,
  };

  stage = "finalizing image";

  const media = await finalizeUpload("IDENTITY", finalizeInput);

  assert.equal(media.status, "READY");
  assert.equal(media.contentType, "image/webp");
  assert.equal(media.width, 512);
  assert.equal(media.height, 512);

  console.log("PASS: image finalized");

  stage = "repeating finalization";

  const repeated = await finalizeUpload("IDENTITY", finalizeInput);

  assert.deepEqual(repeated, media);
  console.log("PASS: repeated finalization returns the same result");

  stage = "deleting media";

  const deleteInput = {
    mediaId: media.mediaId,
    ownerId,
    purpose: "AVATAR" as const,
  };

  await deleteMedia("IDENTITY", deleteInput);
  const repeatedDelete = await deleteMedia("IDENTITY", deleteInput);

  assert.equal(repeatedDelete.status, "DELETED");
  deletionConfirmed = true;

  console.log("PASS: deletion and repeated deletion succeeded");
} catch (error) {
  console.error(`FAIL during: ${stage}`);

  if (error instanceof Error) {
    // Redact any URL included in the message.
    console.error(
      error.message.replace(/https?:\/\/[^\s"'<>]+/g, "[URL redacted]"),
    );

    const cause = error.cause;

    if (cause && typeof cause === "object") {
      if ("code" in cause) {
        console.error("Cause code:", cause.code);
      }

      if ("syscall" in cause) {
        console.error("System call:", cause.syscall);
      }
    }
  }

  process.exitCode = 1;
}