import type { FastifyPluginAsync } from "fastify";

import { getAvatarController } from "../controllers/avatar.controller.js";


export const avatarRoutes:
    FastifyPluginAsync =
    async (app) => {
        app.get(
        "/avatars/:filename",
        getAvatarController
        );
    };