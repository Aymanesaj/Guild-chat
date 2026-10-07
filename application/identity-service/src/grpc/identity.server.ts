import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { resolve } from "node:path";

import {
  validateTokenHandler,
  getUserHandler,
  areFriendsHandler,
} from "./identity.handlers.js";

const protoPath = resolve(process.cwd(), "src/grpc/identity.proto");

const packageDefinition = protoLoader.loadSync(protoPath, {
  keepCase: true,
  longs: Number,
  enums: String,
  defaults: true,
  oneofs: true,
});

const loadedProto = grpc.loadPackageDefinition(packageDefinition);

const identityPackage = loadedProto.identity as grpc.GrpcObject;

type LoadedGrpcService = {
  service: grpc.ServiceDefinition;
};

const IdentityService =
  identityPackage.IdentityService as unknown as LoadedGrpcService;

export function createGrpcServer(): grpc.Server {
  const server = new grpc.Server();

  server.addService(IdentityService.service, {
    validateToken: validateTokenHandler,

    getUser: getUserHandler,

    areFriends: areFriendsHandler,
  });

  return server;
}

export async function startGrpcServer(): Promise<grpc.Server> {
  const server = createGrpcServer();

  const port = process.env.GRPC_PORT ?? "9090";

  const address = `0.0.0.0:${port}`;

  await new Promise<void>((resolveBind, rejectBind) => {
    server.bindAsync(
      address,
      grpc.ServerCredentials.createInsecure(),
      (error) => {
        if (error) {
          rejectBind(error);
          return;
        }

        console.log(`gRPC server listening on ${address}`);

        resolveBind();
      },
    );
  });

  return server;
}
