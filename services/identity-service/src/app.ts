import Fastify from "fastify";
import { authRoutes } from "./routes/auth.routes.js";
import { userRoutes } from "./routes/user.routes.js";


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

    app.register(authRoutes);
    app.register(userRoutes);

    return app;
}