import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import {
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";

import {
  buildApp,
} from "../app.js";

import {
  prisma,
} from "../database/prisma.js";


const app = buildApp();


/* =========================================================
   UNIQUE TEST USER
   ========================================================= */

const suffix = randomUUID()
  .replaceAll("-", "")
  .slice(0, 12);


const testUser = {
  username:
    `session_test_${suffix}`,

  email:
    `session_test_${suffix}@example.com`,

  password:
    "Strongpassword123",

  displayName:
    "Session Test",
};


let userId: string;


/* =========================================================
   HELPERS
   ========================================================= */

function hashRefreshToken(
  token: string
): string {
  return createHash("sha256")
    .update(token)
    .digest("hex");
}


async function login() {
  const response =
    await app.inject({
      method: "POST",
      url: "/login",

      payload: {
        identifier:
          testUser.username,

        password:
          testUser.password,
      },
    });


  expect(
    response.statusCode
  ).toBe(200);


  return response.json();
}


/* =========================================================
   SETUP
   ========================================================= */

beforeAll(async () => {
  const response =
    await app.inject({
      method: "POST",
      url: "/register",

      payload: testUser,
    });


  expect(
    response.statusCode
  ).toBe(201);


  const body =
    response.json();


  userId =
    body.user.id;
});


/* =========================================================
   CLEANUP
   ========================================================= */

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
          {
            requesterId:
              userId,
          },
          {
            addresseeId:
              userId,
          },
        ],
      },
    });


    await prisma.user.deleteMany({
      where: {
        id: userId,
      },
    });
  }


  await app.close();

  await prisma.$disconnect();
});




/* =========================================================
   REFRESH TOKEN LIFECYCLE
   ========================================================= */

describe(
  "Refresh token lifecycle",
  {
    concurrent: false,
  },
  () => {

    /* -----------------------------------------------------
       LOGIN CREATES REFRESH TOKEN
       ----------------------------------------------------- */

    it(
      "login creates a refresh token",
      async () => {
        const body =
          await login();


        expect(
          body.refreshToken
        ).toBeDefined();


        expect(
          typeof body.refreshToken
        ).toBe("string");


        expect(
          body.refreshToken.length
        ).toBeGreaterThan(0);


        const tokenHash =
          hashRefreshToken(
            body.refreshToken
          );


        const storedToken =
          await prisma
            .refreshToken
            .findUnique({
              where: {
                tokenHash,
              },
            });


        expect(
          storedToken
        ).not.toBeNull();


        expect(
          storedToken?.userId
        ).toBe(userId);


        expect(
          storedToken?.revoked
        ).toBe(false);
      }
    );


    /* -----------------------------------------------------
       REFRESH WORKS
       ----------------------------------------------------- */

    it(
      "refresh works",
      async () => {
        const loginBody =
          await login();


        const oldRefreshToken =
          loginBody.refreshToken;


        const response =
          await app.inject({
            method: "POST",
            url: "/auth/refresh",

            payload: {
              refreshToken:
                oldRefreshToken,
            },
          });


        expect(
          response.statusCode
        ).toBe(200);


        const body =
          response.json();


        expect(
          body.tokenType
        ).toBe("Bearer");


        expect(
          body.accessToken
        ).toBeDefined();


        expect(
          body.refreshToken
        ).toBeDefined();


        expect(
          body.refreshToken
        ).not.toBe(
          oldRefreshToken
        );
      }
    );



    it("concurrent refresh requests create only one replacement", async () => {
      // Create a fresh refresh token.
      const loginBody = await login();
      const originalToken = loginBody.refreshToken;

      // Send two refresh requests simultaneously.
      const [responseA, responseB] = await Promise.all([
        app.inject({
          method: "POST",
          url: "/auth/refresh",
          payload: { refreshToken: originalToken },
        }),
        app.inject({
          method: "POST",
          url: "/auth/refresh",
          payload: { refreshToken: originalToken },
        }),
      ]);

      // Exactly one request should succeed.
      const statuses = [
        responseA.statusCode,
        responseB.statusCode,
      ].sort();

      expect(statuses).toEqual([200, 401]);

      // The old token should be revoked.
      const originalHash = hashRefreshToken(originalToken);

      const original = await prisma.refreshToken.findUnique({
        where: { tokenHash: originalHash },
      });

      expect(original?.revoked).toBe(true);
      expect(original?.replacedBy).toBeTruthy();

      // There must be exactly one replacement linked
      // to the original token.
      const replacements = await prisma.refreshToken.findMany({
        where: {
          userId,
          replaces: {
            is: {
              id: original!.id,
            },
          },
        },
      });

      expect(replacements).toHaveLength(1);
      expect(replacements[0].id).toBe(original?.replacedBy);
    });



    /* -----------------------------------------------------
       OLD TOKEN BECOMES REVOKED
       ----------------------------------------------------- */

    it(
      "old token becomes revoked after refresh",
      async () => {
        const loginBody =
          await login();


        const oldRefreshToken =
          loginBody.refreshToken;


        const oldTokenHash =
          hashRefreshToken(
            oldRefreshToken
          );


        const response =
          await app.inject({
            method: "POST",
            url: "/auth/refresh",

            payload: {
              refreshToken:
                oldRefreshToken,
            },
          });


        expect(
          response.statusCode
        ).toBe(200);


        const body =
          response.json();


        const storedOldToken =
          await prisma
            .refreshToken
            .findUnique({
              where: {
                tokenHash:
                  oldTokenHash,
              },
            });


        expect(
          storedOldToken
        ).not.toBeNull();


        expect(
          storedOldToken?.revoked
        ).toBe(true);


        expect(
          storedOldToken?.replacedBy
        ).not.toBeNull();


        const newTokenHash =
          hashRefreshToken(
            body.refreshToken
          );


        const replacement =
          await prisma
            .refreshToken
            .findUnique({
              where: {
                tokenHash:
                  newTokenHash,
              },
            });


        expect(
          replacement
        ).not.toBeNull();


        expect(
          replacement?.revoked
        ).toBe(false);


        expect(
          storedOldToken?.replacedBy
        ).toBe(
          replacement?.id
        );
      }
    );


    /* -----------------------------------------------------
       OLD TOKEN CANNOT BE REUSED
       ----------------------------------------------------- */

    it(
      "old refresh token cannot be reused",
      async () => {
        const loginBody =
          await login();


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


        expect(
          body.error
        ).toBe(
          "Refresh token reuse detected; sessions revoked"
        );
      }
    );


    /* -----------------------------------------------------
       LOGOUT REVOKES TOKEN
       ----------------------------------------------------- */

    it(
      "logout revokes the refresh token",
      async () => {
        const loginBody =
          await login();


        const refreshToken =
          loginBody.refreshToken;


        const tokenHash =
          hashRefreshToken(
            refreshToken
          );


        const beforeLogout =
          await prisma
            .refreshToken
            .findUnique({
              where: {
                tokenHash,
              },
            });


        expect(
          beforeLogout
        ).not.toBeNull();


        expect(
          beforeLogout?.revoked
        ).toBe(false);


        const response =
          await app.inject({
            method: "POST",
            url: "/auth/logout",

            payload: {
              refreshToken,
            },
          });


        expect(
          response.statusCode
        ).toBe(204);


        const afterLogout =
          await prisma
            .refreshToken
            .findUnique({
              where: {
                tokenHash,
              },
            });


        expect(
          afterLogout
        ).not.toBeNull();


        expect(
          afterLogout?.revoked
        ).toBe(true);
      }
    );


    it("logout all revokes all refresh sessions", async () => {
      const loginOne = await app.inject({
        method: "POST",
        url: "/login",

        payload: {
          identifier: testUser.username,
          password: testUser.password,
        },
      });

      expect(loginOne.statusCode).toBe(200);

      const sessionOne =
        loginOne.json();

      const loginTwo = await app.inject({
        method: "POST",
        url: "/login",

        payload: {
          identifier: testUser.username,
  password: testUser.password,
        },
      });

      expect(loginTwo.statusCode).toBe(200);

      const sessionTwo =
        loginTwo.json();

      expect(
        sessionOne.refreshToken
      ).not.toBe(
        sessionTwo.refreshToken
      );

      const logout = await app.inject({
        method: "POST",
        url: "/auth/logout-all",

        headers: {
          authorization:
            `Bearer ${sessionOne.accessToken}`,
        },
      });

      expect(logout.statusCode).toBe(204);

      const refreshOne = await app.inject({
        method: "POST",
        url: "/auth/refresh",

        payload: {
          refreshToken:
            sessionOne.refreshToken,
        },
      });

      expect(
        refreshOne.statusCode
      ).toBe(401);

      const refreshTwo = await app.inject({
        method: "POST",
        url: "/auth/refresh",

        payload: {
          refreshToken:
            sessionTwo.refreshToken,
        },
      });

      expect(
        refreshTwo.statusCode
      ).toBe(401);
    });

    /* -----------------------------------------------------
       EXPIRED TOKEN
       ----------------------------------------------------- */

    it(
      "expired refresh token is rejected",
      async () => {
        const loginBody =
          await login();


        const refreshToken =
          loginBody.refreshToken;


        const tokenHash =
          hashRefreshToken(
            refreshToken
          );


        await prisma
          .refreshToken
          .update({
            where: {
              tokenHash,
            },

            data: {
              expiresAt:
                new Date(
                  Date.now()
                    - 60_000
                ),
            },
          });


        const response =
          await app.inject({
            method: "POST",
            url: "/auth/refresh",

            payload: {
              refreshToken,
            },
          });


        expect(
          response.statusCode
        ).toBe(401);


        const body =
          response.json();


        expect(
          body.error
        ).toBe(
          "Refresh token expired"
        );


        const storedToken =
          await prisma
            .refreshToken
            .findUnique({
              where: {
                tokenHash,
              },
            });


        expect(
          storedToken
        ).not.toBeNull();


        expect(
          storedToken?.revoked
        ).toBe(true);
      }
    );


    /* -----------------------------------------------------
       RANDOM TOKEN
       ----------------------------------------------------- */

    it(
      "random refresh token is rejected",
      async () => {
        const randomToken =
          randomBytes(32)
            .toString(
              "base64url"
            );


        const response =
          await app.inject({
            method: "POST",
            url: "/auth/refresh",

            payload: {
              refreshToken:
                randomToken,
            },
          });


        expect(
          response.statusCode
        ).toBe(401);


        const body =
          response.json();


        expect(
          body.error
        ).toBe(
          "Invalid refresh token"
        );


        const tokenHash =
          hashRefreshToken(
            randomToken
          );


        const storedToken =
          await prisma
            .refreshToken
            .findUnique({
              where: {
                tokenHash,
              },
            });


        expect(
          storedToken
        ).toBeNull();
      }
    );
  }
);