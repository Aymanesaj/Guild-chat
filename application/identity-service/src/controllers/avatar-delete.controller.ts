
import type {
  FastifyRequest,
  FastifyReply,
} from "fastify";

import {
  deleteCurrentAvatar,
} from "../services/avatar-delete.service.js";

export async function deleteCurrentAvatarController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!request.userId) {
    return reply.code(401).send({
      error: "Unauthorized",
    });
  }

  await deleteCurrentAvatar(request.userId);

  return reply.code(204).send();
}
