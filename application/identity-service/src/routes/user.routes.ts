import type { FastifyPluginAsync } from "fastify";

import { authenticate } from "../plugins/auth.plugin.js";

import { meController ,  updateMeController , uploadAvatarController , getUserByIdController , usernameAvailabilityController , getUserByUsernameController } from "../controllers/user.controller.js";
import { deleteAvatarController } from "../controllers/avatar.controller.js";
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
    app.delete(
      "/me/avatar",
      {
        preHandler: authenticate,
      },
      deleteAvatarController
    );
    app.get(
      "/:id",
      {
        preHandler: authenticate,
      },
      getUserByIdController
    );
    app.get(
      "/username/available",
      {
        preHandler: authenticate,
      },
      usernameAvailabilityController
    );
    app.get(
      "/username/get",
      {
        preHandler: authenticate,
      },
      getUserByUsernameController
    );
  };