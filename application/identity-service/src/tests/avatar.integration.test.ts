import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import {
  access,
  unlink,
} from "node:fs/promises";

import {
  basename,
  join,
} from "node:path";

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
  .slice(0, 10);

const testUser = {
  username:
    `avatar_${suffix}`,

  email:
    `avatar_${suffix}@example.com`,

  password:
    "Strongpassword123",

  displayName:
    "Avatar Test",
};

let userId: string;
let accessToken: string;
let storedAvatarPath:
  string | undefined;


function createMultipartFile(
  content: Buffer
) {
  const boundary =
    "----avatar-integration";

  return {
    contentType:
      `multipart/form-data; boundary=${boundary}`,

    body: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="avatar"; filename="test.png"\r\n` +
        `Content-Type: image/png\r\n\r\n`
      ),

      content,

      Buffer.from(
        `\r\n--${boundary}--\r\n`
      ),
    ]),
  };
}


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

  userId = body.user.id;

  accessToken =
    body.accessToken;
});


afterAll(async () => {
  if (storedAvatarPath) {
    await unlink(
      storedAvatarPath
    ).catch(() => {});
  }

  if (userId) {
    await prisma
      .refreshToken
      .deleteMany({
        where: {
          userId,
        },
      });

    await prisma
      .friendship
      .deleteMany({
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

    await prisma
      .user
      .deleteMany({
        where: {
          id: userId,
        },
      });
  }

  await app.close();

  await prisma.$disconnect();
});


describe(
  "Avatar upload integration",
  {
    concurrent: false,
  },
  () => {
    it(
      "stores avatar and updates avatarUrl",
      async () => {
        const multipart =
          createMultipartFile(
            Buffer.from([
              0x89,
              0x50,
              0x4e,
              0x47,
            ])
          );

        const response =
          await app.inject({
            method: "POST",

            url:
              "/me/avatar",

            headers: {
              authorization:
                `Bearer ${accessToken}`,

              "content-type":
                multipart.contentType,
            },

            payload:
              multipart.body,
          });

        expect(
          response.statusCode
        ).toBe(200);

        const body =
          response.json();

        expect(
          body.avatarUrl
        ).toMatch(
          /^\/avatars\/.+\.png$/
        );


        const storedUser =
          await prisma
            .user
            .findUnique({
              where: {
                id: userId,
              },
            });

        expect(
          storedUser?.avatarUrl
        ).toBe(
          body.avatarUrl
        );


        const avatarDirectory =
          process.env.AVATAR_DIR ??
          "/tmp/identity-avatars";

        storedAvatarPath =
          join(
            avatarDirectory,
            basename(
              body.avatarUrl
            )
          );


        /*
         * access() rejects if
         * the file doesn't exist.
         */
        await expect(
          access(
            storedAvatarPath
          )
        ).resolves
          .toBeUndefined();
      }
    );
  }
);