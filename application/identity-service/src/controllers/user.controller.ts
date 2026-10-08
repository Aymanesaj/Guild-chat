import type { FastifyRequest, FastifyReply } from "fastify";
import { getCurrentUser } from "../services/user.service.js";
import { updateProfileSchema } from "../schemas/user.schema.js";
import { updateCurrentUser } from "../services/user.service.js";
import { saveAvatar } from "../services/avatar.service.js";
import { ALLOWED_AVATAR_TYPES } from "../constants/avatar.constants.js";
import { BadRequestError } from "../errors/bad-request.error.js";
import { MAX_AVATAR_SIZE } from "../constants/avatar.constants.js";
import {
  getUserById,
  checkUsernameAvailability,
  getUserByUsername
} from "../services/user.service.js";
import {
  userIdParamsSchema,
  usernameAvailabilityQuerySchema,
} from "../schemas/user.schema.js";

export async function meController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!request.userId)
    return reply.status(401).send({
      error: "Unauthorized",
    });

  const user = await getCurrentUser(request.userId);
  return reply.code(200).send(user);
}

export async function updateMeController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = updateProfileSchema.safeParse(request.body);

  if (!result.success)
    return reply.status(400).send({
      error: "Invalid request",
      details: result.error.issues,
    });

  if (!request.userId) {
    return reply.status(401).send({
      error: "Unauthorized",
    });
  }

  const user = await updateCurrentUser(request.userId, result.data);

  return reply.code(200).send(user);
}

export async function uploadAvatarController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!request.userId)
    return reply.code(401).send({
      error: "Unauthorized",
    });

  const file = await request.file({
    limits: {
      files: 1,
      fileSize: MAX_AVATAR_SIZE,
    },
  });

  if (!file)
    return reply.code(400).send({
      error: "No file uploaded",
    });

  if (!ALLOWED_AVATAR_TYPES[file.mimetype]) {
    file.file.resume();
    throw new BadRequestError("Unsupported avatar format");
  }

  const buffer = await file.toBuffer();
  const user = await saveAvatar(request.userId, {
    mimetype: file.mimetype,
    buffer: buffer,
  });

  return reply.code(200).send(user);
}

export async function getUserByIdController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = userIdParamsSchema.safeParse(request.params);

  if (!result.success) {
    return reply.status(400).send({
      error: "Invalid user id",
    });
  }

  const user = await getUserById(result.data.id);

  return reply.status(200).send(user);
}

export async function usernameAvailabilityController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = usernameAvailabilityQuerySchema.safeParse(request.query);

  if (!result.success) {
    return reply.status(400).send({
      error: "Invalid username",
      details: result.error.issues,
    });
  }

  const availability = await checkUsernameAvailability(result.data.username);

  return reply.status(200).send(availability);
}

export async function getUserByUsernameController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const result = usernameAvailabilityQuerySchema.safeParse(request.query);

  if (!result.success) {
    return reply.status(400).send({
      error: "Invalid username",
      details: result.error.issues,
    });
  }

  const user = await getUserByUsername(result.data.username);

  return reply.status(200).send(user);
}

