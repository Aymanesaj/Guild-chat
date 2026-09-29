import { buildApp } from "./app.js";

const app = buildApp();

try {
    await app.listen({
        host: "0.0.0.0",
        port: Number(process.env.IDENTITY_HTTP_PORT ?? 8083)
    });
} catch (error) {
    app.log.error(error);
    process.exit(1);
}