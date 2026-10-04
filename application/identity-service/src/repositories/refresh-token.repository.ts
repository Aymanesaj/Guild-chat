import { prisma } from "../database/prisma.js";

export function findRefreshTokenByHash(tokenHash: string) {
  return prisma.refreshToken.findUnique({
    where: {
      tokenHash,
    },
  });
}

export function createRefreshToken(data: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}) {
  return prisma.refreshToken.create({
    data,
  });
}

export function revokeRefreshToken(id: string) {
  return prisma.refreshToken.update({
    where: {
      id,
    },
    data: {
      revoked: true,
    },
  });
}

export function setReplacement(
  id: string,
  replacementId: string
) {
  return prisma.refreshToken.update({
    where: {
      id,
    },
    data: {
      replacedBy: replacementId,
    },
  });
}

export function revokeAllRefreshTokens(userId: string) {
  return prisma.refreshToken.updateMany({
    where: {
      userId,
      revoked: false,
    },
    data: {
      revoked: true,
    },
  });
}