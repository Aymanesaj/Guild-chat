
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("../repositories/user.repository.js", () => ({
  findUserAvatarById: vi.fn(),
}));

vi.mock("../clients/media.client.js", () => ({
  getAvatarDownloadUrl: vi.fn(),
}));

import { getUserAvatarUrl } from
  "../services/avatar-read.service.js";

import { findUserAvatarById } from
  "../repositories/user.repository.js";

import { getAvatarDownloadUrl } from
  "../clients/media.client.js";

describe("Avatar reading", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("gets the avatar using the owner's ID", async () => {
    vi.mocked(findUserAvatarById).mockResolvedValue({
      id: "owner-id",
      avatarMediaId: "media-id",
    });

    vi.mocked(getAvatarDownloadUrl).mockResolvedValue({
      mediaId: "media-id",
      downloadUrl: "https://example.com/avatar.webp",
      contentType: "image/webp",
      expiresIn: 300,
    });

    const result = await getUserAvatarUrl("owner-id");

    expect(getAvatarDownloadUrl).toHaveBeenCalledWith(
      "media-id",
      "owner-id",
    );

    expect(result?.downloadUrl).toBe(
      "https://example.com/avatar.webp",
    );
  });

  it("returns null when the user has no avatar", async () => {
    vi.mocked(findUserAvatarById).mockResolvedValue({
      id: "owner-id",
      avatarMediaId: null,
    });

    const result = await getUserAvatarUrl("owner-id");

    expect(result).toBeNull();
    expect(getAvatarDownloadUrl).not.toHaveBeenCalled();
  });

  it("rejects a nonexistent user", async () => {
    vi.mocked(findUserAvatarById).mockResolvedValue(null);

    await expect(
      getUserAvatarUrl("missing-id"),
    ).rejects.toThrow("User not found");

    expect(getAvatarDownloadUrl).not.toHaveBeenCalled();
  });
});
