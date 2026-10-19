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

const suffix = randomUUID()
  .replaceAll("-", "")
  .slice(0, 12);


const testUser = {
  username: `profile_${suffix}`,
  email: `profile_${suffix}@example.com`,
  password: "Strongpassword123",
  displayName: "Original Name",
};


let userId: string;
let accessToken: string;


/* =========================================================
   SETUP
   ========================================================= */

beforeAll(async () => {
  const registerResponse =
    await app.inject({
      method: "POST",
      url: "/register",

      payload: testUser,
    });


  expect(
    registerResponse.statusCode
  ).toBe(201);


  const registerBody =
    registerResponse.json();


  userId = registerBody.user.id;


  const loginResponse =
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
    loginResponse.statusCode
  ).toBe(200);


  const loginBody =
    loginResponse.json();


  accessToken =
    loginBody.accessToken;
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
            requesterId: userId,
          },
          {
            addresseeId: userId,
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
   PROFILE UPDATE
   ========================================================= */

describe(
  "Profile update integration",
  {
    concurrent: false,
  },
  () => {

    it(
      "updates display name and bio in the database",
      async () => {
        const response =
          await app.inject({
            method: "PUT",
            url: "/me",

            headers: {
              authorization:
                `Bearer ${accessToken}`,
            },

            payload: {
              displayName:
                "Updated Name",

              bio:
                "Software engineering student",
            },
          });


        expect(
          response.statusCode
        ).toBe(200);


        const body =
          response.json();


        expect(
          body.displayName
        ).toBe(
          "Updated Name"
        );


        expect(
          body.bio
        ).toBe(
          "Software engineering student"
        );


        /*
         * Verify PostgreSQL was
         * actually updated.
         */
        const storedUser =
          await prisma.user.findUnique({
            where: {
              id: userId,
            },
          });


        expect(
          storedUser
        ).not.toBeNull();


        expect(
          storedUser?.displayName
        ).toBe(
          "Updated Name"
        );


        expect(
          storedUser?.bio
        ).toBe(
          "Software engineering student"
        );
      }
    );


    it(
      "updates username in the database",
      async () => {
        const newUsername =
          `updated_${suffix}`;


        const response =
          await app.inject({
            method: "PUT",
            url: "/me",

            headers: {
              authorization:
                `Bearer ${accessToken}`,
            },

            payload: {
              username:
                newUsername,
            },
          });


        expect(
          response.statusCode
        ).toBe(200);


        const body =
          response.json();


        expect(
          body.username
        ).toBe(
          newUsername
        );


        const storedUser =
          await prisma.user.findUnique({
            where: {
              id: userId,
            },
          });


        expect(
          storedUser?.username
        ).toBe(
          newUsername
        );
      }
    );


    it(
      "clears bio with null",
      async () => {
        const response =
          await app.inject({
            method: "PUT",
            url: "/me",

            headers: {
              authorization:
                `Bearer ${accessToken}`,
            },

            payload: {
              bio: null,
            },
          });


        expect(
          response.statusCode
        ).toBe(200);


        const body =
          response.json();


        expect(
          body.bio
        ).toBeNull();


        const storedUser =
          await prisma.user.findUnique({
            where: {
              id: userId,
            },
          });


        expect(
          storedUser?.bio
        ).toBeNull();
      }
    );


    it(
      "rejects a username already used by another user",
      async () => {
        const otherSuffix =
          randomUUID()
            .replaceAll("-", "")
            .slice(0, 12);


        const otherUsername =
          `other_${otherSuffix}`;


        const otherResponse =
          await app.inject({
            method: "POST",
            url: "/register",

            payload: {
              username:
                otherUsername,

              email:
                `other_${otherSuffix}@example.com`,

              password:
                "Strongpassword123",

              displayName:
                "Other User",
            },
          });


        expect(
          otherResponse.statusCode
        ).toBe(201);


        const otherBody =
          otherResponse.json();


        const otherUserId =
          otherBody.user.id;


        try {
          const response =
            await app.inject({
              method: "PUT",
              url: "/me",

              headers: {
                authorization:
                  `Bearer ${accessToken}`,
              },

              payload: {
                username:
                  otherUsername,
              },
            });


          expect(
            response.statusCode
          ).toBe(409);


          const body =
            response.json();


          expect(
            body.error
          ).toBe(
            "Username is already taken"
          );
        }
        finally {
          await prisma
            .refreshToken
            .deleteMany({
              where: {
                userId:
                  otherUserId,
              },
            });


          await prisma
            .user
            .deleteMany({
              where: {
                id:
                  otherUserId,
              },
            });
        }
      }
    );
  }
);