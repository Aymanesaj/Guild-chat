import type { FastifyPluginAsync } from "fastify";

import { getAvatarController } from "../controllers/avatar.controller.js";
import { createAvatarUploadController } from "../controllers/avatar-upload.controller.js";
import { authenticate } from "../plugins/auth.plugin.js";
import {
  confirmAvatarController,
} from "../controllers/avatar-confirm.controller.js";
import {
  getUserAvatarUrlController,
} from "../controllers/avatar-read.controller.js";
import {
  deleteCurrentAvatarController,
} from "../controllers/avatar-delete.controller.js";
import {
  getAvatarUploadStatusController,
} from "../controllers/avatar-status.controller.js";


export const avatarRoutes:
    FastifyPluginAsync =
    async (app) => {
        app.get(
        "/avatars/:filename",
        getAvatarController
        );
        app.post(
            "/avatar/upload-url",
            {
                preHandler: authenticate,
            },
            createAvatarUploadController,
        );
        app.post(
            "/avatar/confirm",
            {
                preHandler: authenticate,
            },
            confirmAvatarController,
        );
        app.get(
            "/users/:userId/avatar-url",
            {
                preHandler: authenticate,
            },
            getUserAvatarUrlController,
        );
        app.delete(
            "/avatar",
            {
                preHandler: authenticate,
            },
            deleteCurrentAvatarController,
        );
        app.get(
            "/avatar/uploads/:uploadId",
            {
                preHandler: authenticate,
            },
            getAvatarUploadStatusController,
        );
    };