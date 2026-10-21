import {
  createHash,
  randomBytes,
} from "node:crypto";

import { UnauthorizedError } from "../errors/unauthorized.error.js";

import { BadRequestError } from "../errors/bad-request.error.js";

import {
  createRefreshToken,
  findRefreshTokenByHash,
  revokeAllRefreshTokens,
  revokeRefreshToken,
  rotateRefreshTokenInDb
} from "../repositories/refresh-token.repository.js";

const REFRESH_TTL_SECONDS = Number(
  process.env.JWT_REFRESH_TTL_SECONDS ?? 604800
);

function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashRefreshToken(token: string): string {
  return createHash("sha256")
    .update(token)
    .digest("hex");
}

export async function issueRefreshToken(
  userId: string
): Promise<string> {
  const rawToken = generateRefreshToken();

  const expiresAt = new Date(
    Date.now() + REFRESH_TTL_SECONDS * 1000
  );

  await createRefreshToken({
    userId,
    tokenHash: hashRefreshToken(rawToken),
    expiresAt,
  });

  return rawToken;
}

export async function rotateRefreshToken(
  presentedToken: string
) {
  if (!presentedToken.trim()) {
    throw new BadRequestError("Refresh token is required");
  }

  const hash = hashRefreshToken(presentedToken);

  const existing =
    await findRefreshTokenByHash(hash);

  if (!existing) {
    throw new UnauthorizedError("Invalid refresh token");
  }

  if (existing.revoked) {
    if (existing.replacedBy) {
      await revokeAllRefreshTokens(
        existing.userId
      );

      throw new UnauthorizedError(
        "Refresh token reuse detected; sessions revoked"
      );
    }

    throw new UnauthorizedError(
      "Refresh token has been revoked"
    );
  }

  if (existing.expiresAt <= new Date()) {
    await revokeRefreshToken(existing.id);

    throw new UnauthorizedError("Refresh token expired");
  }

  const newRawToken = generateRefreshToken();

  const expiresAt = new Date(
    Date.now() + REFRESH_TTL_SECONDS * 1000,
  );

  const rotated = await rotateRefreshTokenInDb(
    existing.id,
    existing.userId,
    hashRefreshToken(newRawToken),
    expiresAt,
  );

  if (!rotated) {
    const current = await findRefreshTokenByHash(hash);

    if (current?.revoked && current.replacedBy) {
      await revokeAllRefreshTokens(current.userId);

      throw new UnauthorizedError(
        "Refresh token reuse detected; sessions revoked",
      );
    }

    throw new UnauthorizedError(
      "Refresh token is no longer valid",
    );
  }

  return {
    userId: existing.userId,
    refreshToken: newRawToken,
  };
}

export async function revokeAllSessions(
  userId: string
) {
  await revokeAllRefreshTokens(userId);
}

export async function revokeRefreshSession(
  presentedToken: string
): Promise<void> {
  if (!presentedToken.trim()) {
    return;
  }

  const hash =
    hashRefreshToken(presentedToken);

  const existing =
    await findRefreshTokenByHash(hash);

  if (!existing) {
    return;
  }

  if (existing.revoked) {
    return;
  }

  await revokeRefreshToken(existing.id);
}