import { describe, expect, it } from "vitest";
import {
  MAX_IMAGE_BYTES,
  imageAspectRatio,
  imageFileError,
  imageLinkExpired,
  messagePreviewText,
  pickImages,
} from "./attachments";

const image = (name, type = "image/png", size = 1000) => ({ name, type, size });

describe("imageFileError", () => {
  it("accepts JPEG, PNG and WebP up to 10 MB", () => {
    expect(imageFileError(image("a.jpg", "image/jpeg"))).toBeNull();
    expect(imageFileError(image("a.png", "image/png"))).toBeNull();
    expect(imageFileError(image("a.webp", "image/webp", MAX_IMAGE_BYTES))).toBeNull();
  });

  it("refuses other types, before looking at the size", () => {
    expect(imageFileError(image("a.gif", "image/gif"))).toMatch(/JPEG, PNG and WebP/);
    expect(imageFileError(image("a.pdf", "application/pdf", MAX_IMAGE_BYTES + 1))).toMatch(/JPEG/);
    expect(imageFileError(undefined)).toMatch(/JPEG/);
  });

  it("refuses files over 10 MB", () => {
    expect(imageFileError(image("big.png", "image/png", MAX_IMAGE_BYTES + 1))).toMatch(/10 MB/);
  });
});

describe("pickImages", () => {
  it("keeps valid files in order", () => {
    const files = [image("1.png"), image("2.jpg", "image/jpeg")];
    expect(pickImages(files)).toEqual({ accepted: files, error: null });
  });

  it("leaves out invalid files and reports the first reason", () => {
    const ok = image("ok.png");
    const result = pickImages([image("a.gif", "image/gif"), ok, image("big.png", "image/png", MAX_IMAGE_BYTES + 1)]);
    expect(result.accepted).toEqual([ok]);
    expect(result.error).toMatch(/JPEG, PNG and WebP/);
  });

  it("stops at 4 images, counting those already attached", () => {
    const files = [image("1.png"), image("2.png"), image("3.png")];
    const result = pickImages(files, 2);
    expect(result.accepted).toEqual(files.slice(0, 2));
    expect(result.error).toMatch(/up to 4 images/);
  });

  it("accepts nothing when 4 are already attached", () => {
    expect(pickImages([image("5.png")], 4).accepted).toEqual([]);
  });
});

describe("messagePreviewText", () => {
  const attachments = [{ media_id: "m1" }, { media_id: "m2" }];

  it("prefers the text", () => {
    expect(messagePreviewText({ content: "hi", attachments })).toBe("hi");
  });

  it("names the images of an image-only message", () => {
    expect(messagePreviewText({ content: null, attachments: attachments.slice(0, 1) })).toBe("Image");
    expect(messagePreviewText({ content: null, attachments })).toBe("2 images");
  });

  it("says deleted, whatever the message held", () => {
    expect(messagePreviewText({ deleted: true, content: null, attachments: [] })).toBe("Message deleted");
  });

  it("is empty for nothing at all", () => {
    expect(messagePreviewText(null)).toBe("");
    expect(messagePreviewText({ content: null })).toBe("");
  });
});

describe("imageLinkExpired", () => {
  const now = Date.parse("2026-10-24T10:00:00Z");

  it("is false while the link has more than 5 seconds left", () => {
    expect(imageLinkExpired({ url_expires_at: "2026-10-24T10:00:06Z" }, now)).toBe(false);
  });

  it("is true once expired, or about to", () => {
    expect(imageLinkExpired({ url_expires_at: "2026-10-24T09:59:00Z" }, now)).toBe(true);
    expect(imageLinkExpired({ url_expires_at: "2026-10-24T10:00:04Z" }, now)).toBe(true);
  });

  it("is false without a known expiry", () => {
    expect(imageLinkExpired({ url_expires_at: null }, now)).toBe(false);
    expect(imageLinkExpired(undefined, now)).toBe(false);
  });
});

describe("imageAspectRatio", () => {
  it("uses the processed size", () => {
    expect(imageAspectRatio({ width: 1280, height: 720 })).toBe("1280 / 720");
  });

  it("falls back to 4 / 3 without a usable size", () => {
    expect(imageAspectRatio({ width: 0, height: 720 })).toBe("4 / 3");
    expect(imageAspectRatio(undefined)).toBe("4 / 3");
  });
});
