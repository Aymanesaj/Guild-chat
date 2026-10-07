import * as grpc from "@grpc/grpc-js";

import { validateAccessToken } from "../services/jwt.service.js";

import { findUserById } from "../repositories/user.repository.js";

import { findFriendshipBetween } from "../repositories/friendship.repository.js";

import type {
  ValidateTokenRequest,
  ValidateTokenResponse,
  GetUserRequest,
  UserResponse,
  AreFriendsRequest,
  AreFriendsResponse,
} from "./identity.types.js";

function createGrpcError(
  code: grpc.status,
  details: string,
): grpc.ServiceError {
  const error = new Error(details) as grpc.ServiceError;

  error.code = code;
  error.details = details;
  error.metadata = new grpc.Metadata();

  return error;
}

export async function validateTokenHandler(
  call: grpc.ServerUnaryCall<ValidateTokenRequest, ValidateTokenResponse>,
  callback: grpc.sendUnaryData<ValidateTokenResponse>,
): Promise<void> {
  try {
    const token = call.request.token;

    const userId = validateAccessToken(token);

    if (!userId) {
      callback(null, {
        valid: false,
        user_id: "",
        username: "",
        email: "",
      });

      return;
    }

    const user = await findUserById(userId);

    if (!user) {
      callback(null, {
        valid: false,
        user_id: "",
        username: "",
        email: "",
      });

      return;
    }

    callback(null, {
      valid: true,
      user_id: user.id,
      username: user.username,
      email: user.email,
    });
  } catch {
    callback(createGrpcError(grpc.status.INTERNAL, "Failed to validate token"));
  }
}

export async function getUserHandler(
  call: grpc.ServerUnaryCall<GetUserRequest, UserResponse>,
  callback: grpc.sendUnaryData<UserResponse>,
): Promise<void> {
  try {
    const user = await findUserById(call.request.user_id);

    if (!user) {
      callback(createGrpcError(grpc.status.NOT_FOUND, "User not found"));

      return;
    }

    callback(null, {
      user_id: user.id,
      username: user.username,
      display_name: user.displayName,
      avatar_url: user.avatarUrl ?? "",
    });
  } catch {
    callback(createGrpcError(grpc.status.INTERNAL, "Failed to get user"));
  }
}

export async function areFriendsHandler(
  call: grpc.ServerUnaryCall<AreFriendsRequest, AreFriendsResponse>,
  callback: grpc.sendUnaryData<AreFriendsResponse>,
): Promise<void> {
  try {
    const friendship = await findFriendshipBetween(
      call.request.user_a,
      call.request.user_b,
    );

    callback(null, {
      are_friends: friendship?.status === "ACCEPTED",
    });
  } catch {
    callback(
      createGrpcError(grpc.status.INTERNAL, "Failed to check friendship"),
    );
  }
}
