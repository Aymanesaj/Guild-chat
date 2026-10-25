import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getNotificationUnreadCount,
  getUnreadCounts,
  listNotifications,
  markAllNotificationsRead,
  markFriendRequestNotificationsRead,
  markNotificationsRead,
  markRoomRead,
} from "./notifications";

vi.mock("./users", () => ({
  resolveUsers: async (ids) => new Map(ids.filter(Boolean).map((id) => [id, { id, username: `name-${id}` }])),
}));

const json = (status, body) =>
  new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getUnreadCounts", () => {
  it("asks 100 rooms at a time and keys the counts by numeric room id", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => i + 1);
    fetchMock
      .mockResolvedValueOnce(json(200, { 1: 3, 2: 0 }))
      .mockResolvedValueOnce(json(200, { 150: 7 }));

    const counts = await getUnreadCounts(ids);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(decodeURIComponent(fetchMock.mock.calls[0][0])).toBe(
      `/api/chat/rooms/unread?ids=${ids.slice(0, 100).join(",")}`,
    );
    expect([...counts]).toEqual([[1, 3], [2, 0], [150, 7]]);
  });

  it("leaves out a chunk that fails instead of failing everything", async () => {
    fetchMock.mockResolvedValueOnce(json(503, { error: { code: "ORG_UNAVAILABLE", message: "down" } }));

    await expect(getUnreadCounts([1])).resolves.toEqual(new Map());
  });
});

describe("read marks and notifications", () => {
  it("marks incoming friend-request notifications through the scoped endpoint", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ids: ["n1"], all: false, unread: 2 }));
    expect(await markFriendRequestNotificationsRead()).toEqual({ ids: ["n1"], all: false, unread: 2 });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/chat/notifications/read-friend-requests");
    expect(fetchMock.mock.calls[0][1].method).toBe("PUT");
  });
  it("markRoomRead PUTs the message id", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { room_id: 5, last_read_id: "m1", unread: 0 }));

    await expect(markRoomRead(5, "m1")).resolves.toEqual({ room_id: 5, last_read_id: "m1", unread: 0 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/chat/rooms/5/read");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ message_id: "m1" });
  });

  it("listNotifications pages and names each actor", async () => {
    fetchMock.mockResolvedValueOnce(json(200, [{ id: "n1", type: "FRIEND_REQUEST", actor_id: "u1" }]));

    const page = await listNotifications({ before: "n0", limit: 20 });

    expect(fetchMock.mock.calls[0][0]).toBe("/api/chat/notifications?before=n0&limit=20");
    expect(page[0].actor_username).toBe("name-u1");
  });

  it("unread count, mark some and mark all", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { unread: 4 }))
      .mockResolvedValueOnce(json(200, { ids: ["n1"], all: false, unread: 3 }))
      .mockResolvedValueOnce(json(200, { ids: null, all: true, unread: 0 }));

    expect(await getNotificationUnreadCount()).toBe(4);
    expect((await markNotificationsRead(["n1"])).unread).toBe(3);
    expect((await markAllNotificationsRead()).all).toBe(true);

    expect(fetchMock.mock.calls[0][0]).toBe("/api/chat/notifications/unread-count");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/chat/notifications/read");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ ids: ["n1"] });
    expect(fetchMock.mock.calls[2][0]).toBe("/api/chat/notifications/read-all");
    expect(fetchMock.mock.calls[2][1].method).toBe("PUT");
  });
});
