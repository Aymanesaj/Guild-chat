import Fastify from "fastify";
import { authRoutes } from "./routes/auth.routes.js";
import { userRoutes } from "./routes/user.routes.js";
import { registerErrorHandler } from "./plugins/error-handler.plugin.js";
import multipart from "@fastify/multipart";
import { MAX_AVATAR_SIZE } from "./constants/avatar.constants.js";
import { avatarRoutes } from "./routes/avatar.routes.js";
import { friendshipRoutes } from "./routes/friendship.routes.js";

export function buildApp() {
    const app = Fastify({
        logger: true
    });

    app.get("/health", async () => {
        return {
            status: "ok",
            service: "identity-service"
        };
    });

    app.register(multipart, {
        limits: {
            fileSize: MAX_AVATAR_SIZE,
        },
    });
    registerErrorHandler(app);
    app.register(authRoutes);
    app.register(userRoutes);
    app.register(avatarRoutes);
    app.register(friendshipRoutes);
    return app;
}