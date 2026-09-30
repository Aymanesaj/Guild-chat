import Fastify from "fastify";
import { authRoutes } from "./routes/auth.routes.js";


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


    return app;
}