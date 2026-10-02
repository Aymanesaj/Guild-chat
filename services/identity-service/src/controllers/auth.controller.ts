import type {
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { registerSchema , loginSchema , refreshSchema} from "../schemas/auth.schema.js";
import { registerUser , loginUser , refreshSession } from "../services/auth.service.js";

export async function registerController(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const result = registerSchema.safeParse(request.body);

  if (!result.success) {
    return reply.status(400).send({
      error: "Invalid request",
      details: result.error.issues,
    });
  }

  try {
    const response = await registerUser(result.data);

    return reply.status(201).send(response);
  } catch (error) {
    if (
      error instanceof Error &&
      (
        error.message === "Username is already taken" ||
        error.message === "Email is already registered"
      )
    ) {
      return reply.status(409).send({
        error: error.message,
      });
    }

    throw error;
  }
}

export async function loginController(
    request: FastifyRequest,
    reply: FastifyReply
) {
    const result = loginSchema.safeParse(request.body);

    if (!result.success) {
        return reply.status(400).send({
        error: "Invalid request",
        details: result.error.issues,
        });
    }

    try {
        const response = await loginUser(result.data);
        return reply.status(200).send(response);
    } catch (error) {
        if ( error instanceof Error && error.message === "Invalid credentials") {
            return reply.status(401).send({
                error: "Invalid credentials",
            });
        }
        throw error;
    }
}

export async function refreshController(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const input = refreshSchema.safeParse(request.body);

  if (!input.success)
    return reply.code(400).send({
      error: "Invalid request",
      details: input.error.issues,
    });

  try {
    const response = await refreshSession(input.data);

    return reply.code(200).send(response);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "Invalid refresh token" ||
        error.message === "Refresh token expired" ||
        error.message === "Refresh token reuse detected; sessions revoked")
    ) {
      return reply.status(401).send({
        error: "Invalid refresh token",
      });
    }

    throw error;
  }
}