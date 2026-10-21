
import type { FastifyInstance } from "fastify";
import { AppError } from "../errors/app.error.js";

export function registerErrorHandler(
  app: FastifyInstance,
): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: error.message,
      });
    }

    if (
      error instanceof Error &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      return reply.status(error.statusCode).send({
        error: error.message,
      });
    }

    request.log.error(error);

    return reply.status(500).send({
      error: "Internal Server Error",
    });
  });
}
