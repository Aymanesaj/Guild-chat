import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api/notifications";
import { useNotificationFeed } from "./useNotificationFeed";

let notificationListener = null;
let roomListener = null;
vi.mock("../api/messages", () => ({
  onNotificationEvent: (listener) => {
    notificationListener = listener;
    return () => {};
  },
  onRoomEvent: (listener) => {
    roomListener = listener;
    return () => {};
  },
}));
vi.mock("../api/notifications", () => ({
  getNotificationUnreadCount: vi.fn(),
  listNotifications: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  markFriendRequestNotificationsRead: vi.fn(),
  markNotificationsRead: vi.fn(),
  withActor: vi.fn(async (n) => ({ ...n, actor_username: "Alice" })),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const note = (id, read = false) => ({ id, type: "FRIEND_REQUEST", actor_id: "a", read, created_at: "2026-10-25T10:00:00Z" });

let root;
let feed;

function Probe({ onValue }) {
  const value = useNotificationFeed();
  useEffect(() => onValue(value));
  return null;
}

async function mount() {
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe onValue={(value) => { feed = value; }} />));
}

beforeEach(() => {
  vi.clearAllMocks();
  api.withActor.mockImplementation(async (n) => ({ ...n, actor_username: "Alice" }));
  api.getNotificationUnreadCount.mockResolvedValue(2);
  api.listNotifications.mockResolvedValue([note("n2"), note("n1")]);
  api.markNotificationsRead.mockResolvedValue({ ids: ["n2"], all: false, unread: 1 });
  api.markAllNotificationsRead.mockResolvedValue({ ids: null, all: true, unread: 0 });
  api.markFriendRequestNotificationsRead.mockResolvedValue({ ids: ["n2"], all: false, unread: 1 });
});

afterEach(() => {
  act(() => root.unmount());
});

describe("useNotificationFeed", () => {
  it("loads the unread count at once, the list only when asked", async () => {
    await mount();
    expect(feed.unread).toBe(2);
    expect(api.listNotifications).not.toHaveBeenCalled();

    await act(() => feed.load());
    expect(feed.state).toBe("success");
    expect(feed.items.map((n) => n.id)).toEqual(["n2", "n1"]);
  });

  it("notification.new adds one and prepends it, with its actor's name, once", async () => {
    await mount();
    await act(() => feed.load());

    await act(() => notificationListener({ event: "notification.new", data: note("n3") }));
    await act(() => notificationListener({ event: "notification.new", data: note("n3") }));

    expect(feed.items.map((n) => n.id)).toEqual(["n3", "n2", "n1"]);
    expect(feed.items[0].actor_username).toBe("Alice");
    expect(feed.unread).toBe(3); // redelivery must not inflate the badge
  });

  it("notification.read from another tab marks them and sets the count", async () => {
    await mount();
    await act(() => feed.load());

    await act(() => notificationListener({ event: "notification.read", data: { ids: null, all: true, unread: 0 } }));

    expect(feed.items.every((n) => n.read)).toBe(true);
    expect(feed.unread).toBe(0);
  });

  it("markRead is optimistic, then takes the server's count; an already read one is left alone", async () => {
    await mount();
    await act(() => feed.load());

    await act(async () => feed.markRead("n2"));
    expect(feed.items[0].read).toBe(true);
    expect(api.markNotificationsRead).toHaveBeenCalledWith(["n2"]);
    expect(feed.unread).toBe(1);

    await act(async () => feed.markRead("n2"));
    expect(api.markNotificationsRead).toHaveBeenCalledTimes(1);
  });

  it("markAllRead marks everything", async () => {
    await mount();
    await act(() => feed.load());

    await act(async () => feed.markAllRead());

    expect(feed.items.every((n) => n.read)).toBe(true);
    expect(feed.unread).toBe(0);
  });

  it("acknowledges friend requests before the list loads and preserves read state on a stale page", async () => {
    await mount();
    await act(() => feed.markFriendRequestsRead());
    expect(api.markFriendRequestNotificationsRead).toHaveBeenCalledOnce();
    expect(api.listNotifications).not.toHaveBeenCalled();
    expect(feed.unread).toBe(1);
    await act(() => feed.load());
    expect(feed.items.find((item) => item.id === "n2").read).toBe(true);
    expect(feed.items.find((item) => item.id === "n1").read).toBe(false);
    expect(api.markAllNotificationsRead).not.toHaveBeenCalled();
  });

  it("a failed friend-request acknowledgement does not reject or hide unread notifications", async () => {
    await mount();
    api.markFriendRequestNotificationsRead.mockRejectedValueOnce(new Error("offline"));
    await act(() => feed.markFriendRequestsRead());
    expect(feed.unread).toBe(2);
  });

  it("a reconnect reloads the count, and the list once it was opened", async () => {
    await mount();
    await act(() => roomListener({ type: "resync" }));
    expect(api.listNotifications).not.toHaveBeenCalled();

    await act(() => feed.load());
    await act(() => roomListener({ type: "resync" }));
    expect(api.listNotifications).toHaveBeenCalledTimes(2);
    expect(api.getNotificationUnreadCount).toHaveBeenCalledTimes(3);
  });

  it.each([false, true])("a read during name resolution stays read (all=%s)", async (all) => {
    await mount();
    let finish;
    api.withActor.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    let pending;
    await act(async () => { pending = notificationListener({ event: "notification.new", data: note("n3") }); });
    await act(() => notificationListener({ event: "notification.read", data: { ids: all ? null : ["n3"], all, unread: 0 } }));
    await act(async () => { finish({ ...note("n3"), actor_username: "Alice" }); await pending; });
    expect(feed.items[0]).toMatchObject({ id: "n3", read: true, actor_username: "Alice" });
    expect(feed.unread).toBe(0);
  });

  it("a stale list response cannot undo a room notification read", async () => {
    await mount();
    let finish;
    api.listNotifications.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    let pending;
    await act(async () => { pending = feed.load(); });
    await act(() => notificationListener({ event: "notification.read", data: { ids: ["n2"], all: false, unread: 1 } }));
    await act(async () => { finish([note("n2"), note("n1")]); await pending; });
    expect(feed.items[0].read).toBe(true);
    expect(feed.items[1].read).toBe(false);
    expect(feed.unread).toBe(1);
  });

  it("refetches an unread snapshot if a new event arrived during the request", async () => {
    let finish;
    api.getNotificationUnreadCount.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValue(3);
    await mount();
    await act(() => notificationListener({ event: "notification.new", data: note("n3") }));
    await act(async () => finish(2));
    expect(feed.unread).toBe(3);
    expect(api.getNotificationUnreadCount).toHaveBeenCalledTimes(2);
  });

  it("restores the item and count if marking it read fails", async () => {
    await mount();
    await act(() => feed.load());
    api.markNotificationsRead.mockRejectedValueOnce(new Error("offline"));
    await act(async () => feed.markRead("n2"));
    expect(feed.items[0].read).toBe(false);
    expect(feed.unread).toBe(2);
  });

  it("a failed read is restored even if a new notification arrives while saving", async () => {
    await mount();
    await act(() => feed.load());
    let fail;
    api.markNotificationsRead.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    await act(async () => feed.markRead("n2"));
    await act(() => notificationListener({ event: "notification.new", data: note("n3") }));
    api.getNotificationUnreadCount.mockResolvedValue(3);
    await act(async () => fail(new Error("offline")));
    expect(feed.items.find((item) => item.id === "n2").read).toBe(false);
    expect(feed.unread).toBe(3);
  });
});
