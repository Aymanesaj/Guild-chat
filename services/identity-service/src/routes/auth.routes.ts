import type { FastifyPluginAsync } from "fastify";

import {
  registerController,
  loginController,
  refreshController
} from "../controllers/auth.controller.js";

export const authRoutes: FastifyPluginAsync =
  async (app) => {
    app.post(
        "/register",
        registerController
    );
    app.post(
        "/login",
        loginController
    )
    app.post(
      "/auth/refresh",
      refreshController
    );
  };