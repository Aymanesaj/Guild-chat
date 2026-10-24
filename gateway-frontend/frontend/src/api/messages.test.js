import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMessage, listMessages, sendMessage, uploadImage } from "./messages";

// Names come from identity; these tests are about chat's payloads.
vi.mock("./users", () => ({ resolveUsers: async () => new Map() }));

const json = (status, body) =>
  new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const IMAGE = {
  media_id: "3f0c6a4e-8a51-4d0e-9b0a-2c4f1e7d9a10",
  content_type: "image/webp",
  width: 1280,
  height: 720,
  url: "https://r2.example/image?sig=1",
  url_expires_at: "2026-10-23T10:05:00Z",
};

const message = (fields = {}) => ({
  id: "66f0c1a2b3c4d5e6f7a8b9c0",
  room_id: 5,
  sender_id: "u1",
  reply_to_id: null,
  content: "hello",
  content_type: "text",
  created_at: "2026-10-23T10:00:00Z",
  edited_at: null,
  deleted: false,
  attachments: [],
  system: null,
  ...fields,
});

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadImage", () => {
  const file = new File(["png bytes"], "cat.png", { type: "image/png" });
  const ticket = {
    upload_id: "0b7f3c1e-1d2a-4c5b-9e8f-7a6b5c4d3e2f",
    upload_url: "https://r2.example/upload?sig=2",
    content_type: "image/png",
    expires_in: 300,
  };

  it("asks chat for an upload URL, PUTs the file to it, and returns the upload_id", async () => {
    fetchMock
      .mockResolvedValueOnce(json(201, ticket))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(uploadImage(5, file)).resolves.toBe(ticket.upload_id);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/chat/rooms/5/attachments/upload-url");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ content_type: "image/png" });

    const [putUrl, put] = fetchMock.mock.calls[1];
    expect(putUrl).toBe(ticket.upload_url);
    expect(put.method).toBe("PUT");
    expect(put.headers).toEqual({ "Content-Type": "image/png" });
    expect(put.body).toBe(file);
  });

  it("never sends the bearer token to storage", async () => {
    // An unexpired JWT, so no refresh request gets in the way.
    const accessToken = `h.${btoa(JSON.stringify({ exp: 4102444800 }))}.s`;
    localStorage.setItem("ft.auth", JSON.stringify({ accessToken, refreshToken: "r" }));
    fetchMock
      .mockResolvedValueOnce(json(201, ticket))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    try {
      await uploadImage(5, file);
    } finally {
      localStorage.clear();
    }

    expect(new Headers(fetchMock.mock.calls[0][1].headers).get("Authorization")).toBe(`Bearer ${accessToken}`);
    expect(new Headers(fetchMock.mock.calls[1][1].headers).has("Authorization")).toBe(false);
  });

  it("surfaces chat's refusal and never PUTs", async () => {
    fetchMock.mockResolvedValueOnce(
      json(403, { error: { code: "NOT_A_MEMBER", message: "User is not a member of the room" } }),
    );

    await expect(uploadImage(5, file)).rejects.toMatchObject({
      status: 403,
      message: "User is not a member of the room",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails when storage refuses the PUT", async () => {
    fetchMock
      .mockResolvedValueOnce(json(201, ticket))
      .mockResolvedValueOnce(new Response(null, { status: 403 }));

    await expect(uploadImage(5, file)).rejects.toMatchObject({
      status: 403,
      message: "Failed to upload image",
    });
  });
});

describe("sendMessage", () => {
  it("sends the upload ids with the text", async () => {
    fetchMock.mockResolvedValueOnce(json(201, message({ attachments: [IMAGE] })));

    const sent = await sendMessage(5, "look", null, ["id-1", "id-2"]);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      content: "look",
      reply_to_id: null,
      attachment_upload_ids: ["id-1", "id-2"],
    });
    expect(sent.attachments).toEqual([IMAGE]);
  });

  it("leaves attachment_upload_ids out of a text message", async () => {
    fetchMock.mockResolvedValueOnce(json(201, message()));

    await sendMessage(5, "hello");

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ content: "hello" });
  });

  it("sends an image-only message", async () => {
    fetchMock.mockResolvedValueOnce(json(201, message({ content: null, attachments: [IMAGE] })));

    const sent = await sendMessage(5, "", undefined, ["id-1"]);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      content: "",
      attachment_upload_ids: ["id-1"],
    });
    expect(sent.content).toBeNull();
  });

  it("surfaces an image the server refused", async () => {
    fetchMock.mockResolvedValueOnce(
      json(409, { error: { code: "ATTACHMENT_UNAVAILABLE", message: "Image upload expired or failed, upload it again" } }),
    );

    await expect(sendMessage(5, "", undefined, ["id-1"])).rejects.toMatchObject({
      status: 409,
      message: "Image upload expired or failed, upload it again",
    });
  });
});

describe("reading messages", () => {
  it("gives every message an attachments array", async () => {
    const withoutKey = message({ id: "66f0c1a2b3c4d5e6f7a8b9c1" });
    delete withoutKey.attachments;
    fetchMock.mockResolvedValueOnce(json(200, [withoutKey, message({ attachments: [IMAGE] })]));

    const history = await listMessages(5);

    // chat pages newest first; the list is oldest first.
    expect(history.map((item) => item.attachments)).toEqual([[IMAGE], []]);
  });

  it("getMessage fetches one message, with fresh image links", async () => {
    const fresh = { ...IMAGE, url: "https://r2.example/image?sig=fresh" };
    fetchMock.mockResolvedValueOnce(json(200, message({ attachments: [fresh] })));

    const result = await getMessage("66f0c1a2b3c4d5e6f7a8b9c0");

    expect(fetchMock.mock.calls[0][0]).toBe("/api/chat/messages/66f0c1a2b3c4d5e6f7a8b9c0");
    expect(result.attachments[0].url).toBe(fresh.url);
  });
});
