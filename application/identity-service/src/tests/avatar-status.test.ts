
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("../repositories/avatar-upload.repository.js", () => ({
  findAvatarUploadForUser: vi.fn(),
}));

vi.mock("../clients/media.client.js", () => ({
  getAvatarUploadStatus: vi.fn(),
}));

import {
  getAvatarUploadProgress,
} from "../services/avatar-status.service.js";

import {
  findAvatarUploadForUser,
} from "../repositories/avatar-upload.repository.js";

import {
  getAvatarUploadStatus,
} from "../clients/media.client.js";

const userId = "user-123";
const uploadId = "05da470a-417e-4f40-9c9b-304aa1a74feb";

describe("Avatar upload status", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(findAvatarUploadForUser).mockResolvedValue({
      id: uploadId,
      userId,
      revision: 1,
      status: "PENDING",
    } as never);
  });

  it("returns READY when Media processing succeeds", async () => {
    vi.mocked(getAvatarUploadStatus).mockResolvedValue({
      uploadId,
      status: "READY",
      errorCode: "",
      deletionPending: false,
    });

    const result = await getAvatarUploadProgress(
      userId,
      uploadId,
    );

    expect(result).toEqual({
      uploadId,
      status: "READY",
      errorCode: "",
      deletionPending: false,
    });

    expect(getAvatarUploadStatus).toHaveBeenCalledWith(
      uploadId,
      userId,
    );
  });

  it("returns PROCESSING when Media is still working", async () => {
    vi.mocked(getAvatarUploadStatus).mockResolvedValue({
      uploadId,
      status: "PROCESSING",
      errorCode: "",
      deletionPending: false,
    });

    const result = await getAvatarUploadProgress(
      userId,
      uploadId,
    );

    expect(result.status).toBe("PROCESSING");
  });

  it("returns the failure reason when an image fails processing", async () => {
    vi.mocked(getAvatarUploadStatus).mockResolvedValue({
      uploadId,
      status: "FAILED",
      errorCode: "IMAGE_PROCESSING_FAILED",
      deletionPending: false,
    });

    const result = await getAvatarUploadProgress(
      userId,
      uploadId,
    );

    expect(result.status).toBe("FAILED");
    expect(result.errorCode).toBe(
      "IMAGE_PROCESSING_FAILED",
    );
  });

  it("rejects an upload not owned by the user", async () => {
    vi.mocked(findAvatarUploadForUser).mockResolvedValue(
      null,
    );

    await expect(
      getAvatarUploadProgress(userId, uploadId),
    ).rejects.toThrow("Avatar upload not found");

    expect(getAvatarUploadStatus).not.toHaveBeenCalled();
  });

  it("propagates Media unavailability without inventing a status", async () => {
    vi.mocked(getAvatarUploadStatus).mockRejectedValue(
      new Error("Media unavailable"),
    );

    await expect(
      getAvatarUploadProgress(userId, uploadId),
    ).rejects.toThrow("Media unavailable");
  });
});
