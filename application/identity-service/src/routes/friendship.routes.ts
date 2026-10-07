import type { FastifyInstance } from "fastify";

import { authenticate } from "../plugins/auth.plugin.js";

import {
  acceptFriendRequestController,
  declineFriendRequestController,
  getFriendRequestsController,
  getFriendsController,
  removeFriendController,
  sendFriendRequestController,
} from "../controllers/friendship.controller.js";

export async function friendshipRoutes(app: FastifyInstance) {
  app.post(
    "/friends/requests",
    {
      preHandler: authenticate,
    },
    sendFriendRequestController,
  );
  app.post(
    "/friends/requests/:id/accept",
    {
      preHandler: authenticate,
    },
    acceptFriendRequestController,
  );
  app.post(
    "/friends/requests/:id/decline",
    {
      preHandler: authenticate,
    },
    declineFriendRequestController,
  );
  app.delete(
    "/friends/:userId",
    {
      preHandler: authenticate,
    },
    removeFriendController,
  );
  app.get(
    "/friends",
    {
      preHandler: authenticate,
    },
    getFriendsController,
  );
  app.get(
    "/friends/requests",
    {
      preHandler: authenticate,
    },
    getFriendRequestsController,
  );
}
