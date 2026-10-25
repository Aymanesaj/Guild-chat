import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connectChat, onNotificationEvent, onRoomEvent } from "./messages";

vi.mock("./users", () => ({ resolveUsers: async () => new Map() }));

/** The one socket messages.js opens; frames are pushed into it by hand. */
class FakeSocket {
  static OPEN = 1;
  static last = null;

  constructor(url) {
    this.url = url;
    this.readyState = FakeSocket.OPEN;
    this.sent = [];
    FakeSocket.last = this;
  }

  send(frame) {
    this.sent.push(frame);
  }

  close() {}

  receive(event, data) {
    this.onmessage({ data: JSON.stringify({ event, data }) });
  }
}

beforeAll(() => {
  vi.stubGlobal("WebSocket", FakeSocket);
  // An unexpired token: the socket opens without a refresh first.
  const accessToken = `h.${btoa(JSON.stringify({ exp: 4102444800 }))}.s`;
  localStorage.setItem("ft.auth", JSON.stringify({ accessToken, refreshToken: "r" }));
  connectChat();
  FakeSocket.last.onopen();
});

afterAll(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("chat socket frames for unread badges and notifications", () => {
  it("room.read reaches room listeners as { type: 'read', roomId, unread }", () => {
    const events = [];
    const off = onRoomEvent((event) => events.push(event));

    FakeSocket.last.receive("room.read", { room_id: 5, last_read_id: "m1", unread: 2 });
    off();

    expect(events).toEqual([{ type: "read", roomId: 5, unread: 2 }]);
  });

  it("room.activity says who sent the message and whether it is a room event", () => {
    const events = [];
    const off = onRoomEvent((event) => events.push(event));

    FakeSocket.last.receive("room.activity", {
      room_id: 5,
      change: "new",
      message: { id: "m2", sender_id: "bob", content: "hi", content_type: "text", created_at: "2026-10-25T10:00:00Z" },
    });
    off();

    expect(events[0]).toMatchObject({ type: "activity", roomId: 5, change: "new", senderId: "bob", isSystem: false });
  });

  it("notification.new and notification.read reach notification listeners as raw frames", () => {
    const frames = [];
    const off = onNotificationEvent((frame) => frames.push(frame));

    FakeSocket.last.receive("notification.new", { id: "n1", type: "FRIEND_REQUEST", read: false });
    FakeSocket.last.receive("notification.read", { ids: null, all: true, unread: 0 });
    off();

    expect(frames.map((frame) => frame.event)).toEqual(["notification.new", "notification.read"]);
    expect(frames[1].data.unread).toBe(0);
  });
});
