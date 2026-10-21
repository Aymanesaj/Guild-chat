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


export async function rotateRefreshTokenInDb(
  tokenId: string,
  userId: string,
  newTokenHash: string,
  expiresAt: Date,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const result = await tx.refreshToken.updateMany({
      where: {
        id: tokenId,
        userId,
        revoked: false,
        expiresAt: {
          gt: new Date(),
        },
      },
      data: {
        revoked: true,
      },
    });

    if (result.count !== 1) {
      return false;
    }

    const replacement = await tx.refreshToken.create({
      data: {
        userId,
        tokenHash: newTokenHash,
        expiresAt,
      },
    });

    await tx.refreshToken.update({
      where: {
        id: tokenId,
      },
      data: {
        replacedBy: replacement.id,
      },
    });

    return true;
  });
}
