import type { FastifyInstance } from "fastify";

import { authenticate } from "../plugins/auth.plugin.js";

import { sendFriendRequestController } from "../controllers/friendship.controller.js";

export async function friendshipRoutes(app: FastifyInstance) {
  app.post(
    "/friends/requests",
    {
      preHandler: authenticate,
    },
    sendFriendRequestController,
  );
}
