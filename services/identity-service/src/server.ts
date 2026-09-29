import { buildApp } from "./app.js";

const app = buildApp();

try {
    await app.listen({
        host: "0.0.0.0",
        port: 8083
    });
} catch (error) {
    app.log.error(error);
    process.exit(1);
}