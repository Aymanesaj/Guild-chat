import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import {
  mkdir,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  randomUUID,
} from "node:crypto";

import {
  join,
} from "node:path";

import {
  buildApp,
} from "../app.js";

import {
  AVATAR_DIR,
} from "../constants/avatar.constants.js";


const app = buildApp();

const suffix = randomUUID();

const pngFilename =
  `${suffix}.png`;

const jpgFilename =
  `${suffix}.jpg`;

const webpFilename =
  `${suffix}.webp`;

const gifFilename =
  `${suffix}.gif`;

const directoryFilename =
  `${suffix}-directory.png`;


const pngBytes = Buffer.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
]);

const jpgBytes = Buffer.from([
  0xff,
  0xd8,
  0xff,
  0xe0,
]);

const webpBytes = Buffer.from([
  0x52,
  0x49,
  0x46,
  0x46,
  0x00,
  0x00,
  0x00,
  0x00,
  0x57,
  0x45,
  0x42,
  0x50,
]);

const gifBytes = Buffer.from(
  "GIF89a"
);


const pngPath =
  join(
    AVATAR_DIR,
    pngFilename
  );

const jpgPath =
  join(
    AVATAR_DIR,
    jpgFilename
  );

const webpPath =
  join(
    AVATAR_DIR,
    webpFilename
  );

const gifPath =
  join(
    AVATAR_DIR,
    gifFilename
  );

const directoryPath =
  join(
    AVATAR_DIR,
    directoryFilename
  );


beforeAll(async () => {
  await mkdir(
    AVATAR_DIR,
    {
      recursive: true,
    }
  );


  await writeFile(
    pngPath,
    pngBytes
  );

  await writeFile(
    jpgPath,
    jpgBytes
  );

  await writeFile(
    webpPath,
    webpBytes
  );

  await writeFile(
    gifPath,
    gifBytes
  );

  await mkdir(
    directoryPath
  );
});


afterAll(async () => {
  await rm(
    pngPath,
    {
      force: true,
    }
  );

  await rm(
    jpgPath,
    {
      force: true,
    }
  );

  await rm(
    webpPath,
    {
      force: true,
    }
  );

  await rm(
    gifPath,
    {
      force: true,
    }
  );

  await rm(
    directoryPath,
    {
      recursive: true,
      force: true,
    }
  );

  await app.close();
});


describe(
  "GET /avatars/:filename",
  () => {

    it(
      "should return a PNG avatar",
      async () => {
        const response =
          await app.inject({
            method: "GET",

            url:
              `/avatars/${pngFilename}`,
          });


        expect(
          response.statusCode
        ).toBe(200);


        expect(
          response.headers[
            "content-type"
          ]
        ).toContain(
          "image/png"
        );


        expect(
          response.rawPayload
        ).toEqual(
          pngBytes
        );
      }
    );


    it(
      "should return a JPEG avatar",
      async () => {
        const response =
          await app.inject({
            method: "GET",

            url:
              `/avatars/${jpgFilename}`,
          });


        expect(
          response.statusCode
        ).toBe(200);


        expect(
          response.headers[
            "content-type"
          ]
        ).toContain(
          "image/jpeg"
        );


        expect(
          response.rawPayload
        ).toEqual(
          jpgBytes
        );
      }
    );


    it(
      "should return a WebP avatar",
      async () => {
        const response =
          await app.inject({
            method: "GET",

            url:
              `/avatars/${webpFilename}`,
          });


        expect(
          response.statusCode
        ).toBe(200);


        expect(
          response.headers[
            "content-type"
          ]
        ).toContain(
          "image/webp"
        );


        expect(
          response.rawPayload
        ).toEqual(
          webpBytes
        );
      }
    );


    it(
      "should be publicly accessible without authentication",
      async () => {
        const response =
          await app.inject({
            method: "GET",

            url:
              `/avatars/${pngFilename}`,
          });


        expect(
          response.statusCode
        ).toBe(200);
      }
    );


    it(
      "should not require a valid Authorization header",
      async () => {
        const response =
          await app.inject({
            method: "GET",

            url:
              `/avatars/${pngFilename}`,

            headers: {
              authorization:
                "Bearer definitely-invalid-token",
            },
          });
        expect(
          response.statusCode
        ).toBe(200);
      }
    );


    it(
      "should return 404 when avatar does not exist",
      async () => {
        const response =
          await app.inject({
            method: "GET",

            url:
              `/avatars/missing-${randomUUID()}.png`,
          });


        expect(
          response.statusCode
        ).toBe(404);


        const body =
          response.json();


        expect(
          body.error
        ).toBe(
          "Avatar not found"
        );
      }
    );


    it(
      "should reject unsupported extensions even when the file exists",
      async () => {
        const response =
          await app.inject({
            method: "GET",

            url:
              `/avatars/${gifFilename}`,
          });


        expect(
          response.statusCode
        ).toBe(404);


        const body =
          response.json();


        expect(
          body.error
        ).toBe(
          "Avatar not found"
        );
      }
    );


    it(
      "should reject a directory pretending to be an avatar",
      async () => {
        const response =
          await app.inject({
            method: "GET",

            url:
              `/avatars/${directoryFilename}`,
          });


        expect(
          response.statusCode
        ).toBe(404);


        const body =
          response.json();


        expect(
          body.error
        ).toBe(
          "Avatar not found"
        );
      }
    );


    it(
      "should reject path traversal attempts",
      async () => {
        const maliciousFilename =
          `%2e%2e%2fmissing-${randomUUID()}.png`;


        const response =
          await app.inject({
            method: "GET",

            url:
              `/avatars/${maliciousFilename}`,
          });
        expect(
          response.statusCode
        ).not.toBe(200);
      }
    );
  }
);