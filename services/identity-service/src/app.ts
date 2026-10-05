import Fastify from "fastify";
import { authRoutes } from "./routes/auth.routes.js";
import { userRoutes } from "./routes/user.routes.js";
import { registerErrorHandler } from "./plugins/error-handler.plugin.js";
import multipart from "@fastify/multipart";

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
            fileSize: 5 * 1024 * 1024,
        },
    });
    registerErrorHandler(app);
    app.register(authRoutes);
    app.register(userRoutes);

    return app;
}