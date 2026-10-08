import type { FastifyPluginAsync } from "fastify";

import {
  registerController,
  loginController,
  refreshController,
  logoutController,
  logoutAllController
} from "../controllers/auth.controller.js";
import { authenticate } from "../plugins/auth.plugin.js";

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
    app.post(
      "/auth/logout-all",
      {
        preHandler: authenticate,
      },
      logoutAllController
    );
  };