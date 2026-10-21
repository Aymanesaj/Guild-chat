import "dotenv/config";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ImageContentType } from "../media/media-policy.js";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { Readable } from "node:stream";
const endpoint = process.env.R2_ENDPOINT;
const bucket = process.env.R2_BUCKET;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
  throw new Error("Missing R2 configuration");
}

const r2 = new S3Client({
  region: "auto",
  endpoint,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
  requestChecksumCalculation: "WHEN_REQUIRED",
});

export const UPLOAD_URL_TTL_SECONDS = 300;

export const DOWNLOAD_URL_TTL_SECONDS = 300;

export async function createPresignedDownloadUrl(
  finalKey: string,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: finalKey,
    ResponseContentType: "image/webp",
    ResponseContentDisposition: "inline",
    ResponseCacheControl: "private, no-store",
  });

  return getSignedUrl(r2, command, {
    expiresIn: DOWNLOAD_URL_TTL_SECONDS,
  });
}

export async function createPresignedUploadUrl(
  temporaryKey: string,
  contentType: ImageContentType,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: temporaryKey,
    ContentType: contentType,
  });

  return getSignedUrl(r2, command, {
    expiresIn: UPLOAD_URL_TTL_SECONDS,
    signableHeaders: new Set(["content-type"]),
  });
}

const R2_TIMEOUT_MS = 15_000;

export async function getObjectInfo(key: string) {
  const result = await r2.send(
    new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
    { abortSignal: AbortSignal.timeout(R2_TIMEOUT_MS) },
  );

  return {
    sizeBytes: result.ContentLength,
    etag: result.ETag,
  };
}

export async function downloadObject(
  key: string,
  maxBytes: number,
): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("Invalid download size limit");
  }

  const signal = AbortSignal.timeout(R2_TIMEOUT_MS);

  const result = await r2.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
    { abortSignal: signal },
  );

  const body = result.Body;

  if (!(body instanceof Readable)) {
    throw new Error("R2 did not return a readable object body");
  }

  const abortDownload = () => {
    body.destroy(new Error("R2 download timed out"));
  };

  signal.addEventListener("abort", abortDownload, { once: true });

  try {
    signal.throwIfAborted();

    if (
      result.ContentLength !== undefined &&
      result.ContentLength > maxBytes
    ) {
      throw new Error("Image exceeds the upload size limit");
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;

    for await (const chunk of body) {
      signal.throwIfAborted();

      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk);

      totalBytes += buffer.length;

      if (totalBytes > maxBytes) {
        throw new Error("Image exceeds the upload size limit");
      }

      chunks.push(buffer);
    }

    signal.throwIfAborted();

    return Buffer.concat(chunks, totalBytes);
  } finally {
    signal.removeEventListener("abort", abortDownload);
    body.destroy();
  }
}

export async function uploadWebp(
  key: string,
  buffer: Buffer,
): Promise<void> {
  await r2.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: "image/webp",
      ContentLength: buffer.length,
      IfNoneMatch: "*",
    }),
    { abortSignal: AbortSignal.timeout(R2_TIMEOUT_MS) },
  );
}

export async function deleteObject(key: string): Promise<void> {
  await r2.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
    { abortSignal: AbortSignal.timeout(R2_TIMEOUT_MS) },
  );
}