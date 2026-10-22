
import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { randomUUID } from "node:crypto";

import { prisma } from "../database/prisma.js";

import {
  registerAvatarUpload,
  publishAvatarUpload,
} from "../repositories/avatar-upload.repository.js";

import {
  removeCurrentAvatar,
} from "../repositories/avatar-upload.repository.js";
import {
  markObsoleteAvatarUpload,
} from "../repositories/avatar-upload.repository.js";
describe("Avatar publication database integration", () => {
  const testUsers: string[] = [];
  let userId: string;

  beforeEach(async () => {
    const unique = randomUUID().replaceAll("-", "");

    const user = await prisma.user.create({
      data: {
        username: `avatar_${unique.slice(0, 20)}`,
        email: `avatar_${unique}@example.test`,
        displayName: "Avatar Integration Test",
      },
    });

    userId = user.id;
    testUsers.push(user.id);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: {
        id: { in: testUsers },
      },
    });

    await prisma.$disconnect();
  });

  it("does not allow an older upload to replace a newer avatar", async () => {
    const oldUploadId = randomUUID();
    const newUploadId = randomUUID();

    await registerAvatarUpload(userId, oldUploadId);
    await registerAvatarUpload(userId, newUploadId);

    const published = await publishAvatarUpload(
      userId,
      newUploadId,
    );

    expect(published.status).toBe("PUBLISHED");

    const stale = await publishAvatarUpload(
      userId,
      oldUploadId,
    );

    expect(stale.status).toBe("STALE");

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });

    expect(user.avatarMediaId).toBe(newUploadId);

    const oldUpload = await prisma.avatarUpload.findUniqueOrThrow({
      where: { id: oldUploadId },
    });

    expect(oldUpload.status).toBe("STALE");

    const cleanup = await prisma.avatarCleanupJob.findMany({
      where: {
        userId,
        mediaId: oldUploadId,
      },
    });

    expect(cleanup).toHaveLength(1);
  });

  it("does not duplicate cleanup jobs on repeated confirmation", async () => {
    const firstId = randomUUID();
    const secondId = randomUUID();

    await registerAvatarUpload(userId, firstId);
    await publishAvatarUpload(userId, firstId);

    await registerAvatarUpload(userId, secondId);
    await publishAvatarUpload(userId, secondId);

    // Retry confirmation of the current avatar.
    const repeated = await publishAvatarUpload(
      userId,
      secondId,
    );

    expect(repeated.status).toBe("PUBLISHED");

    const cleanup = await prisma.avatarCleanupJob.findMany({
      where: {
        userId,
        mediaId: firstId,
      },
    });

    expect(cleanup).toHaveLength(1);
  });

  it("deletion prevents an old upload from becoming active", async () => {
    const uploadId = randomUUID();

    await registerAvatarUpload(userId, uploadId);

    await removeCurrentAvatar(userId);

    const result = await publishAvatarUpload(
      userId,
      uploadId,
    );

    expect(result.status).toBe("STALE");

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });

    expect(user.avatarMediaId).toBeNull();
    expect(user.avatarRevision).toBe(2);
  });

  it("queues the previous avatar when publishing a replacement", async () => {
    const firstId = randomUUID();
    const secondId = randomUUID();

    await registerAvatarUpload(userId, firstId);
    await publishAvatarUpload(userId, firstId);

    await registerAvatarUpload(userId, secondId);
    await publishAvatarUpload(userId, secondId);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });

    expect(user.avatarMediaId).toBe(secondId);

    const cleanup = await prisma.avatarCleanupJob.findMany({
      where: {
        userId,
        mediaId: firstId,
        completedAt: null,
      },
    });

    expect(cleanup).toHaveLength(1);
  });

it("handles simultaneous confirmations of the same upload", async () => {
  const uploadId = randomUUID();

  await registerAvatarUpload(userId, uploadId);

  const results = await Promise.allSettled([
    publishAvatarUpload(userId, uploadId),
    publishAvatarUpload(userId, uploadId),
  ]);

  const successes = results.filter(
    (result) =>
      result.status === "fulfilled" &&
      result.value.status === "PUBLISHED",
  );

  expect(successes.length).toBeGreaterThanOrEqual(1);
expect(successes.length).toBeLessThanOrEqual(2);
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
  });

  expect(user.avatarMediaId).toBe(uploadId);

  const upload = await prisma.avatarUpload.findUniqueOrThrow({
    where: { id: uploadId },
  });

  expect(upload.status).toBe("PUBLISHED");

  // Publishing the same avatar must never
  // schedule its deletion.
  const cleanup = await prisma.avatarCleanupJob.findMany({
    where: {
      userId,
      mediaId: uploadId,
    },
  });

  expect(cleanup).toHaveLength(0);
});


it("marks an obsolete upload stale and schedules cleanup once", async () => {
  const uploadId = randomUUID();

  await registerAvatarUpload(userId, uploadId);

  // User deletes the avatar while this upload
  // is still pending.
  await removeCurrentAvatar(userId);

  const first = await markObsoleteAvatarUpload(
    userId,
    uploadId,
  );

  const second = await markObsoleteAvatarUpload(
    userId,
    uploadId,
  );

  expect(first).toBe(true);
  expect(second).toBe(false);

  const upload = await prisma.avatarUpload.findUniqueOrThrow({
    where: { id: uploadId },
  });

  expect(upload.status).toBe("STALE");

  const jobs = await prisma.avatarCleanupJob.findMany({
    where: {
      userId,
      mediaId: uploadId,
    },
  });

  expect(jobs).toHaveLength(1);
});

it("never schedules cleanup for the current avatar", async () => {
  const uploadId = randomUUID();

  await registerAvatarUpload(userId, uploadId);
  await publishAvatarUpload(userId, uploadId);

  const reconciled = await markObsoleteAvatarUpload(
    userId,
    uploadId,
  );

  expect(reconciled).toBe(false);

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
  });

  expect(user.avatarMediaId).toBe(uploadId);

  const jobs = await prisma.avatarCleanupJob.findMany({
    where: {
      userId,
      mediaId: uploadId,
    },
  });

  expect(jobs).toHaveLength(0);
});


it("keeps avatar state consistent when confirmation and deletion race", async () => {
  const uploadId = randomUUID();

  await registerAvatarUpload(userId, uploadId);

  const results = await Promise.allSettled([
    publishAvatarUpload(userId, uploadId),
    removeCurrentAvatar(userId),
  ]);

  console.log(
  "Concurrent avatar operation results:",
  results.map((result, index) => ({
    operation: index === 0 ? "publish" : "delete",
    status: result.status,
    value:
      result.status === "fulfilled"
        ? result.value
        : undefined,
    error:
      result.status === "rejected"
        ? {
            name: result.reason?.name,
            message: result.reason?.message,
            code: result.reason?.code,
          }
        : undefined,
  })),
);
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
  });

  const upload = await prisma.avatarUpload.findUniqueOrThrow({
    where: { id: uploadId },
  });

  const cleanup = await prisma.avatarCleanupJob.findMany({
    where: {
      userId,
      mediaId: uploadId,
    },
  });

  // Deletion advances the revision, preventing
  // an older confirmation from restoring the avatar.
  expect(user.avatarMediaId).toBeNull();

  
const [publishResult, deleteResult] = results;

// Deletion must succeed in this test.
expect(deleteResult.status).toBe("fulfilled");

// Deletion must leave no active avatar.
expect(user.avatarMediaId).toBeNull();

if (publishResult.status === "fulfilled") {
  expect(publishResult.value.status).toBe("PUBLISHED");
  expect(upload.status).toBe("PUBLISHED");

  // Publication succeeded before deletion.
  // Deletion must have scheduled cleanup.
  expect(cleanup).toHaveLength(1);
} else {
  expect(publishResult.reason).toBeInstanceOf(Error);
  expect(publishResult.reason.message).toMatch(
    /A newer avatar selection exists/,
  );

  // The confirmation transaction rolled back.
  expect(upload.status).toBe("PENDING");

  // Nothing was published, so deletion had no
  // active avatar reference to clean up.
  expect(cleanup).toHaveLength(0);
}

  // Neither concurrent operation should create
  // multiple cleanup jobs for the same media.
  expect(cleanup.length).toBeLessThanOrEqual(1);

  // Inspect whether either operation failed.
  for (const result of results) {
    for (const result of results) {
  if (result.status === "rejected") {
    expect(result.reason).toBeInstanceOf(Error);
    expect(result.reason.message).toMatch(
      /Avatar changed|newer avatar|Upload state changed/i,
    );
  }
}
  }
});


});
