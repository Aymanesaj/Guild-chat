import type { FastifyPluginAsync } from "fastify";

import { authenticate } from "../plugins/auth.plugin.js";

import { meController ,  updateMeController } from "../controllers/user.controller.js";

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
    app.put(
      "/me",
      {
        preHandler: authenticate
      },
      updateMeController
    )
  };