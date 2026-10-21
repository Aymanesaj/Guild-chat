import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";

import { buildApp } from "../app.js";
import { prisma } from "../database/prisma.js";
import { publishFriendshipEvent } from "../messaging/friendship.publisher.js";
import { declinePendingFriendRequest } from
  "../repositories/friendship.repository.js";

// Keep the real Fastify and PostgreSQL integration, but avoid opening
// a real RabbitMQ connection in friendship endpoint tests.
vi.mock("../messaging/friendship.publisher.js", () => ({
  publishFriendshipEvent: vi.fn().mockResolvedValue(undefined),
}));

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

function authorization(user: TestUser) {
  return { authorization: `Bearer ${user.accessToken}` };
}

async function createTestUser(name: string): Promise<TestUser> {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  const username = `test_${name}_${suffix}`;

  const response = await app.inject({
    method: "POST",
    url: "/register",
    payload: {
      username,
      email: `${username}@example.com`,
      password: "Strongpassword123",
      displayName: `Test ${name}`,
    },
  });

  expect(response.statusCode).toBe(201);
  const body = response.json();
  expect(body.accessToken).toBeDefined();
  expect(body.user.id).toBeDefined();

  createdUserIds.push(body.user.id);
  return {
    id: body.user.id,
    username: body.user.username,
    accessToken: body.accessToken,
  };
}

describe("Friendship endpoints integration", () => {
  beforeAll(async () => {
    await app.ready();
    alice = await createTestUser("alice");
    bob = await createTestUser("bob");
    charlie = await createTestUser("charlie");
  });

  beforeEach(() => {
    vi.mocked(publishFriendshipEvent).mockClear();
  });

  afterAll(async () => {
    try {
      // Deleting the users cascades to friendships and refresh tokens.
      if (createdUserIds.length > 0) {
        await prisma.user.deleteMany({
          where: { id: { in: createdUserIds } },
        });
      }
    } finally {
      await app.close();
    }
  });

  it("Alice sends a friend request to Bob", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/friends/requests",
      headers: authorization(alice),
      payload: { addresseeId: bob.id },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.requesterId).toBe(alice.id);
    expect(body.addresseeId).toBe(bob.id);
    expect(body.status).toBe("PENDING");
    expect(body.pairKey).toBeUndefined();
    aliceBobRequestId = body.id;

    expect(publishFriendshipEvent).toHaveBeenCalledTimes(1);
    expect(publishFriendshipEvent).toHaveBeenCalledWith(
      "FRIEND_REQUEST_SENT",
      {
        friendshipId: aliceBobRequestId,
        requesterId: alice.id,
        addresseeId: bob.id,
      },
    );
  });

  it("Bob cannot create a reverse request while Alice's request is pending", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/friends/requests",
      headers: authorization(bob),
      payload: { addresseeId: alice.id },
    });

    expect(response.statusCode).toBe(409);
    expect(publishFriendshipEvent).not.toHaveBeenCalled();
  });

  it("Alice sees the request as outgoing", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/friends/requests",
      headers: authorization(alice),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.outgoing.some((request: { id: string }) =>
      request.id === aliceBobRequestId,
    )).toBe(true);
    expect(body.incoming.some((request: { id: string }) =>
      request.id === aliceBobRequestId,
    )).toBe(false);
  });

  it("Bob sees the request as incoming", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/friends/requests",
      headers: authorization(bob),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.incoming.some((request: { id: string }) =>
      request.id === aliceBobRequestId,
    )).toBe(true);
  });

  it("Alice cannot accept her own outgoing request", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/friends/requests/${aliceBobRequestId}/accept`,
      headers: authorization(alice),
    });

    expect(response.statusCode).toBe(403);
    expect(publishFriendshipEvent).not.toHaveBeenCalled();
  });

  it("Bob accepts Alice's request", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/friends/requests/${aliceBobRequestId}/accept`,
      headers: authorization(bob),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("ACCEPTED");
    expect(body.id).toBe(aliceBobRequestId);

    expect(publishFriendshipEvent).toHaveBeenCalledTimes(1);
    expect(publishFriendshipEvent).toHaveBeenCalledWith(
      "FRIEND_REQUEST_ACCEPTED",
      {
        friendshipId: aliceBobRequestId,
        requesterId: alice.id,
        addresseeId: bob.id,
      },
    );
  });

  it("Bob cannot accept an already accepted request again", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/friends/requests/${aliceBobRequestId}/accept`,
      headers: authorization(bob),
    });

    expect(response.statusCode).toBe(409);
    expect(publishFriendshipEvent).not.toHaveBeenCalled();
  });


  it("a stale decline cannot delete an accepted friendship", async () => {
    // Alice's request has already been accepted by Bob.
    // Simulate the delete step of a decline operation
    // that began before the acceptance completed.

    const result = await declinePendingFriendRequest(
      aliceBobRequestId,
      bob.id,
    );

    // An accepted friendship must not match
    // the conditional PENDING deletion.
    expect(result.count).toBe(0);

    // Verify the friendship still exists.
    const friendship = await prisma.friendship.findUnique({
      where: {
        id: aliceBobRequestId,
      },
    });

    expect(friendship).not.toBeNull();
    expect(friendship?.status).toBe("ACCEPTED");

    // No new friendship event should be published.
    expect(publishFriendshipEvent).not.toHaveBeenCalled();
  });

  it("Alice sees Bob in her friends list", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/friends",
      headers: authorization(alice),
    });

    expect(response.statusCode).toBe(200);
    const friends = response.json();
    expect(friends.some((friend: { id: string }) =>
      friend.id === bob.id,
    )).toBe(true);
  });

  it("Bob sees Alice in his friends list", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/friends",
      headers: authorization(bob),
    });

    expect(response.statusCode).toBe(200);
    const friends = response.json();
    expect(friends.some((friend: { id: string }) =>
      friend.id === alice.id,
    )).toBe(true);
  });

  it("Alice removes Bob", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: `/friends/${bob.id}`,
      headers: authorization(alice),
    });

    expect(response.statusCode).toBe(204);
    expect(publishFriendshipEvent).not.toHaveBeenCalled();
  });

  it("Alice and Bob are no longer friends", async () => {
    const aliceResponse = await app.inject({
      method: "GET",
      url: "/friends",
      headers: authorization(alice),
    });
    const bobResponse = await app.inject({
      method: "GET",
      url: "/friends",
      headers: authorization(bob),
    });

    expect(aliceResponse.statusCode).toBe(200);
    expect(bobResponse.statusCode).toBe(200);
    const aliceFriends = aliceResponse.json();
    const bobFriends = bobResponse.json();
    expect(aliceFriends.some((friend: { id: string }) =>
      friend.id === bob.id,
    )).toBe(false);
    expect(bobFriends.some((friend: { id: string }) =>
      friend.id === alice.id,
    )).toBe(false);
  });

  it("Alice sends a request to Charlie", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/friends/requests",
      headers: authorization(alice),
      payload: { addresseeId: charlie.id },
    });

    expect(response.statusCode).toBe(201);
    aliceCharlieRequestId = response.json().id;

    expect(publishFriendshipEvent).toHaveBeenCalledTimes(1);
    expect(publishFriendshipEvent).toHaveBeenCalledWith(
      "FRIEND_REQUEST_SENT",
      {
        friendshipId: aliceCharlieRequestId,
        requesterId: alice.id,
        addresseeId: charlie.id,
      },
    );
  });

  it("Alice cannot decline her own outgoing request", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/friends/requests/${aliceCharlieRequestId}/decline`,
      headers: authorization(alice),
    });

    expect(response.statusCode).toBe(403);
    expect(publishFriendshipEvent).not.toHaveBeenCalled();
  });

  it("Charlie declines Alice's request", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/friends/requests/${aliceCharlieRequestId}/decline`,
      headers: authorization(charlie),
    });

    expect(response.statusCode).toBe(204);
    expect(publishFriendshipEvent).not.toHaveBeenCalled();
  });

  it("declined request disappears from pending requests", async () => {
    const aliceResponse = await app.inject({
      method: "GET",
      url: "/friends/requests",
      headers: authorization(alice),
    });
    const charlieResponse = await app.inject({
      method: "GET",
      url: "/friends/requests",
      headers: authorization(charlie),
    });

    expect(aliceResponse.statusCode).toBe(200);
    expect(charlieResponse.statusCode).toBe(200);
    const aliceRequests = aliceResponse.json();
    const charlieRequests = charlieResponse.json();
    expect(aliceRequests.outgoing.some((request: { id: string }) =>
      request.id === aliceCharlieRequestId,
    )).toBe(false);
    expect(charlieRequests.incoming.some((request: { id: string }) =>
      request.id === aliceCharlieRequestId,
    )).toBe(false);
  });
});
