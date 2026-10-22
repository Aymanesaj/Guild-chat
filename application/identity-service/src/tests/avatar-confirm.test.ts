
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("../clients/media.client.js", () => ({
  finalizeAvatarUpload: vi.fn(),
  getAvatarDownloadUrl: vi.fn(),
}));

vi.mock("../repositories/avatar-upload.repository.js", () => ({
  findAvatarUploadForUser: vi.fn(),
  publishAvatarUpload: vi.fn(),
}));

import {
  confirmAvatarUpload,
} from "../services/avatar-confirm.service.js";

import {
  finalizeAvatarUpload,
  getAvatarDownloadUrl,
} from "../clients/media.client.js";

import {
  findAvatarUploadForUser,
  publishAvatarUpload,
} from "../repositories/avatar-upload.repository.js";

const userId = "user-123";
const uploadId = "05da470a-417e-4f40-9c9b-304aa1a74feb";

const readyMedia = {
  mediaId: uploadId,
  finalKey: "private/avatar.webp",
  contentType: "image/webp",
  width: 512,
  height: 512,
  status: "READY" as const,
};

describe("Avatar confirmation service", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    vi.mocked(findAvatarUploadForUser).mockResolvedValue({
      id: uploadId,
      userId,
      revision: 1,
      status: "PENDING",
    } as never);

    vi.mocked(finalizeAvatarUpload).mockResolvedValue(
      readyMedia,
    );

    vi.mocked(publishAvatarUpload).mockResolvedValue({
      status: "PUBLISHED",
    });

    vi.mocked(getAvatarDownloadUrl).mockResolvedValue({
      mediaId: uploadId,
      downloadUrl: "https://example.com/avatar.webp",
      contentType: "image/webp",
      expiresIn: 300,
    });
  });

  it("publishes a READY avatar", async () => {
    const result = await confirmAvatarUpload(
      userId,
      uploadId,
    );

    expect(finalizeAvatarUpload).toHaveBeenCalledWith(
      uploadId,
      userId,
    );

    expect(publishAvatarUpload).toHaveBeenCalledWith(
      userId,
      uploadId,
    );

    expect(getAvatarDownloadUrl).toHaveBeenCalledWith(
      uploadId,
      userId,
    );

    expect(result).toEqual({
      mediaId: uploadId,
      downloadUrl: "https://example.com/avatar.webp",
      contentType: "image/webp",
      width: 512,
      height: 512,
      expiresIn: 300,
    });
  });

  it("rejects an upload that does not belong to the user", async () => {
    vi.mocked(findAvatarUploadForUser).mockResolvedValue(
      null,
    );

    await expect(
      confirmAvatarUpload(userId, uploadId),
    ).rejects.toThrow("Avatar upload not found");

    expect(finalizeAvatarUpload).not.toHaveBeenCalled();
    expect(publishAvatarUpload).not.toHaveBeenCalled();
  });

  it("does not publish an image still processing", async () => {
    vi.mocked(finalizeAvatarUpload).mockResolvedValue({
      ...readyMedia,
      status: "PROCESSING",
    });

    await expect(
      confirmAvatarUpload(userId, uploadId),
    ).rejects.toThrow(
      "Avatar processing is not finished",
    );

    expect(publishAvatarUpload).not.toHaveBeenCalled();
    expect(getAvatarDownloadUrl).not.toHaveBeenCalled();
  });

  it("does not publish a stale upload", async () => {
    vi.mocked(publishAvatarUpload).mockResolvedValue({
      status: "STALE",
    });

    await expect(
      confirmAvatarUpload(userId, uploadId),
    ).rejects.toThrow(
      "A newer avatar selection exists",
    );

    expect(getAvatarDownloadUrl).not.toHaveBeenCalled();
  });

  it("preserves publication when URL signing fails", async () => {
    vi.mocked(getAvatarDownloadUrl).mockRejectedValue(
      new Error("Media signing unavailable"),
    );

    await expect(
      confirmAvatarUpload(userId, uploadId),
    ).rejects.toThrow("Media signing unavailable");

    // Publication happens before signing.
    expect(publishAvatarUpload).toHaveBeenCalledOnce();
  });


  it("rejects a mismatched media ID", async () => {
    vi.mocked(finalizeAvatarUpload).mockResolvedValue({
      ...readyMedia,
      mediaId: "another-media-id",
    });

    await expect(
      confirmAvatarUpload(userId, uploadId),
    ).rejects.toThrow(
      "Media returned an unexpected avatar ID",
    );

    expect(publishAvatarUpload).not.toHaveBeenCalled();
    expect(getAvatarDownloadUrl).not.toHaveBeenCalled();
  });

  it("rejects a previously rejected upload", async () => {
    vi.mocked(findAvatarUploadForUser).mockResolvedValue({
      id: uploadId,
      userId,
      revision: 1,
      status: "STALE",
    } as never);

    await expect(
      confirmAvatarUpload(userId, uploadId),
    ).rejects.toThrow(
      "Avatar upload is no longer available",
    );

    expect(finalizeAvatarUpload).not.toHaveBeenCalled();
  });
});
