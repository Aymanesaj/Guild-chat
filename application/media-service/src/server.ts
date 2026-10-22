import Fastify from 'fastify';
import { startCleanupWorker } from "./workers/cleanup.worker.js";
import { prisma } from "./database/prisma.js";
import type { Server } from "@grpc/grpc-js";
import { startMediaGrpcServer } from "./grpc/media.grpc.js";

const app = Fastify({ logger: true });

let stopCleanupWorker: (() => Promise<void>) | undefined;
let grpcServer: Server | undefined;

app.addHook("onClose", async () => {
  if (grpcServer) {
    const server = grpcServer;

    await new Promise<void>((resolve) => {
      server.tryShutdown(() => resolve());
    });
  }

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
  grpcServer = await startMediaGrpcServer();

  await app.listen({
    host: "0.0.0.0",
    port: Number(process.env.PORT ?? 8084),
  });

  stopCleanupWorker = startCleanupWorker();

  app.log.info("Media gRPC listener started");
} catch (error) {
  grpcServer?.forceShutdown();
  await app.close();

  app.log.error(
    { errorName: error instanceof Error ? error.name : "Unknown" },
    "Media startup failed",
  );

  process.exitCode = 1;
}
