import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import { createHash, randomBytes } from "node:crypto";

import { buildApp } from "../app.js";
import { prisma } from "../database/prisma.js";

const app = buildApp();

const suffix = Date.now().toString();

const testUser = {
  username: `session_test_${suffix}`,
  email: `session_test_${suffix}@example.com`,
  password: "strongpassword123",
  displayName: "Session Test",
};

let userId: string;

function hashRefreshToken(token: string): string {
  return createHash("sha256")
    .update(token)
    .digest("hex");
}

async function login() {
  const response = await app.inject({
    method: "POST",
    url: "/login",

    payload: {
      identifier: testUser.username,
      password: testUser.password,
    },
  });

  expect(response.statusCode).toBe(200);

  return response.json();
}

beforeAll(async () => {
  const response = await app.inject({
    method: "POST",
    url: "/register",

    payload: testUser,
  });

  expect(response.statusCode).toBe(201);

  const body = response.json();

  userId = body.user.id;
});

afterAll(async () => {
  if (userId) {
    await prisma.refreshToken.deleteMany({
      where: {
        userId,
      },
    });

    await prisma.friendship.deleteMany({
      where: {
        OR: [
          { requesterId: userId },
          { addresseeId: userId },
        ],
      },
    });

    await prisma.user.delete({
      where: {
        id: userId,
      },
    });
  }

  await app.close();
  await prisma.$disconnect();
});


describe(
  "Refresh token lifecycle",
  { concurrent: false },
  () => {

    it("login creates a refresh token", async () => {
      const body = await login();

      expect(body.refreshToken).toBeDefined();
      expect(typeof body.refreshToken).toBe(
        "string"
      );

      const tokenHash = hashRefreshToken(
        body.refreshToken
      );

      const storedToken =
        await prisma.refreshToken.findUnique({
          where: {
            tokenHash,
          },
        });

      expect(storedToken).not.toBeNull();
      expect(storedToken?.userId).toBe(
        userId
      );
      expect(storedToken?.revoked).toBe(
        false
      );
    });


    it("refresh works", async () => {
      const loginBody = await login();

      const oldRefreshToken =
        loginBody.refreshToken;

      const response = await app.inject({
        method: "POST",
        url: "/auth/refresh",

        payload: {
          refreshToken: oldRefreshToken,
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();

      expect(body.accessToken).toBeDefined();
      expect(body.refreshToken).toBeDefined();

      expect(body.refreshToken).not.toBe(
        oldRefreshToken
      );
    });


    it("old token becomes revoked after refresh", async () => {
      const loginBody = await login();

      const oldRefreshToken =
        loginBody.refreshToken;

      const oldTokenHash =
        hashRefreshToken(
          oldRefreshToken
        );

      const response = await app.inject({
        method: "POST",
        url: "/auth/refresh",

        payload: {
          refreshToken: oldRefreshToken,
        },
      });

      expect(response.statusCode).toBe(200);

      const storedOldToken =
        await prisma.refreshToken.findUnique({
          where: {
            tokenHash: oldTokenHash,
          },
        });

      expect(storedOldToken).not.toBeNull();

      expect(
        storedOldToken?.revoked
      ).toBe(true);

      expect(
        storedOldToken?.replacedBy
      ).not.toBeNull();
    });


    it("old refresh token cannot be reused", async () => {
      const loginBody = await login();

      const oldRefreshToken =
        loginBody.refreshToken;

      const firstRefresh =
        await app.inject({
          method: "POST",
          url: "/auth/refresh",

          payload: {
            refreshToken:
              oldRefreshToken,
          },
        });

      expect(
        firstRefresh.statusCode
      ).toBe(200);

      const secondRefresh =
        await app.inject({
          method: "POST",
          url: "/auth/refresh",

          payload: {
            refreshToken:
              oldRefreshToken,
          },
        });

      expect(
        secondRefresh.statusCode
      ).toBe(401);

      const body =
        secondRefresh.json();

      expect(body.error).toBe(
        "Invalid refresh token"
      );
    });


    it("logout revokes the refresh token", async () => {
      const loginBody = await login();

      const refreshToken =
        loginBody.refreshToken;

      const tokenHash =
        hashRefreshToken(
          refreshToken
        );

      const response = await app.inject({
        method: "POST",
        url: "/auth/logout",

        payload: {
          refreshToken,
        },
      });

      expect(response.statusCode).toBe(
        204
      );

      const storedToken =
        await prisma.refreshToken.findUnique({
          where: {
            tokenHash,
          },
        });

      expect(storedToken).not.toBeNull();

      expect(
        storedToken?.revoked
      ).toBe(true);
    });


    it("expired refresh token is rejected", async () => {
      const loginBody = await login();

      const refreshToken =
        loginBody.refreshToken;

      const tokenHash =
        hashRefreshToken(
          refreshToken
        );

      await prisma.refreshToken.update({
        where: {
          tokenHash,
        },

        data: {
          expiresAt: new Date(
            Date.now() - 60_000
          ),
        },
      });

      const response = await app.inject({
        method: "POST",
        url: "/auth/refresh",

        payload: {
          refreshToken,
        },
      });

      expect(response.statusCode).toBe(
        401
      );

      const body = response.json();

      expect(body.error).toBe(
        "Invalid refresh token"
      );

      const storedToken =
        await prisma.refreshToken.findUnique({
          where: {
            tokenHash,
          },
        });

      expect(
        storedToken?.revoked
      ).toBe(true);
    });


    it("random refresh token is rejected", async () => {
      const randomToken =
        randomBytes(32).toString(
          "base64url"
        );

      const response = await app.inject({
        method: "POST",
        url: "/auth/refresh",

        payload: {
          refreshToken: randomToken,
        },
      });

      expect(response.statusCode).toBe(
        401
      );

      const body = response.json();

      expect(body.error).toBe(
        "Invalid refresh token"
      );
    });
  }
);