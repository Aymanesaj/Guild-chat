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


interface TestUser {
  id: string;
  username: string;
  accessToken: string;
}


const createdUserIds: string[] = [];


let alice: TestUser;
let bob: TestUser;
let charlie: TestUser;

let aliceBobRequestId: string;
let aliceCharlieRequestId: string;


function authorization(
  user: TestUser
) {
  return {
    authorization:
      `Bearer ${user.accessToken}`,
  };
}


async function createTestUser(
  name: string
): Promise<TestUser> {
  const suffix =
    randomUUID()
      .replaceAll("-", "")
      .slice(0, 8);

  const username =
    `test_${name}_${suffix}`;

  const response =
    await app.inject({
      method: "POST",
      url: "/register",

      payload: {
        username,
        email:
          `${username}@example.com`,
        password:
          "Strongpassword123",
        displayName:
          `Test ${name}`,
      },
    });


  expect(
    response.statusCode
  ).toBe(201);


  const body =
    response.json();


  expect(
    body.accessToken
  ).toBeDefined();

  expect(
    body.user.id
  ).toBeDefined();


  createdUserIds.push(
    body.user.id
  );


  return {
    id: body.user.id,
    username:
      body.user.username,
    accessToken:
      body.accessToken,
  };
}


describe(
  "Friendship endpoints integration",
  () => {

    beforeAll(
      async () => {
        await app.ready();

        alice =
          await createTestUser(
            "alice"
          );

        bob =
          await createTestUser(
            "bob"
          );

        charlie =
          await createTestUser(
            "charlie"
          );
      }
    );


    afterAll(
      async () => {

        /*
         * User deletion cascades to
         * friendships and refresh tokens
         * according to our Prisma schema.
         */
        if (
          createdUserIds.length > 0
        ) {
          await prisma.user.deleteMany({
            where: {
              id: {
                in: createdUserIds,
              },
            },
          });
        }

        await app.close();
      }
    );


    /*
     * ========================================================
     * 1. SEND FRIEND REQUEST
     * ========================================================
     */

    it(
      "Alice sends a friend request to Bob",
      async () => {

        const response =
          await app.inject({
            method: "POST",

            url:
              "/friends/requests",

            headers:
              authorization(
                alice
              ),

            payload: {
              addresseeId:
                bob.id,
            },
          });


        expect(
          response.statusCode
        ).toBe(201);


        const body =
          response.json();


        expect(
          body.requesterId
        ).toBe(
          alice.id
        );

        expect(
          body.addresseeId
        ).toBe(
          bob.id
        );

        expect(
          body.status
        ).toBe(
          "PENDING"
        );

        expect(
          body.pairKey
        ).toBeUndefined();


        aliceBobRequestId =
          body.id;
      }
    );


    /*
     * ========================================================
     * 2. DUPLICATE / REVERSE REQUEST
     * ========================================================
     */

    it(
      "Bob cannot create a reverse request while Alice's request is pending",
      async () => {

        const response =
          await app.inject({
            method: "POST",

            url:
              "/friends/requests",

            headers:
              authorization(
                bob
              ),

            payload: {
              addresseeId:
                alice.id,
            },
          });


        expect(
          response.statusCode
        ).toBe(409);
      }
    );


    /*
     * ========================================================
     * 3. GET FRIEND REQUESTS
     * ========================================================
     */

    it(
      "Alice sees the request as outgoing",
      async () => {

        const response =
          await app.inject({
            method: "GET",

            url:
              "/friends/requests",

            headers:
              authorization(
                alice
              ),
          });


        expect(
          response.statusCode
        ).toBe(200);


        const body =
          response.json();


        expect(
          body.outgoing.some(
            (request: {
              id: string;
            }) =>
              request.id ===
              aliceBobRequestId
          )
        ).toBe(true);


        expect(
          body.incoming.some(
            (request: {
              id: string;
            }) =>
              request.id ===
              aliceBobRequestId
          )
        ).toBe(false);
      }
    );


    it(
      "Bob sees the request as incoming",
      async () => {

        const response =
          await app.inject({
            method: "GET",

            url:
              "/friends/requests",

            headers:
              authorization(
                bob
              ),
          });


        expect(
          response.statusCode
        ).toBe(200);


        const body =
          response.json();


        expect(
          body.incoming.some(
            (request: {
              id: string;
            }) =>
              request.id ===
              aliceBobRequestId
          )
        ).toBe(true);
      }
    );


    /*
     * ========================================================
     * 4. ACCEPT FRIEND REQUEST
     * ========================================================
     */

    it(
      "Alice cannot accept her own outgoing request",
      async () => {

        const response =
          await app.inject({
            method: "POST",

            url:
              `/friends/requests/${aliceBobRequestId}/accept`,

            headers:
              authorization(
                alice
              ),
          });


        expect(
          response.statusCode
        ).toBe(403);
      }
    );


    it(
      "Bob accepts Alice's request",
      async () => {

        const response =
          await app.inject({
            method: "POST",

            url:
              `/friends/requests/${aliceBobRequestId}/accept`,

            headers:
              authorization(
                bob
              ),
          });


        expect(
          response.statusCode
        ).toBe(200);


        const body =
          response.json();


        expect(
          body.status
        ).toBe(
          "ACCEPTED"
        );

        expect(
          body.id
        ).toBe(
          aliceBobRequestId
        );
      }
    );


    /*
     * ========================================================
     * 5. GET FRIENDS
     * ========================================================
     */

    it(
      "Alice sees Bob in her friends list",
      async () => {

        const response =
          await app.inject({
            method: "GET",

            url:
              "/friends",

            headers:
              authorization(
                alice
              ),
          });


        expect(
          response.statusCode
        ).toBe(200);


        const friends =
          response.json();


        expect(
          friends.some(
            (friend: {
              id: string;
            }) =>
              friend.id ===
              bob.id
          )
        ).toBe(true);
      }
    );


    it(
      "Bob sees Alice in his friends list",
      async () => {

        const response =
          await app.inject({
            method: "GET",

            url:
              "/friends",

            headers:
              authorization(
                bob
              ),
          });


        expect(
          response.statusCode
        ).toBe(200);


        const friends =
          response.json();


        expect(
          friends.some(
            (friend: {
              id: string;
            }) =>
              friend.id ===
              alice.id
          )
        ).toBe(true);
      }
    );


    /*
     * ========================================================
     * 6. REMOVE FRIEND
     * ========================================================
     */

    it(
      "Alice removes Bob",
      async () => {

        const response =
          await app.inject({
            method: "DELETE",

            url:
              `/friends/${bob.id}`,

            headers:
              authorization(
                alice
              ),
          });


        expect(
          response.statusCode
        ).toBe(204);
      }
    );


    it(
      "Alice and Bob are no longer friends",
      async () => {

        const aliceResponse =
          await app.inject({
            method: "GET",

            url:
              "/friends",

            headers:
              authorization(
                alice
              ),
          });

        const bobResponse =
          await app.inject({
            method: "GET",

            url:
              "/friends",

            headers:
              authorization(
                bob
              ),
          });


        const aliceFriends =
          aliceResponse.json();

        const bobFriends =
          bobResponse.json();


        expect(
          aliceFriends.some(
            (friend: {
              id: string;
            }) =>
              friend.id ===
              bob.id
          )
        ).toBe(false);


        expect(
          bobFriends.some(
            (friend: {
              id: string;
            }) =>
              friend.id ===
              alice.id
          )
        ).toBe(false);
      }
    );


    /*
     * ========================================================
     * 7. CREATE REQUEST FOR DECLINE TEST
     * ========================================================
     */

    it(
      "Alice sends a request to Charlie",
      async () => {

        const response =
          await app.inject({
            method: "POST",

            url:
              "/friends/requests",

            headers:
              authorization(
                alice
              ),

            payload: {
              addresseeId:
                charlie.id,
            },
          });


        expect(
          response.statusCode
        ).toBe(201);


        aliceCharlieRequestId =
          response.json().id;
      }
    );


    /*
     * ========================================================
     * 8. DECLINE FRIEND REQUEST
     * ========================================================
     */

    it(
      "Alice cannot decline her own outgoing request",
      async () => {

        const response =
          await app.inject({
            method: "POST",

            url:
              `/friends/requests/${aliceCharlieRequestId}/decline`,

            headers:
              authorization(
                alice
              ),
          });


        expect(
          response.statusCode
        ).toBe(403);
      }
    );


    it(
      "Charlie declines Alice's request",
      async () => {

        const response =
          await app.inject({
            method: "POST",

            url:
              `/friends/requests/${aliceCharlieRequestId}/decline`,

            headers:
              authorization(
                charlie
              ),
          });


        expect(
          response.statusCode
        ).toBe(204);
      }
    );


    /*
     * ========================================================
     * 9. VERIFY DECLINED REQUEST IS GONE
     * ========================================================
     */

    it(
      "declined request disappears from pending requests",
      async () => {

        const aliceResponse =
          await app.inject({
            method: "GET",

            url:
              "/friends/requests",

            headers:
              authorization(
                alice
              ),
          });


        const charlieResponse =
          await app.inject({
            method: "GET",

            url:
              "/friends/requests",

            headers:
              authorization(
                charlie
              ),
          });


        expect(
          aliceResponse.statusCode
        ).toBe(200);

        expect(
          charlieResponse.statusCode
        ).toBe(200);


        const aliceRequests =
          aliceResponse.json();

        const charlieRequests =
          charlieResponse.json();


        expect(
          aliceRequests.outgoing.some(
            (request: {
              id: string;
            }) =>
              request.id ===
              aliceCharlieRequestId
          )
        ).toBe(false);


        expect(
          charlieRequests.incoming.some(
            (request: {
              id: string;
            }) =>
              request.id ===
              aliceCharlieRequestId
          )
        ).toBe(false);
      }
    );
  }
);