
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("../repositories/avatar-cleanup.repository.js", () => ({
  claimAvatarCleanupJobs: vi.fn(),
  completeAvatarCleanupJob: vi.fn(),
  retryAvatarCleanupJob: vi.fn(),
  findActiveAvatarReference: vi.fn(),
}));

vi.mock("../clients/media.client.js", () => ({
  deleteAvatarMedia: vi.fn(),
}));

import {
  processAvatarCleanupJobs,
} from "../services/avatar-cleanup.service.js";

import {
  claimAvatarCleanupJobs,
  completeAvatarCleanupJob,
  retryAvatarCleanupJob,
  findActiveAvatarReference,
} from "../repositories/avatar-cleanup.repository.js";

import {
  deleteAvatarMedia,
} from "../clients/media.client.js";

const job = {
  id: "job-123",
  userId: "user-123",
  mediaId: "media-123",
  attempts: 1,
};

describe("Avatar cleanup service", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(claimAvatarCleanupJobs).mockResolvedValue([
      job,
    ] as never);

    vi.mocked(findActiveAvatarReference).mockResolvedValue({
      avatarMediaId: null,
    });

    vi.mocked(deleteAvatarMedia).mockResolvedValue({
      mediaId: job.mediaId,
      status: "DELETED",
    });

    vi.mocked(completeAvatarCleanupJob).mockResolvedValue({
      count: 1,
    });

    vi.mocked(retryAvatarCleanupJob).mockResolvedValue({
      count: 1,
    });
  });

  it("deletes unreferenced media and completes the job", async () => {
    const result = await processAvatarCleanupJobs();

    expect(deleteAvatarMedia).toHaveBeenCalledWith(
      "media-123",
      "user-123",
    );

    expect(completeAvatarCleanupJob).toHaveBeenCalledWith(
      "job-123",
      1,
    );

    expect(result.completed).toBe(1);
    expect(result.retried).toBe(0);
  });

  it("does not delete the current avatar", async () => {
    vi.mocked(findActiveAvatarReference).mockResolvedValue({
      avatarMediaId: "media-123",
    });

    const result = await processAvatarCleanupJobs();

    expect(deleteAvatarMedia).not.toHaveBeenCalled();
    expect(retryAvatarCleanupJob).toHaveBeenCalledWith(
      "job-123",
      1,
    );

    expect(result.retried).toBe(1);
  });

  it("retries when Media deletion fails", async () => {
    vi.mocked(deleteAvatarMedia).mockRejectedValue(
      new Error("Media unavailable"),
    );

    const result = await processAvatarCleanupJobs();

    expect(completeAvatarCleanupJob).not.toHaveBeenCalled();
    expect(retryAvatarCleanupJob).toHaveBeenCalledWith(
      "job-123",
      1,
    );

    expect(result.retried).toBe(1);
  });

  it("does nothing when there are no pending jobs", async () => {
    vi.mocked(claimAvatarCleanupJobs).mockResolvedValue([]);

    const result = await processAvatarCleanupJobs();

    expect(result).toEqual({
      claimed: 0,
      completed: 0,
      retried: 0,
    });

    expect(deleteAvatarMedia).not.toHaveBeenCalled();
  });
});
