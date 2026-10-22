
import type {
  FastifyRequest,
  FastifyReply,
} from "fastify";

import { z } from "zod";

import {
  confirmAvatarUpload,
} from "../services/avatar-confirm.service.js";

const confirmAvatarSchema = z.object({
  uploadId: z.uuid(),
}).strict();

export async function confirmAvatarController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!request.userId) {
    return reply.code(401).send({
      error: "Unauthorized",
    });
  }

  const parsed = confirmAvatarSchema.safeParse(
    request.body,
  );

  if (!parsed.success) {
    return reply.code(400).send({
      error: "Invalid upload ID",
    });
  }

  const avatar = await confirmAvatarUpload(
    request.userId,
    parsed.data.uploadId,
  );

  return reply.code(200).send(avatar);
}
