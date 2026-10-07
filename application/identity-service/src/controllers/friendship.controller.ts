import type { FastifyReply, FastifyRequest } from "fastify";

import {
  sendFriendRequestSchema,
  friendRequestParamsSchema,
  friendUserParamsSchema,
} from "../schemas/friendship.schema.js";

import {
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriend,
} from "../services/friendship.service.js";

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

export async function acceptFriendRequestController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!request.userId) {
    return reply.status(401).send({
      error: "Unauthorized",
    });
  }

  const result = friendRequestParamsSchema.safeParse(request.params);

  if (!result.success) {
    return reply.status(400).send({
      error: "Invalid friend request id",
      details: result.error.issues,
    });
  }

  const friendship = await acceptFriendRequest(request.userId, result.data.id);

  return reply.status(200).send(friendship);
}

export async function declineFriendRequestController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!request.userId) {
    return reply.status(401).send({
      error: "Unauthorized",
    });
  }

  const result = friendRequestParamsSchema.safeParse(request.params);

  if (!result.success) {
    return reply.status(400).send({
      error: "Invalid friend request id",
      details: result.error.issues,
    });
  }

  await declineFriendRequest(request.userId, result.data.id);

  return reply.status(204).send();
}

export async function removeFriendController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!request.userId) {
    return reply.status(401).send({
      error: "Unauthorized",
    });
  }

  const result = friendUserParamsSchema.safeParse(request.params);

  if (!result.success) {
    return reply.status(400).send({
      error: "Invalid user id",
      details: result.error.issues,
    });
  }

  await removeFriend(request.userId, result.data.userId);

  return reply.status(204).send();
}
