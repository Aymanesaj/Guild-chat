import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/database/prisma.js", () => ({
  prisma: {
    mediaUpload: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("../src/storage/r2.storage.js", () => ({
  deleteObject: vi.fn(),
}));

import { prisma } from "../src/database/prisma.js";
import { deleteObject } from "../src/storage/r2.storage.js";
import { cleanupUploads } from "../src/workers/cleanup.worker.js";

const findMany = vi.mocked(prisma.mediaUpload.findMany);
const updateMany = vi.mocked(prisma.mediaUpload.updateMany);
const removeObject = vi.mocked(deleteObject);

// Prisma's mock retains the full model return type, although these
// queries select only a few fields.
function queueResults(
  expired: unknown[],
  finalDeletes: unknown[],
  temporaryDeletes: unknown[],
) {
  findMany
    .mockResolvedValueOnce(
      expired as Awaited<ReturnType<typeof prisma.mediaUpload.findMany>>,
    )
    .mockResolvedValueOnce(
      finalDeletes as Awaited<ReturnType<typeof prisma.mediaUpload.findMany>>,
    )
    .mockResolvedValueOnce(
      temporaryDeletes as Awaited<ReturnType<typeof prisma.mediaUpload.findMany>>,
    );
}

describe("cleanupUploads", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    updateMany.mockResolvedValue({ count: 1 });
    removeObject.mockResolvedValue(undefined);
  });

  it("does nothing when no uploads need cleanup", async () => {
    queueResults([], [], []);

    await cleanupUploads();

    expect(removeObject).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("marks media deleted after R2 deletion succeeds", async () => {
    queueResults(
      [],
      [{ id: "media-1", finalKey: "chat/attachments/media-1.webp" }],
      [],
    );

    await cleanupUploads();

    expect(removeObject).toHaveBeenCalledWith(
      "chat/attachments/media-1.webp",
    );

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "DELETED",
          finalCleanupPending: false,
        }),
      }),
    );

    // The database must not report DELETED before storage succeeds.
    expect(removeObject.mock.invocationCallOrder[0]).toBeLessThan(
      updateMany.mock.invocationCallOrder[0]!,
    );
  });

  it("keeps final deletion pending when R2 fails", async () => {
    queueResults(
      [],
      [{ id: "media-1", finalKey: "chat/attachments/media-1.webp" }],
      [],
    );

    removeObject.mockRejectedValueOnce(new Error("R2 unavailable"));

    await cleanupUploads();

    // No update clears the flag or marks the object deleted.
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("continues cleaning other files after one deletion fails", async () => {
    queueResults(
      [],
      [],
      [
        { id: "upload-1", temporaryKey: "tmp/upload-1/source" },
        { id: "upload-2", temporaryKey: "tmp/upload-2/source" },
      ],
    );

    removeObject
      .mockRejectedValueOnce(new Error("R2 unavailable"))
      .mockResolvedValueOnce(undefined);

    await cleanupUploads();

    expect(removeObject).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledTimes(1);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "upload-2",
        }),
        data: {
          tempCleanupPending: false,
        },
      }),
    );
  });

  it("keeps temporary cleanup pending when deletion fails", async () => {
    queueResults(
      [],
      [],
      [{ id: "upload-1", temporaryKey: "tmp/upload-1/source" }],
    );

    removeObject.mockRejectedValueOnce(new Error("R2 unavailable"));

    await cleanupUploads();

    expect(updateMany).not.toHaveBeenCalled();
  });
});