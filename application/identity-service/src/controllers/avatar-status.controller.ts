
import type {
  FastifyRequest,
  FastifyReply,
} from "fastify";

import { z } from "zod";

import {
  getAvatarUploadProgress,
} from "../services/avatar-status.service.js";

const paramsSchema = z.object({
  uploadId: z.uuid(),
});

export async function getAvatarUploadStatusController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!request.userId) {
    return reply.code(401).send({
      error: "Unauthorized",
    });
  }

  const parsed = paramsSchema.safeParse(
    request.params,
  );

  if (!parsed.success) {
    return reply.code(400).send({
      error: "Invalid upload ID",
    });
  }

  const result = await getAvatarUploadProgress(
    request.userId,
    parsed.data.uploadId,
  );

  return reply.code(200).send(result);
}
