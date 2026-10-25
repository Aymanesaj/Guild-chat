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
  api.getNotificationUnreadCount.mockResolvedValue(2);
  api.listNotifications.mockResolvedValue([note("n2"), note("n1")]);
  api.markNotificationsRead.mockResolvedValue({ ids: ["n2"], all: false, unread: 1 });
  api.markAllNotificationsRead.mockResolvedValue({ ids: null, all: true, unread: 0 });
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
    expect(feed.unread).toBe(4); // a duplicate frame is a redelivery: the server count corrects it on the next read
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

  it("a reconnect reloads the count, and the list once it was opened", async () => {
    await mount();
    await act(() => roomListener({ type: "resync" }));
    expect(api.listNotifications).not.toHaveBeenCalled();

    await act(() => feed.load());
    await act(() => roomListener({ type: "resync" }));
    expect(api.listNotifications).toHaveBeenCalledTimes(2);
    expect(api.getNotificationUnreadCount).toHaveBeenCalledTimes(3);
  });
});
