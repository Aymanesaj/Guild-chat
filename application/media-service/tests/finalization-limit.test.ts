import { describe, expect, it, vi } from "vitest";
import {
  FinalizationBusyError,
  withFinalizationSlot,
} from "../src/media/finalization-limit.js";

describe("finalization capacity", () => {
  it("rejects a third operation before it starts", async () => {
    let release!: () => void;

    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = withFinalizationSlot(() => gate);
    const second = withFinalizationSlot(() => gate);
    const thirdOperation = vi.fn(async () => "unexpected");

    try {
      await expect(
        withFinalizationSlot(thirdOperation),
      ).rejects.toThrow(FinalizationBusyError);

      expect(thirdOperation).not.toHaveBeenCalled();
    } finally {
      release();
      await Promise.all([first, second]);
    }

    await expect(
      withFinalizationSlot(async () => "available again"),
    ).resolves.toBe("available again");
  });

  it("releases slots when operations fail", async () => {
    const fail = async () => {
      throw new Error("Storage failed");
    };

    await expect(withFinalizationSlot(fail)).rejects.toThrow(
      "Storage failed",
    );

    await expect(withFinalizationSlot(fail)).rejects.toThrow(
      "Storage failed",
    );

    await expect(
      withFinalizationSlot(async () => "recovered"),
    ).resolves.toBe("recovered");
  });
});