
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
} from "vitest";

vi.mock("../clients/media.client.js", () => ({
  createAvatarUpload: vi.fn(),
}));

vi.mock("../repositories/avatar-upload.repository.js", () => ({
  registerAvatarUpload: vi.fn(),
}));

vi.mock("../repositories/user.repository.js", () => ({
  findUserById: vi.fn(),
}));

import {
  requestAvatarUpload,
} from "../services/avatar-upload.service.js";

import {
  createAvatarUpload,
} from "../clients/media.client.js";

import {
  registerAvatarUpload,
} from "../repositories/avatar-upload.repository.js";

import {
  findUserById,
} from "../repositories/user.repository.js";

describe("Avatar upload service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an upload session for an existing user", async () => {
    vi.mocked(findUserById).mockResolvedValue({
      id: "user-123",
    } as never);

    vi.mocked(createAvatarUpload).mockResolvedValue({
      uploadId: "upload-123",
      uploadUrl: "https://example.com/upload",
      requiredContentType: "image/png",
      expiresIn: 300,
    });

    vi.mocked(registerAvatarUpload).mockResolvedValue(
      {} as never,
    );

    const result = await requestAvatarUpload(
      "user-123",
      "image/png",
    );

    expect(createAvatarUpload).toHaveBeenCalledWith(
      "user-123",
      "image/png",
    );

    expect(registerAvatarUpload).toHaveBeenCalledWith(
      "user-123",
      "upload-123",
    );

    expect(result.uploadId).toBe("upload-123");
    expect(result.expiresIn).toBe(300);
  });

  it("rejects unsupported content types", async () => {
    vi.mocked(findUserById).mockResolvedValue({
      id: "user-123",
    } as never);

    await expect(
      requestAvatarUpload(
        "user-123",
        "application/pdf",
      ),
    ).rejects.toThrow(
      "Unsupported avatar content type",
    );

    expect(createAvatarUpload).not.toHaveBeenCalled();
  });

  it("rejects users that do not exist", async () => {
    vi.mocked(findUserById).mockResolvedValue(null);

    await expect(
      requestAvatarUpload(
        "missing-user",
        "image/png",
      ),
    ).rejects.toThrow("User not found");

    expect(createAvatarUpload).not.toHaveBeenCalled();
  });

  it("does not register an upload if Media fails", async () => {
    vi.mocked(findUserById).mockResolvedValue({
      id: "user-123",
    } as never);

    vi.mocked(createAvatarUpload).mockRejectedValue(
      new Error("Media unavailable"),
    );

    await expect(
      requestAvatarUpload(
        "user-123",
        "image/png",
      ),
    ).rejects.toThrow("Media unavailable");

    expect(registerAvatarUpload).not.toHaveBeenCalled();
  });
});
