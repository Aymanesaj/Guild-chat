
import type {
  FastifyRequest,
  FastifyReply,
} from "fastify";

import { z } from "zod";

import {
  requestAvatarUpload,
} from "../services/avatar-upload.service.js";

const uploadUrlSchema = z.object({
  contentType: z.enum([
    "image/jpeg",
    "image/png",
    "image/webp",
  ]),
}).strict();

export async function createAvatarUploadController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!request.userId) {
    return reply.code(401).send({
      error: "Unauthorized",
    });
  }

  const parsed = uploadUrlSchema.safeParse(
    request.body,
  );

  if (!parsed.success) {
    return reply.code(400).send({
      error: "Invalid content type",
    });
  }

  const result = await requestAvatarUpload(
    request.userId,
    parsed.data.contentType,
  );

  return reply.code(201).send(result);
}
