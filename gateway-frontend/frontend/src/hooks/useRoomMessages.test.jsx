import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api/messages";
import { useRoomMessages } from "./useRoomMessages";

vi.mock("../api/messages", () => ({
  deleteMessage: vi.fn(),
  editMessage: vi.fn(),
  getMessage: vi.fn(),
  listMessages: vi.fn(),
  sendMessage: vi.fn(),
  subscribeToRoom: vi.fn(() => () => {}),
  uploadImage: vi.fn(),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const IMAGE = { media_id: "m1", content_type: "image/webp", width: 10, height: 10, url: "https://r2/old", url_expires_at: null };
const stored = (fields = {}) => ({ id: "a1", room_id: 5, content: "hi", deleted: false, attachments: [], ...fields });

let container;
let root;
let hook;

function Probe({ roomId, onResult }) {
  const result = useRoomMessages(roomId);
  useEffect(() => onResult(result));
  return null;
}

async function mount(roomId = 5) {
  container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root.render(<Probe roomId={roomId} onResult={(result) => { hook = result; }} />));
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listMessages.mockResolvedValue([]);
});

afterEach(() => {
  act(() => root.unmount());
});

describe("useRoomMessages send", () => {
  it("uploads every image, then sends their ids with the text, in order", async () => {
    await mount();
    const files = [new File(["a"], "a.png", { type: "image/png" }), new File(["b"], "b.png", { type: "image/png" })];
    api.uploadImage.mockImplementation(async (_roomId, file) => `upload-${file.name}`);
    api.sendMessage.mockResolvedValue(stored({ content: "look", attachments: [IMAGE, IMAGE] }));

    await act(() => hook.send("  look  ", "r1", files));

    expect(api.uploadImage.mock.calls).toEqual([[5, files[0]], [5, files[1]]]);
    expect(api.sendMessage).toHaveBeenCalledWith(5, "look", "r1", ["upload-a.png", "upload-b.png"]);
    expect(hook.messages).toHaveLength(1);
    expect(hook.sending).toBe(false);
  });

  it("sends an image with no text", async () => {
    await mount();
    api.uploadImage.mockResolvedValue("upload-1");
    api.sendMessage.mockResolvedValue(stored({ content: null, attachments: [IMAGE] }));

    await act(() => hook.send("", undefined, [new File(["a"], "a.png", { type: "image/png" })]));

    expect(api.sendMessage).toHaveBeenCalledWith(5, "", undefined, ["upload-1"]);
  });

  it("sends nothing without text or images", async () => {
    await mount();

    await act(() => hook.send("   ", undefined, []));

    expect(api.uploadImage).not.toHaveBeenCalled();
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("does not send the message when an upload fails, and rethrows", async () => {
    await mount();
    api.uploadImage.mockRejectedValue(new Error("Failed to upload image"));

    await expect(
      act(() => hook.send("hi", undefined, [new File(["a"], "a.png", { type: "image/png" })])),
    ).rejects.toThrow("Failed to upload image");

    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(hook.sending).toBe(false);
    expect(hook.messages).toEqual([]);
  });
});

describe("useRoomMessages images", () => {
  it("refreshImages replaces only that message's images", async () => {
    const other = stored({ id: "b2", attachments: [IMAGE] });
    api.listMessages.mockResolvedValue([stored({ attachments: [IMAGE] }), other]);
    await mount();
    const fresh = { ...IMAGE, url: "https://r2/fresh" };
    api.getMessage.mockResolvedValue(stored({ attachments: [fresh] }));

    await act(() => hook.refreshImages("a1"));

    expect(api.getMessage).toHaveBeenCalledWith("a1");
    expect(hook.messages[0].attachments).toEqual([fresh]);
    expect(hook.messages[1]).toBe(other);
  });

  it("a deleted message loses its images", async () => {
    api.listMessages.mockResolvedValue([stored({ attachments: [IMAGE] })]);
    await mount();
    api.deleteMessage.mockResolvedValue(undefined);

    await act(() => hook.remove("a1"));

    expect(hook.messages[0]).toMatchObject({ deleted: true, content: null, attachments: [] });
  });
});
