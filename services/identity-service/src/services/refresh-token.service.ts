import {
  createHash,
  randomBytes,
} from "node:crypto";

import {
  createRefreshToken,
  findRefreshTokenByHash,
  revokeAllRefreshTokens,
  revokeRefreshToken,
  setReplacement,
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
    throw new Error("Refresh token is required");
  }

  const hash = hashRefreshToken(presentedToken);

  const existing =
    await findRefreshTokenByHash(hash);

  if (!existing) {
    throw new Error("Invalid refresh token");
  }

  if (existing.revoked) {
    await revokeAllRefreshTokens(existing.userId);

    throw new Error(
      "Refresh token reuse detected; sessions revoked"
    );
  }

  if (existing.expiresAt <= new Date()) {
    await revokeRefreshToken(existing.id);

    throw new Error("Refresh token expired");
  }

  await revokeRefreshToken(existing.id);

  const newRawToken = generateRefreshToken();

  const replacement =
    await createRefreshToken({
      userId: existing.userId,
      tokenHash: hashRefreshToken(newRawToken),
      expiresAt: new Date(
        Date.now() +
          REFRESH_TTL_SECONDS * 1000
      ),
    });

  await setReplacement(
    existing.id,
    replacement.id
  );

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