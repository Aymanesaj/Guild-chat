import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import {
  randomUUID,
} from "node:crypto";

import {
  buildApp,
} from "../app.js";

import {
  prisma,
} from "../database/prisma.js";


const app = buildApp();

const suffix =
  randomUUID()
    .replaceAll("-", "")
    .slice(0, 10);


let callerId: string;
let targetId: string;
let accessToken: string;


beforeAll(async () => {
  const callerResponse =
    await app.inject({
      method: "POST",

      url: "/register",

      payload: {
        username:
          `caller_${suffix}`,

        email:
          `caller_${suffix}@example.com`,

        password:
          "Strongpassword123",

        displayName:
          "Caller",
      },
    });


  expect(
    callerResponse.statusCode
  ).toBe(201);


  const callerBody =
    callerResponse.json();


  callerId =
    callerBody.user.id;

  accessToken =
    callerBody.accessToken;


  const targetResponse =
    await app.inject({
      method: "POST",

      url: "/register",

      payload: {
        username:
          `target_${suffix}`,

        email:
          `target_${suffix}@example.com`,

        password:
          "Strongpassword123",

        displayName:
          "Target User",
      },
    });


  expect(
    targetResponse.statusCode
  ).toBe(201);


  targetId =
    targetResponse.json().user.id;
});


afterAll(async () => {
  const ids =
    [
      callerId,
      targetId,
    ].filter(Boolean);


  if (ids.length > 0) {
    await prisma
      .refreshToken
      .deleteMany({
        where: {
          userId: {
            in: ids,
          },
        },
      });


    await prisma
      .friendship
      .deleteMany({
        where: {
          OR: [
            {
              requesterId: {
                in: ids,
              },
            },

            {
              addresseeId: {
                in: ids,
              },
            },
          ],
        },
      });


    await prisma
      .user
      .deleteMany({
        where: {
          id: {
            in: ids,
          },
        },
      });
  }


  await app.close();

  await prisma.$disconnect();
});


describe(
  "GET /users/:id integration",
  {
    concurrent: false,
  },
  () => {
    it(
      "returns another user from the database",
      async () => {
        const response =
          await app.inject({
            method: "GET",

            url:
              `/${targetId}`,

            headers: {
              authorization:
                `Bearer ${accessToken}`,
            },
          });


        expect(
          response.statusCode
        ).toBe(200);


        const body =
          response.json();


        expect(body.id).toBe(
          targetId
        );

        expect(body.username)
          .toBe(
            `target_${suffix}`
          );

        expect(
          body.displayName
        ).toBe(
          "Target User"
        );


        expect(
          body.passwordHash
        ).toBeUndefined();

        expect(
          body.oauthProviderId
        ).toBeUndefined();
      }
    );


    it(
      "allows fetching the authenticated user's own profile",
      async () => {
        const response =
          await app.inject({
            method: "GET",

            url:
              `/${callerId}`,

            headers: {
              authorization:
                `Bearer ${accessToken}`,
            },
          });


        expect(
          response.statusCode
        ).toBe(200);

        expect(
          response.json().id
        ).toBe(callerId);
      }
    );


    it(
      "returns 404 for a valid UUID that does not exist",
      async () => {
        const response =
          await app.inject({
            method: "GET",

            url:
              `/${randomUUID()}`,

            headers: {
              authorization:
                `Bearer ${accessToken}`,
            },
          });


        expect(
          response.statusCode
        ).toBe(404);

        expect(
          response.json().error
        ).toBe(
          "User not found"
        );
      }
    );


    it(
      "returns 400 for an invalid UUID",
      async () => {
        const response =
          await app.inject({
            method: "GET",

            url:
              "/not-a-uuid",

            headers: {
              authorization:
                `Bearer ${accessToken}`,
            },
          });


        expect(
          response.statusCode
        ).toBe(400);
      }
    );


    it(
      "returns 401 without authentication",
      async () => {
        const response =
          await app.inject({
            method: "GET",

            url:
              `/${targetId}`,
          });


        expect(
          response.statusCode
        ).toBe(401);
      }
    );
  }
);