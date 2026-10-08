import bcrypt from "bcrypt";

import { ConflictError } from "../errors/conflict.error.js";

import { UnauthorizedError } from "../errors/unauthorized.error.js";

import type { RegisterInput , LoginInput , RefreshInput , LogoutInput} from "../schemas/auth.schema.js";
import type { AuthResponse } from "../types/auth.types.js";
import type { PublicUser } from "../types/user.types.js";

import { createLocalUser , emailExists , usernameExists , findUserByEmail , findUserByUsername, findUserById } from "../repositories/user.repository.js";

import { issueAccessToken } from "./jwt.service.js";
import { issueRefreshToken , rotateRefreshToken , revokeRefreshSession , revokeAllSessions } from "./refresh-token.service.js";

import { toPublicUser } from "../mappers/user.mapper.js";

export async function registerUser(
  input: RegisterInput,
): Promise<AuthResponse> {
  if (await usernameExists(input.username)) {
    throw new ConflictError("Username is already taken");
  }

  if (await emailExists(input.email)) {
    throw new ConflictError("Email is already registered");
  }

  const passwordHash = await bcrypt.hash(input.password, 12);

  const displayName = input.displayName?.trim() || input.username;

  const user = await createLocalUser({
    username: input.username,
    email: input.email,
    passwordHash,
    displayName,
  });

  const accessToken = issueAccessToken(user);

  const refreshToken = await issueRefreshToken(user.id);

  return {
    tokenType: "Bearer",
    accessToken,
    refreshToken,
    user: toPublicUser(user),
  };
}

export async function loginUser(
  loginInput: LoginInput
): Promise<AuthResponse> {
  const identifier = loginInput.identifier.toLowerCase();

  const user = identifier.includes("@")
    ? await findUserByEmail(identifier)
    : await findUserByUsername(identifier);

  if (!user || !user.passwordHash) throw new UnauthorizedError("Invalid credentials");

  const passwordMatchs = await bcrypt.compare(
    loginInput.password,
    user.passwordHash,
  );

  if (!passwordMatchs) throw new UnauthorizedError("Invalid credentials");

  const accessToken = issueAccessToken(user);

  const refreshToken = await issueRefreshToken(user.id);
  return {
    tokenType: "Bearer",
    accessToken,
    refreshToken,
    user: toPublicUser(user),
  };
}

export async function refreshSession(
  refreshInput: RefreshInput,
): Promise<AuthResponse> {
  const rotated = await rotateRefreshToken(refreshInput.refreshToken);

  const user = await findUserById(rotated.userId);

  if (!user) {
    throw new UnauthorizedError("Invalid refresh token");
  }

  const accessToken = issueAccessToken(user);

  return {
    tokenType: 'Bearer',
    accessToken,
    refreshToken: rotated.refreshToken,
    user: toPublicUser(user)
  }
}


export async function logoutSession(
  logoutInput: LogoutInput
): Promise<void> {
  await revokeRefreshSession(logoutInput.refreshToken);
}

export async function logoutAllSessions(
  userId: string
): Promise<void> {
  await revokeAllSessions(userId);
}