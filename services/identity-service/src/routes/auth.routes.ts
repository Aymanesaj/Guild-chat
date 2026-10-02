import type { FastifyPluginAsync } from "fastify";

import {
  registerController,
  loginController,
  refreshController,
  logoutController
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
    app.post(
      "/auth/logout",
      logoutController
    );
  };