
import type {
  FastifyRequest,
  FastifyReply,
} from "fastify";

import { z } from "zod";

import {
  getUserAvatarUrl,
} from "../services/avatar-read.service.js";

const paramsSchema = z.object({
  userId: z.uuid(),
});

export async function getUserAvatarUrlController(
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
      error: "Invalid user ID",
    });
  }

  const result = await getUserAvatarUrl(
    parsed.data.userId,
  );

  if (!result) {
    return reply.code(204).send();
  }

  return reply.code(200).send(result);
}
