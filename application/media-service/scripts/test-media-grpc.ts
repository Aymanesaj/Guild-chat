import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  Client,
  credentials,
  Metadata,
  status,
} from "@grpc/grpc-js";
import type { ServiceDefinition } from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const identityToken = process.env.MEDIA_IDENTITY_TOKEN;
const chatToken = process.env.MEDIA_CHAT_TOKEN;

if (!identityToken || !chatToken) {
  throw new Error("Missing Media service tokens");
}

const definitions = loadSync(
  fileURLToPath(new URL("../proto/media.proto", import.meta.url)),
  {
    keepCase: false,
    enums: String,
    longs: String,
    defaults: true,
    oneofs: true,
  },
);

const service = definitions[
  "guild.media.v1.MediaService"
] as ServiceDefinition;

const client = new Client(
  `127.0.0.1:${process.env.MEDIA_GRPC_PORT ?? "50054"}`,
  credentials.createInsecure(),
);

function rpc<T>(
  method: string,
  input: object,
  token?: string,
): Promise<T> {
  const definition = service[method];

  if (!definition) {
    throw new Error(`Unknown RPC: ${method}`);
  }

  const metadata = new Metadata();

  if (token) {
    metadata.set("authorization", `Bearer ${token}`);
  }

  return new Promise((resolve, reject) => {
    client.makeUnaryRequest(
      definition.path,
      definition.requestSerialize,
      definition.responseDeserialize,
      input,
      metadata,
      { deadline: Date.now() + 60_000 },
      (error, response) => {
        if (error) {
          reject(error);
        } else {
          resolve(response as T);
        }
      },
    );
  });
}

interface UploadResponse {
  uploadId: string;
  uploadUrl: string;
  requiredContentType: string;
  expiresIn: number;
}

interface MediaResponse {
  mediaId: string;
  finalKey: string;
  contentType: string;
  width: number;
  height: number;
  status: string;
}

interface StatusResponse {
  uploadId: string;
  status: string;
  errorCode: string;
  deletionPending: boolean;
}

const ownerId = `grpc-test-${randomUUID()}`;
let mediaId: string | undefined;
let uploadId: string | undefined;
let deleted = false;
let stage = "authentication checks";

try {
  const createInput = {
    ownerId,
    purpose: "AVATAR",
    contentType: "image/png",
  };

  await assert.rejects(
    rpc("CreateUpload", createInput),
    { code: status.UNAUTHENTICATED },
  );
  console.log("PASS: missing credentials rejected");

  await assert.rejects(
    rpc("CreateUpload", createInput, randomUUID()),
    { code: status.UNAUTHENTICATED },
  );
  console.log("PASS: invalid credentials rejected");

  await assert.rejects(
    rpc("CreateUpload", createInput, chatToken),
    { code: status.PERMISSION_DENIED },
  );
  console.log("PASS: Chat cannot create avatars");

  await assert.rejects(
    rpc(
      "CreateUpload",
      { ...createInput, contentType: "text/html" },
      identityToken,
    ),
    { code: status.INVALID_ARGUMENT },
  );
  console.log("PASS: unsupported content type rejected");

  stage = "creating upload";

  const upload = await rpc<UploadResponse>(
    "CreateUpload",
    createInput,
    identityToken,
  );

  uploadId = upload.uploadId;

  const uploadInput = {
    uploadId,
    ownerId,
    purpose: "AVATAR",
  };

  const pending = await rpc<StatusResponse>(
    "GetMediaStatus",
    uploadInput,
    identityToken,
  );

  assert.equal(pending.status, "PENDING");
  console.log("PASS: upload created with PENDING status");

  stage = "ownership checks";

  await assert.rejects(
    rpc(
      "GetMediaStatus",
      { ...uploadInput, ownerId: `other-${randomUUID()}` },
      identityToken,
    ),
    { code: status.NOT_FOUND },
  );
  console.log("PASS: another owner cannot inspect the upload");

  await assert.rejects(
    rpc("FinalizeUpload", uploadInput, chatToken),
    { code: status.NOT_FOUND },
  );
  console.log("PASS: Chat cannot finalize Identity uploads");

  stage = "uploading to R2";

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

  const response = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": upload.requiredContentType,
    },
    body: new Uint8Array(image),
    signal: AbortSignal.timeout(15_000),
  });

  await response.arrayBuffer();
  assert.equal(response.ok, true, `R2 PUT HTTP ${response.status}`);

  console.log("PASS: image uploaded to R2");

  stage = "finalizing through gRPC";

  const media = await rpc<MediaResponse>(
    "FinalizeUpload",
    uploadInput,
    identityToken,
  );

  mediaId = media.mediaId;

  assert.equal(media.status, "READY");
  assert.equal(media.contentType, "image/webp");
  assert.equal(media.width, 512);
  assert.equal(media.height, 512);

  const repeated = await rpc<MediaResponse>(
    "FinalizeUpload",
    uploadInput,
    identityToken,
  );

  assert.deepEqual(repeated, media);
  console.log("PASS: finalization succeeds and is repeatable");

  stage = "deleting through gRPC";

  const deleteInput = {
    mediaId,
    ownerId,
    purpose: "AVATAR",
  };

  await assert.rejects(
    rpc("DeleteMedia", deleteInput, chatToken),
    { code: status.NOT_FOUND },
  );
  console.log("PASS: Chat cannot delete Identity media");

  await rpc("DeleteMedia", deleteInput, identityToken);
  await rpc("DeleteMedia", deleteInput, identityToken);

  const finalStatus = await rpc<StatusResponse>(
    "GetMediaStatus",
    uploadInput,
    identityToken,
  );

  assert.equal(finalStatus.status, "DELETED");
  assert.equal(finalStatus.deletionPending, false);
  deleted = true;

  console.log("PASS: deletion is repeatable and status is DELETED");
} catch (error) {
  console.error(`FAIL during: ${stage}`);

  if (error instanceof Error) {
    console.error("Error name:", error.name);

    if ("code" in error) {
      console.error("Error code:", error.code);
    }

    console.error(
      "Message:",
      error.message.replace(/https?:\/\/[^\s"'<>]+/g, "[URL redacted]"),
    );
  }

  process.exitCode = 1;
} finally {
  if (mediaId && !deleted) {
    try {
      await rpc(
        "DeleteMedia",
        { mediaId, ownerId, purpose: "AVATAR" },
        identityToken,
      );
    } catch {
      console.error(`Cleanup requires inspection: ${mediaId}`);
    }
  } else if (uploadId && !deleted) {
    console.error(`Inspect unfinished upload: ${uploadId}`);
  }

  client.close();
}
