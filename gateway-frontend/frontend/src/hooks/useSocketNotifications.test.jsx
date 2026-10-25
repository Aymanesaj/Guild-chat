import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useNotificationFeed } from "./useNotificationFeed";
import { useSocketNotifications } from "./useSocketNotifications";
import * as api from "../api/notifications";
import { resolveUsers } from "../api/users";

const state = vi.hoisted(() => ({
  notifications: new Set(), rooms: new Set(), toasts: new Map(),
  navigate: vi.fn(),
}));
const toast = vi.hoisted(() => ({
  info: vi.fn((message, options) => { state.toasts.set(options.id, { message, ...options }); return options.id; }),
  dismiss: vi.fn((id) => state.toasts.delete(id)),
}));
vi.mock("../components/ui/ToastProvider", () => ({ useToast: () => toast }));
vi.mock("../api/messages", () => ({
  onNotificationEvent: (listener) => { state.notifications.add(listener); return () => state.notifications.delete(listener); },
  onRoomEvent: (listener) => { state.rooms.add(listener); return () => state.rooms.delete(listener); },
}));
vi.mock("../api/rooms", () => ({ getRoom: async (id) => ({ id, name: "General", type: "group" }) }));
vi.mock("../api/users", () => ({ resolveUsers: vi.fn() }));
vi.mock("../api/notifications", async (original) => ({
  ...(await original()),
  getNotificationUnreadCount: vi.fn(),
  listNotifications: vi.fn(),
  markNotificationsRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  markFriendRequestNotificationsRead: vi.fn(),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let feed;
function Probe({ activeRoomId = null }) {
  const currentFeed = useNotificationFeed();
  useEffect(() => { feed = currentFeed; });
  useSocketNotifications("alice", activeRoomId, state.navigate, [], currentFeed);
  return null;
}
const note = (id, type = "FRIEND_REQUEST") => ({
  id, type, actor_id: "bob", room_id: type.startsWith("ROOM_") || type === "ROLE_CHANGED" ? 42 : null,
  role: "ADMIN", read: false, created_at: "2026-10-25T10:00:00Z",
});
const emit = async (event, data) => act(async () => {
  await Promise.all([...state.notifications].map((listener) => listener({ event, data })));
});
const roomEvent = async (event) => act(async () => {
  state.rooms.forEach((listener) => listener(event));
});
const message = (id = "m1") => ({ room_id: 42, change: "new", message: { id, sender_id: "bob", content_type: "text" } });

beforeEach(async () => {
  vi.clearAllMocks();
  state.notifications.clear();
  state.rooms.clear();
  state.toasts.clear();
  resolveUsers.mockImplementation(async () => new Map([["bob", { id: "bob", username: "Bob" }]]));
  api.getNotificationUnreadCount.mockResolvedValue(0);
  api.listNotifications.mockResolvedValue([]);
  api.markNotificationsRead.mockResolvedValue({ ids: ["n1"], all: false, unread: 0 });
  api.markAllNotificationsRead.mockResolvedValue({ ids: null, all: true, unread: 0 });
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe />));
});
afterEach(() => act(() => root.unmount()));

it.each(["FRIEND_REQUEST", "FRIEND_ACCEPTED", "ROOM_ADDED", "ROOM_REMOVED", "ROLE_CHANGED"])(
  "uses the stored %s notification for one toast and one activity item", async (type) => {
    await emit("notification.new", note("n1", type));
    await emit("notification.new", note("n1", type));
    expect(feed.unread).toBe(1);
    expect(feed.items).toHaveLength(1);
    expect(state.toasts.size).toBe(1);
    expect(state.toasts.get("notification:n1").message).toContain("Bob");
    expect(toast.info).toHaveBeenCalledOnce();
  },
);

it("ignores legacy friend and system frames so they cannot duplicate activity toasts", async () => {
  await emit("friend.request.received", { friendship_id: "f1", user_id: "bob" });
  await emit("friend.added", { friendship_id: "f1", user_id: "bob" });
  await emit("room.activity", { ...message(), message: {
    id: "system", content_type: "system", system: { type: "MEMBER_JOINED", target_id: "alice", actor_id: "bob" },
  } });
  expect(state.toasts.size).toBe(0);
  await emit("notification.new", note("n1", "ROOM_ADDED"));
  expect(state.toasts.size).toBe(1);
});

it("clicking an activity toast marks that notification read and navigates", async () => {
  await emit("notification.new", note("n1"));
  await act(async () => state.toasts.get("notification:n1").onActivate());
  expect(api.markNotificationsRead).toHaveBeenCalledWith(["n1"]);
  expect(feed.items[0].read).toBe(true);
  expect(feed.unread).toBe(0);
  expect(state.toasts.size).toBe(0);
  expect(state.navigate).toHaveBeenCalledWith({ type: "profile", tab: "requests" });
});

it("an activity read in the panel dismisses its toast immediately", async () => {
  await emit("notification.new", note("n1"));
  await act(async () => feed.markRead("n1"));
  expect(state.toasts.size).toBe(0);
});

it("acknowledging friend requests dismisses their toasts while other activity stays unread", async () => {
  await emit("notification.new", note("n1"));
  await emit("notification.new", note("n2", "ROOM_ADDED"));
  api.markFriendRequestNotificationsRead.mockResolvedValueOnce({ ids: ["n1"], all: false, unread: 1 });
  await act(() => feed.markFriendRequestsRead());
  expect([...state.toasts.keys()]).toEqual(["notification:n2"]);
  expect(feed.items.find((item) => item.id === "n1").read).toBe(true);
  expect(feed.items.find((item) => item.id === "n2").read).toBe(false);
  expect(feed.unread).toBe(1);
});

it("read-all dismisses activity toasts while message toasts keep following room reads", async () => {
  await emit("notification.new", note("n1"));
  await emit("room.activity", message());
  expect(state.toasts.size).toBe(2);
  await act(async () => feed.markAllRead());
  expect([...state.toasts.keys()]).toEqual(["message:m1"]);
});

it("a read from another tab or a room read clears the same activity item and toast", async () => {
  await emit("notification.new", note("n1", "ROLE_CHANGED"));
  await emit("notification.new", note("n2"));
  await emit("notification.read", { ids: ["n1"], all: false, unread: 1 });
  expect(feed.items.find((item) => item.id === "n1").read).toBe(true);
  expect(feed.unread).toBe(1);
  expect([...state.toasts.keys()]).toEqual(["notification:n2"]);
});

it("room reads dismiss only message toasts at or before the read position", async () => {
  await emit("room.activity", message("m1"));
  await emit("room.activity", message("m2"));
  await roomEvent({ type: "read", roomId: 42, lastReadId: "m1", unread: 1 });
  expect([...state.toasts.keys()]).toEqual(["message:m2"]);
  await emit("room.activity", message("m0"));
  expect([...state.toasts.keys()]).toEqual(["message:m2"]);
});

it("a notification read during name resolution cannot reappear as an unread item or toast", async () => {
  let finish;
  const names = new Promise((resolve) => { finish = resolve; });
  resolveUsers.mockReturnValue(names);
  let pending;
  await act(async () => {
    pending = Promise.all([...state.notifications].map((listener) => listener({ event: "notification.new", data: note("n1") })));
  });
  expect(feed.items[0].read).toBe(false);
  await emit("notification.read", { ids: ["n1"], all: false, unread: 0 });
  await act(async () => {
    finish(new Map([["bob", { id: "bob", username: "Bob" }]]));
    await pending;
  });
  expect(feed.items[0].read).toBe(true);
  expect(state.toasts.size).toBe(0);
});

it("a toast waiting on names is cancelled by a room read", async () => {
  let finish;
  resolveUsers.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  let pending;
  await act(async () => {
    pending = Promise.all([...state.notifications].map((listener) => listener({ event: "room.activity", data: message() })));
  });
  await roomEvent({ type: "read", roomId: 42, lastReadId: "m1", unread: 0 });
  await act(async () => { finish(new Map()); await pending; });
  expect(state.toasts.size).toBe(0);
});

it("suppresses room activity toasts while that room is open", async () => {
  await act(async () => root.render(<Probe activeRoomId={42} />));
  await emit("notification.new", note("n1", "ROLE_CHANGED"));
  await emit("room.activity", message());
  expect(state.toasts.size).toBe(0);
});

it("a failed actor lookup uses a fallback without rejecting the socket callback", async () => {
  resolveUsers.mockRejectedValue(new Error("User lookup unavailable"));
  await expect(emit("notification.new", note("n1"))).resolves.toBeUndefined();
  expect(state.toasts.get("notification:n1").message).toBe("Someone sent you a friend request");
  expect(feed.items[0].id).toBe("n1");
});
