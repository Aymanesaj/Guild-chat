import type { FastifyPluginAsync } from "fastify";

import { authenticate } from "../plugins/auth.plugin.js";

import { meController } from "../controllers/user.controller.js";

export const userRoutes:
  FastifyPluginAsync =
  async (app) => {

    app.get(
      "/me",
      {
        preHandler: authenticate,
      },
      meController
    );
  };