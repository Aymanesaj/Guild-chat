import type { FastifyPluginAsync } from "fastify";

import { authenticate } from "../plugins/auth.plugin.js";

import { meController ,  updateMeController , uploadAvatarController , getUserByIdController } from "../controllers/user.controller.js";

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
    app.post(
      "/me/avatar",
      {
        preHandler: authenticate
      },
      uploadAvatarController
    )
    app.get(
      "/users/:id",
      {
        preHandler: authenticate,
      },
      getUserByIdController
    );
  };