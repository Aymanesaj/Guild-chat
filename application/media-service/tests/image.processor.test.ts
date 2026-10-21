import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { processImage } from "../src/processors/image.processor.js";

function createImage(width: number, height: number) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 40, g: 100, b: 180 },
    },
  });
}

describe("processImage", () => {
  it.each(["jpeg", "png", "webp"] as const)(
    "converts a valid %s avatar into 512×512 WebP",
    async (format) => {
      const input = await createImage(800, 600)
        .toFormat(format)
        .toBuffer();

      const result = await processImage(input, "AVATAR");
      const output = await sharp(result.buffer).metadata();

      expect(result.contentType).toBe("image/webp");
      expect(result.sizeBytes).toBe(result.buffer.length);

      // Inspect the actual output, not only the returned fields.
      expect(output.format).toBe("webp");
      expect(output.width).toBe(512);
      expect(output.height).toBe(512);
      expect(result.width).toBe(output.width);
      expect(result.height).toBe(output.height);
    },
  );

  it("resizes chat images while preserving their aspect ratio", async () => {
    const input = await createImage(3000, 1500).png().toBuffer();

    const result = await processImage(input, "CHAT_IMAGE");
    const output = await sharp(result.buffer).metadata();

    expect(output.width).toBe(2048);
    expect(output.height).toBe(1024);
  });

  it("does not enlarge small chat images", async () => {
    const input = await createImage(320, 160).png().toBuffer();

    const result = await processImage(input, "CHAT_IMAGE");

    expect(result.width).toBe(320);
    expect(result.height).toBe(160);
  });

  it("rejects text pretending to be an image", async () => {
    const input = Buffer.from("<html>This is not an image</html>");

    await expect(processImage(input, "AVATAR")).rejects.toThrow();
  });

  it("rejects an empty file", async () => {
    await expect(
      processImage(Buffer.alloc(0), "AVATAR"),
    ).rejects.toThrow("Image is empty");
  });

  it("rejects avatar input larger than 5 MiB", async () => {
    const input = Buffer.alloc(5 * 1024 * 1024 + 1);

    await expect(processImage(input, "AVATAR")).rejects.toThrow(
      "Image exceeds the upload size limit",
    );
  });

  it("rejects excessive dimensions even when the file is small", async () => {
    const input = await createImage(10_001, 1).png().toBuffer();

    await expect(processImage(input, "AVATAR")).rejects.toThrow(
      "Image dimensions exceed the allowed limits",
    );
  });

  it("rejects a truncated PNG", async () => {
    const valid = await createImage(100, 100).png().toBuffer();
    const truncated = valid.subarray(0, 40);

    await expect(processImage(truncated, "AVATAR")).rejects.toThrow();
  });

  it("strips EXIF metadata from the output", async () => {
    const input = await createImage(100, 100)
      .withExif({
        IFD0: {
          Artist: "Private test metadata",
        },
      })
      .jpeg()
      .toBuffer();

    // Confirm the fixture actually contains metadata.
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const result = await processImage(input, "AVATAR");
    const output = await sharp(result.buffer).metadata();

    expect(output.exif).toBeUndefined();
  });
});