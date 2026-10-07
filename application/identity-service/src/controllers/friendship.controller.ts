import type { FastifyReply, FastifyRequest } from "fastify";

import { sendFriendRequestSchema } from "../schemas/friendship.schema.js";

import { sendFriendRequest } from "../services/friendship.service.js";

export async function sendFriendRequestController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = sendFriendRequestSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      error: "Invalid request body",
      details: result.error.issues,
    });
  }

  if (!request.userId) {
    return reply.status(401).send({
      error: "Unauthorized",
    });
  }

  const friendship = await sendFriendRequest(
    request.userId,
    result.data.addresseeId,
  );

  return reply.status(201).send(friendship);
}
