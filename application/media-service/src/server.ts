import Fastify from 'fastify';
import { startCleanupWorker } from "./workers/cleanup.worker.js";
import { prisma } from "./database/prisma.js";

const app = Fastify({ logger: true });

let stopCleanupWorker: (() => Promise<void>) | undefined;

app.addHook("onClose", async () => {
  await stopCleanupWorker?.();
  await prisma.$disconnect();
});
// Process health only; storage and RPC integration will be added with Media features.
app.get('/health', async () => ({ status: 'ok', service: 'media-service' }));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await app.close();
  });
}

try {
  await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 8084) });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

stopCleanupWorker = startCleanupWorker();