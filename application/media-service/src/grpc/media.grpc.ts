import "dotenv/config";
import { fileURLToPath } from "node:url";
import { Server, ServerCredentials, status } from "@grpc/grpc-js";
import type { handleUnaryCall, ServiceDefinition } from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";
import { z } from "zod";

import { findUpload } from "../repositories/upload.repository.js";
import type { CallerService } from "../media/media-policy.js";
import {
  createServiceAuthenticator,
  ServiceAuthenticationError,
} from "./service-auth.js";

import {
  createUpload,
  finalizeUpload,
  deleteMedia,
  getDownloadUrl,
} from "../media/media.service.js";

const purposeSchema = z.enum(["AVATAR", "CHAT_IMAGE"]);
const ownerSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);

const createSchema = z.object({
  ownerId: ownerSchema,
  purpose: purposeSchema,
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});

const uploadSchema = z.object({
  uploadId: z.string().uuid(),
  ownerId: ownerSchema,
  purpose: purposeSchema,
});

const mediaSchema = z.object({
  mediaId: z.string().uuid(),
  ownerId: ownerSchema,
  purpose: purposeSchema,
});

// Explicit public errors. Unexpected errors are never exposed verbatim.
const knownErrors = new Map<string, status>([
  ["Upload not found", status.NOT_FOUND],
  ["Media not found", status.NOT_FOUND],
  [
    "Caller is not allowed to upload this media purpose",
    status.PERMISSION_DENIED,
  ],
  ["Upload has expired", status.FAILED_PRECONDITION],
  ["Upload is PROCESSING", status.ABORTED],
  ["Upload file has not been received", status.FAILED_PRECONDITION],
  ["Upload is FAILED", status.FAILED_PRECONDITION],
  ["Upload is EXPIRED", status.FAILED_PRECONDITION],
  ["Upload is DELETED", status.FAILED_PRECONDITION],
  ["Upload state changed; retry the request", status.ABORTED],
  ["Media state changed; retry deletion", status.ABORTED],
  ["Media is pending deletion", status.FAILED_PRECONDITION],
  ["Only ready media can be deleted", status.FAILED_PRECONDITION],
  ["Image exceeds the upload size limit", status.INVALID_ARGUMENT],
  ["Image is empty", status.INVALID_ARGUMENT],
  ["Only static JPEG, PNG, and WebP are supported", status.INVALID_ARGUMENT],
  ["Unsupported image format", status.INVALID_ARGUMENT],
  ["Animated images are not supported", status.INVALID_ARGUMENT],
  ["Image dimensions exceed the allowed limits", status.INVALID_ARGUMENT],
  ["Image processor is busy; retry later", status.RESOURCE_EXHAUSTED],
  [
    "Media finalization capacity reached; retry later",
    status.RESOURCE_EXHAUSTED,
  ],
  ["Media is not available for download", status.FAILED_PRECONDITION],
]);

function toRpcError(error: unknown) {
  if (error instanceof ServiceAuthenticationError) {
    return {
      code: status.UNAUTHENTICATED,
      details: "Invalid service credentials",
    };
  }

  if (error instanceof z.ZodError) {
    return {
      code: status.INVALID_ARGUMENT,
      details: "Invalid request fields",
    };
  }

  if (error instanceof Error) {
    const code = knownErrors.get(error.message);

    if (code !== undefined) {
      return { code, details: error.message };
    }
  }

  return {
    code: status.INTERNAL,
    details: "Media operation failed",
  };
}

export async function startMediaGrpcServer() {
  const authenticate = createServiceAuthenticator(
    process.env.MEDIA_IDENTITY_TOKEN ?? "",
    process.env.MEDIA_CHAT_TOKEN ?? "",
  );

  const host = process.env.MEDIA_GRPC_HOST ?? "127.0.0.1";
  const port = Number(process.env.MEDIA_GRPC_PORT ?? "50054");

  // Plaintext like the other internal gRPC services: reachable only on the private
  // Docker network (not published, not routed by Nginx); every call needs a service token.
  if (!["127.0.0.1", "0.0.0.0"].includes(host)) {
    throw new Error("MEDIA_GRPC_HOST must be 127.0.0.1 or 0.0.0.0");
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid MEDIA_GRPC_PORT");
  }

  const protoPath = fileURLToPath(
    new URL("../../proto/media.proto", import.meta.url),
  );

  const definitions = loadSync(protoPath, {
    keepCase: false,
    enums: String,
    longs: String,
    defaults: true,
    oneofs: true,
  });

  const definition = definitions["guild.media.v1.MediaService"];

  if (!definition || !("CreateUpload" in definition)) {
    throw new Error("Media gRPC service definition is missing");
  }

  function handler<T>(
    schema: z.ZodType<T>,
    operation: (caller: CallerService, input: T) => Promise<object>,
  ): handleUnaryCall<unknown, object> {
    return (call, callback) => {
      async function execute() {
        const caller = authenticate(call.metadata);
        const input = schema.parse(call.request);

        return operation(caller, input);
      }

      void execute().then(
        (result) => callback(null, result),
        (error: unknown) => {
          const rpcError = toRpcError(error);

          if (rpcError.code === status.INTERNAL) {
            // No request payloads, tokens, or signed URLs in logs.
            console.error("Media gRPC operation failed", {
              errorName: error instanceof Error ? error.name : "Unknown",
            });
          }

          callback(rpcError);
        },
      );
    };
  }

  const server = new Server({
    "grpc.max_receive_message_length": 16 * 1024,
  });

  server.addService(definition as ServiceDefinition, {
    CreateUpload: handler(createSchema, createUpload),
    FinalizeUpload: handler(uploadSchema, finalizeUpload),
    DeleteMedia: handler(mediaSchema, deleteMedia),
    GetDownloadUrl: handler(mediaSchema, getDownloadUrl),

    GetMediaStatus: handler(uploadSchema, async (caller, input) => {
      const upload = await findUpload({ ...input, caller });

      if (!upload) {
        throw new Error("Upload not found");
      }

      return {
        uploadId: upload.id,
        status: upload.status,
        errorCode: upload.errorCode ?? "",
        deletionPending: upload.finalCleanupPending,
      };
    }),
  });

  await new Promise<void>((resolve, reject) => {
    server.bindAsync(
      `${host}:${port}`,
      ServerCredentials.createInsecure(),
      (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      },
    );
  });

  return server;
}
