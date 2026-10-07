import { buildApp } from "./app.js";

import {
  startGrpcServer,
} from "./grpc/identity.server.js";


const app = buildApp();

let grpcServer:
  Awaited<ReturnType<typeof startGrpcServer>>
  | undefined;


async function shutdown(
  signal: string
): Promise<void> {
  app.log.info(
    `${signal} received, shutting down`
  );

  try {
    await app.close();

    if (grpcServer) {
      await new Promise<void>(
        (resolve) => {
          grpcServer!.tryShutdown(() => {
            resolve();
          });
        }
      );
    }

    process.exit(0);
  } catch (error) {
    app.log.error(error);

    grpcServer?.forceShutdown();

    process.exit(1);
  }
}


try {
  grpcServer =
    await startGrpcServer();

  await app.listen({
    host: "0.0.0.0",
    port: Number(
      process.env.IDENTITY_HTTP_PORT ??
      8083
    ),
  });

} catch (error) {
  app.log.error(error);

  grpcServer?.forceShutdown();

  await app.close();

  process.exit(1);
}


process.on(
  "SIGINT",
  () => {
    void shutdown("SIGINT");
  }
);

process.on(
  "SIGTERM",
  () => {
    void shutdown("SIGTERM");
  }
);