import type { FastifyPluginAsync } from "fastify";

import {
  registerController,
} from "../controllers/auth.controller.js";

export const authRoutes: FastifyPluginAsync =
  async (app) => {
    app.post(
      "/register",
      registerController
    );
  };