import bcrypt from "bcrypt";

import type { RegisterInput } from "../schemas/auth.schema.js";
import type {
  AuthResponse,
  PublicUser,
} from "../types/auth.types.js";

import {
  createLocalUser,
  emailExists,
  usernameExists,
} from "../repositories/user.repository.js";

import { issueAccessToken } from "./jwt.service.js";
import { issueRefreshToken } from "./refresh-token.service.js";

function toPublicUser(user: {
  id: string;
  username: string;
  email: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  authProvider: "LOCAL" | "GITHUB";
  createdAt: Date;
  updatedAt: Date;
}): PublicUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    bio: user.bio,
    avatarUrl: user.avatarUrl,
    authProvider: user.authProvider,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function registerUser(
  input: RegisterInput
): Promise<AuthResponse> {

  if (await usernameExists(input.username)) {
    throw new Error("Username is already taken");
  }

  if (await emailExists(input.email)) {
    throw new Error("Email is already registered");
  }

  const passwordHash = await bcrypt.hash(
    input.password,
    12
  );

  const displayName =
    input.displayName?.trim() || input.username;

  const user = await createLocalUser({
    username: input.username,
    email: input.email,
    passwordHash,
    displayName,
  });

  const accessToken = issueAccessToken(user);

  const refreshToken =
    await issueRefreshToken(user.id);

  return {
    tokenType: "Bearer",
    accessToken,
    refreshToken,
    user: toPublicUser(user),
  };
}