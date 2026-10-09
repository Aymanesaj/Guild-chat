import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import jwt from "jsonwebtoken";

import { issueAccessToken } from "../services/jwt.service.js";

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { resolve } from "node:path";

import type {
  ValidateTokenRequest,
  ValidateTokenResponse,
  GetUserRequest,
  UserResponse,
  AreFriendsRequest,
  AreFriendsResponse,
} from "../grpc/identity.types.js";

const { mockFindUserById, mockFindFriendshipBetween } = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockFindFriendshipBetween: vi.fn(),
}));

vi.mock("../repositories/user.repository.js", () => ({
  findUserById: mockFindUserById,
}));

vi.mock("../repositories/friendship.repository.js", () => ({
  findFriendshipBetween: mockFindFriendshipBetween,
}));

import { createGrpcServer } from "../grpc/identity.server.js";

interface IdentityGrpcClient extends grpc.Client {
  validateToken(
    request: ValidateTokenRequest,
    callback: (
      error: grpc.ServiceError | null,
      response: ValidateTokenResponse,
    ) => void,
  ): grpc.ClientUnaryCall;

  getUser(
    request: GetUserRequest,
    callback: (error: grpc.ServiceError | null, response: UserResponse) => void,
  ): grpc.ClientUnaryCall;

  areFriends(
    request: AreFriendsRequest,
    callback: (
      error: grpc.ServiceError | null,
      response: AreFriendsResponse,
    ) => void,
  ): grpc.ClientUnaryCall;
}

type IdentityGrpcClientConstructor = new (
  address: string,
  credentials: grpc.ChannelCredentials,
) => IdentityGrpcClient;

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

const IdentityClient =
  identityPackage.IdentityService as unknown as IdentityGrpcClientConstructor;

function bindServer(server: grpc.Server): Promise<number> {
  return new Promise((resolveBind, rejectBind) => {
    server.bindAsync(
      "127.0.0.1:0",
      grpc.ServerCredentials.createInsecure(),
      (error, port) => {
        if (error) {
          rejectBind(error);
          return;
        }

        resolveBind(port);
      },
    );
  });
}

function callValidateToken(
  client: IdentityGrpcClient,
  request: ValidateTokenRequest,
): Promise<ValidateTokenResponse> {
  return new Promise((resolveCall, rejectCall) => {
    client.validateToken(request, (error, response) => {
      if (error) {
        rejectCall(error);
        return;
      }

      resolveCall(response);
    });
  });
}

function callGetUser(
  client: IdentityGrpcClient,
  request: GetUserRequest,
): Promise<UserResponse> {
  return new Promise((resolveCall, rejectCall) => {
    client.getUser(request, (error, response) => {
      if (error) {
        rejectCall(error);
        return;
      }

      resolveCall(response);
    });
  });
}

function callAreFriends(
  client: IdentityGrpcClient,
  request: AreFriendsRequest,
): Promise<AreFriendsResponse> {
  return new Promise((resolveCall, rejectCall) => {
    client.areFriends(request, (error, response) => {
      if (error) {
        rejectCall(error);
        return;
      }

      resolveCall(response);
    });
  });
}

describe("Identity gRPC server", () => {
  let server: grpc.Server;
  let client: IdentityGrpcClient;

  beforeAll(async () => {
    server = createGrpcServer();

    const port = await bindServer(server);

    client = new IdentityClient(
      `127.0.0.1:${port}`,
      grpc.credentials.createInsecure(),
    );
  });

  beforeEach(() => {
    mockFindUserById.mockReset();
    mockFindFriendshipBetween.mockReset();
  });

  afterAll(async () => {
    client.close();

    await new Promise<void>((resolveShutdown) => {
      server.tryShutdown(() => {
        resolveShutdown();
      });
    });
  });

  it("ValidateToken returns the JWT expiration for a valid token", async () => {
    const userId = "123e4567-e89b-12d3-a456-426614174000";

    mockFindUserById.mockResolvedValue({
      id: userId,
      username: "obendaou",
      email: "oumaima@example.com",
      displayName: "Oumaima",
      avatarUrl: null,
    });

    const token = issueAccessToken(userId);

    const decoded = jwt.decode(token);

    if (
      !decoded ||
      typeof decoded === "string" ||
      typeof decoded.exp !== "number"
    ) {
      throw new Error("Issued access token has no expiration");
    }

    const response = await callValidateToken(client, {
      token,
    });

    expect(response).toEqual({
      valid: true,
      user_id: userId,
      username: "obendaou",
      email: "oumaima@example.com",
      expires_at: decoded.exp,
    });

    expect(response.expires_at).toBe(decoded.exp);

    expect(mockFindUserById).toHaveBeenCalledWith(userId);
  });

  it("ValidateToken returns valid false and expires_at zero for an invalid token", async () => {
    const response = await callValidateToken(client, {
      token: "definitely-not-a-valid-jwt",
    });

    expect(response).toEqual({
      valid: false,
      user_id: "",
      username: "",
      email: "",
      expires_at: 0,
    });

    expect(mockFindUserById).not.toHaveBeenCalled();
  });

  it("GetUser returns a user when the user exists", async () => {
    const userId = "123e4567-e89b-12d3-a456-426614174000";

    mockFindUserById.mockResolvedValue({
      id: userId,
      username: "obendaou",
      email: "oumaima@example.com",
      displayName: "Oumaima",
      avatarUrl: "/avatars/oumaima.png",
    });

    const response = await callGetUser(client, {
      user_id: userId,
    });

    expect(response).toEqual({
      user_id: userId,
      username: "obendaou",
      display_name: "Oumaima",
      avatar_url: "/avatars/oumaima.png",
    });

    expect(mockFindUserById).toHaveBeenCalledWith(userId);
  });

  it("GetUser returns NOT_FOUND when the user does not exist", async () => {
    mockFindUserById.mockResolvedValue(null);

    await expect(
      callGetUser(client, {
        user_id: "123e4567-e89b-12d3-a456-426614174999",
      }),
    ).rejects.toMatchObject({
      code: grpc.status.NOT_FOUND,
    });
  });

  it("AreFriends returns true for an accepted friendship", async () => {
    const userA = "123e4567-e89b-12d3-a456-426614174001";

    const userB = "123e4567-e89b-12d3-a456-426614174002";

    mockFindFriendshipBetween.mockResolvedValue({
      id: "123e4567-e89b-12d3-a456-426614174003",

      requesterId: userA,
      addresseeId: userB,

      pairKey: `${userA}:${userB}`,

      status: "ACCEPTED",

      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await callAreFriends(client, {
      user_a: userA,
      user_b: userB,
    });

    expect(response).toEqual({
      are_friends: true,
    });

    expect(mockFindFriendshipBetween).toHaveBeenCalledWith(userA, userB);
  });

  it("AreFriends returns false for a pending friendship request", async () => {
    const userA = "123e4567-e89b-12d3-a456-426614174001";

    const userB = "123e4567-e89b-12d3-a456-426614174002";

    mockFindFriendshipBetween.mockResolvedValue({
      id: "123e4567-e89b-12d3-a456-426614174003",

      requesterId: userA,
      addresseeId: userB,

      pairKey: `${userA}:${userB}`,

      status: "PENDING",

      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await callAreFriends(client, {
      user_a: userA,
      user_b: userB,
    });

    expect(response).toEqual({
      are_friends: false,
    });
  });

  it("AreFriends returns false when no friendship exists", async () => {
    mockFindFriendshipBetween.mockResolvedValue(null);

    const response = await callAreFriends(client, {
      user_a: "123e4567-e89b-12d3-a456-426614174001",

      user_b: "123e4567-e89b-12d3-a456-426614174002",
    });

    expect(response).toEqual({
      are_friends: false,
    });
  });
});
