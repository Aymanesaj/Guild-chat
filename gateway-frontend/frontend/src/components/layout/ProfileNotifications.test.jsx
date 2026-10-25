import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AppShell from "./AppShell";
import * as notifications from "../../api/notifications";
import { getFriendRequests, getFriendsList } from "../../api/friends";
import { getOrCreateDm, openDm } from "../../api/rooms";

const state = vi.hoisted(() => ({
  user: { id: "alice", username: "Alice" },
  unreadConversations: [],
  isPhone: false,
  error: vi.fn(),
}));

vi.mock("../../api/authentication", () => ({ getMe: async () => state.user }));
vi.mock("../../api/rooms", async (original) => ({
  ...(await original()),
  getRooms: async () => [{ id: 10, name: "General", type: "group" }],
  openDm: vi.fn(async (peer) => ({ id: `draft-dm:${peer.id}`, isDraft: true, type: "dm", peer })),
  getOrCreateDm: vi.fn(),
}));
vi.mock("../../api/messages", () => ({
  connectChat: vi.fn(),
  onRoomEvent: () => () => {},
  onNotificationEvent: () => () => {},
}));
vi.mock("../../api/notifications", async (original) => ({
  ...(await original()),
  getNotificationUnreadCount: vi.fn(),
  listNotifications: vi.fn(),
  markNotificationsRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  markFriendRequestNotificationsRead: vi.fn(),
}));
vi.mock("../../api/friends", async (original) => ({
  ...(await original()),
  getFriendsList: vi.fn(async () => []),
  getFriendRequests: vi.fn(async () => []),
}));
vi.mock("../../hooks/useSocketNotifications", () => ({ useSocketNotifications: () => {} }));
vi.mock("../../hooks/useMediaQuery", () => ({ useMediaQuery: () => state.isPhone }));
vi.mock("../ui/ToastProvider", () => ({ useToast: () => ({ error: state.error }) }));
vi.mock("./UnreadContext", () => ({
  UnreadProvider: ({ children }) => children,
  useUnread: () => ({ unreadConversations: state.unreadConversations, counts: new Map(), dmRooms: [] }),
  useUnreadCount: () => 0,
}));
vi.mock("./MainPanel", async () => {
  const { NavToggleButton } = await import("./NavDrawerContext");
  return {
    default: ({ activeView }) => <main><NavToggleButton />{activeView === true ? "DM home" : `Room ${activeView.id} (${activeView.type})`}</main>,
  };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let container;
const note = (id, type = "FRIEND_REQUEST") => ({
  id, type, actor_username: "Bob", read: false, created_at: "2026-10-25T10:00:00Z",
});
const button = (label) => [...container.querySelectorAll("button")].find((item) =>
  item.textContent === label || item.getAttribute("aria-label") === label);
async function click(label) {
  expect(button(label), `button ${label}`).toBeTruthy();
  await act(async () => button(label).click());
}
const panel = () => container.querySelector('section[aria-label="Notifications"]');
const mobileDialog = () => container.querySelector('[role="dialog"][aria-label="Notifications"]');
async function renderShell() {
  await act(async () => root.render(<MemoryRouter><AppShell user={state.user} /></MemoryRouter>));
}
async function openMobileNotifications() {
  state.isPhone = true;
  await renderShell();
  await click("Open navigation");
  await click("Notifications, 1 unread");
}

beforeEach(async () => {
  vi.clearAllMocks();
  document.title = "GuildChat";
  state.isPhone = false;
  state.unreadConversations = [{
    room: { id: 42, type: "dm", peer: { id: "bob", username: "Bob" } }, count: 3,
  }];
  notifications.getNotificationUnreadCount.mockResolvedValue(1);
  notifications.listNotifications.mockResolvedValue([note("n1")]);
  notifications.markNotificationsRead.mockResolvedValue({ unread: 0 });
  notifications.markAllNotificationsRead.mockResolvedValue({ unread: 0 });
  notifications.markFriendRequestNotificationsRead.mockResolvedValue({ ids: ["n1"], all: false, unread: 0 });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await renderShell();
});
afterEach(() => {
  act(() => root.unmount());
  expect(document.title).toBe("GuildChat");
  container.remove();
});

it("opens the profile Notifications section from the bell and shares read state with its badge", async () => {
  expect(document.title).toBe("(4) GuildChat");
  expect(notifications.listNotifications).not.toHaveBeenCalled();
  await click("Notifications, 1 unread");
  expect(panel()).toBeTruthy();
  expect(button("Notifications").getAttribute("aria-pressed")).toBe("true");
  expect(panel().textContent).toContain("Unread messages");
  expect(panel().textContent).toContain("3 new messages");
  expect(panel().textContent).toContain("Bob sent you a friend request");
  expect(getFriendsList).not.toHaveBeenCalled();

  await click("Mark all read");
  expect(notifications.markAllNotificationsRead).toHaveBeenCalledOnce();
  const bell = container.querySelector('button[title="Notifications"]');
  expect(bell.getAttribute("aria-label")).toBe("Notifications");
  expect(bell.querySelector("span")).toBeNull();
  expect(document.title).toBe("(3) GuildChat");
  expect(panel().textContent).toContain("3 new messages");
  expect(panel().querySelector('[aria-label="Unread"]')).toBeNull();
  await click("Close");
  await click("Notifications");
  expect(panel()).toBeTruthy();
  expect(notifications.listNotifications).toHaveBeenCalledOnce();
  expect(button("Mark all read").disabled).toBe(true);
  state.unreadConversations = [];
  await renderShell();
  expect(document.title).toBe("GuildChat");
});

it("includes messages from rooms and DMs in the tab count and caps it at 99+", async () => {
  state.unreadConversations.push({ room: { id: 10, type: "group", name: "General" }, count: 2 });
  await renderShell();
  expect(document.title).toBe("(6) GuildChat");
  expect(button("Notifications, 1 unread")).toBeTruthy();

  state.unreadConversations = [{ room: { id: 10, type: "group", name: "General" }, count: 100 }];
  await renderShell();
  expect(document.title).toBe("(99+) GuildChat");
});

it("also shows notifications when selecting the section from the regular profile", async () => {
  await click("Alice");
  expect(button("Friends").getAttribute("aria-pressed")).toBe("true");
  expect(notifications.listNotifications).not.toHaveBeenCalled();
  await click("Notifications");
  expect(panel().textContent).toContain("Bob sent you a friend request");
});

it.each([false, true])("opening the profile Friends section acknowledges requests without loading activity (mobile=%s)", async (isPhone) => {
  state.isPhone = isPhone;
  await renderShell();
  if (isPhone) await click("Open navigation");
  expect(notifications.markFriendRequestNotificationsRead).not.toHaveBeenCalled();
  await click("Alice");
  expect(notifications.markFriendRequestNotificationsRead).toHaveBeenCalledOnce();
  expect(notifications.listNotifications).not.toHaveBeenCalled();
  expect(container.querySelector('button[title="Notifications"]').getAttribute("aria-label")).toBe("Notifications");
  expect(document.title).toBe("(3) GuildChat");
  expect(notifications.markAllNotificationsRead).not.toHaveBeenCalled();
  await click("Incoming");
  expect(notifications.markFriendRequestNotificationsRead).toHaveBeenCalledOnce();
});

it("acknowledges requests when switching from Notifications to Friends", async () => {
  await click("Notifications, 1 unread");
  expect(notifications.markFriendRequestNotificationsRead).not.toHaveBeenCalled();
  await click("Friends");
  expect(notifications.markFriendRequestNotificationsRead).toHaveBeenCalledOnce();
  const notificationsTab = [...container.querySelectorAll('[aria-label="Profile sections"] button')]
    .find((item) => item.textContent === "Notifications");
  await act(async () => notificationsTab.click());
  expect(panel().querySelector('[aria-label="Unread"]')).toBeNull();
  expect(document.title).toBe("(3) GuildChat");
});

it("the profile Message action opens a temporary DM without creating a room", async () => {
  getFriendsList.mockResolvedValueOnce([{ id: "bob", username: "Bob" }]);
  await click("Alice");
  await click("Message Bob");
  expect(openDm).toHaveBeenCalledWith({ id: "bob", username: "Bob" });
  expect(getOrCreateDm).not.toHaveBeenCalled();
  expect(container.querySelector('[aria-label="Update avatar"]')).toBeNull();
  expect(container.textContent).toContain("Room draft-dm:bob (dm)");
});

it("opens incoming friend requests when clicking a request notification", async () => {
  await click("Notifications, 1 unread");
  await act(async () => panel().querySelector('[aria-label="Unread"]').closest("button").click());
  expect(notifications.markNotificationsRead).toHaveBeenCalledWith(["n1"]);
  expect(panel()).toBeNull();
  expect(button("Incoming").getAttribute("aria-pressed")).toBe("true");
  expect(getFriendRequests).toHaveBeenCalled();
  expect(container.textContent).toContain("No pending requests");
});

it.each([
  { id: 42, type: "dm", peer: { id: "bob", username: "Bob" } },
  { id: 10, type: "group", name: "General" },
])("closes the profile and opens an unread $type conversation", async (room) => {
  state.unreadConversations = [{ room, count: 3 }];
  await click("Notifications, 1 unread");
  const conversation = [...panel().querySelectorAll("button")].find((item) => item.textContent.includes("3 new messages"));
  await act(async () => conversation.click());
  expect(panel()).toBeNull();
  expect(container.querySelector("main main").textContent).toBe(`Room ${room.id} (${room.type})`);
});

it("keeps older activity available and marks notifications without destinations read in place", async () => {
  notifications.listNotifications.mockResolvedValueOnce(
    Array.from({ length: 20 }, (_, index) => note(`n${20 - index}`, "ROOM_REMOVED")),
  ).mockResolvedValueOnce([note("older", "FRIEND_ACCEPTED")]);
  await click("Notifications, 1 unread");
  await click("Show older");
  expect(notifications.listNotifications).toHaveBeenLastCalledWith({ before: "n1", limit: 20 });
  expect(panel().textContent).toContain("Bob accepted your friend request");
  await act(async () => panel().querySelector('[aria-label="Unread"]').closest("button").click());
  expect(notifications.markNotificationsRead).toHaveBeenCalledWith(["n20"]);
  expect(panel()).toBeTruthy();
});

it("opens a dedicated mobile overlay with read actions and no profile controls", async () => {
  await openMobileNotifications();
  expect(mobileDialog()).toBeTruthy();
  expect(container.querySelector('[aria-label="Update avatar"]')).toBeNull();
  expect(container.querySelector('[aria-label="Profile sections"]')).toBeNull();
  expect(container.querySelector('nav[aria-label="Rooms"]').closest("[inert]")).toBeTruthy();
  expect(panel().textContent).toContain("3 new messages");
  expect(panel().textContent).toContain("Bob sent you a friend request");
  expect(document.activeElement).toBe(button("Close notifications"));

  await click("Mark all read");
  expect(notifications.markAllNotificationsRead).toHaveBeenCalledOnce();
  expect(mobileDialog()).toBeTruthy();
  await click("Close notifications");
  expect(mobileDialog()).toBeNull();
  expect(container.textContent).toContain("DM home");

  await click("Open navigation");
  await click("Notifications");
  const dialog = mobileDialog();
  await act(async () => dialog.click());
  expect(mobileDialog()).toBe(dialog);
  await act(async () => dialog.parentElement.click());
  expect(mobileDialog()).toBeNull();
});

it("uses the dedicated overlay when selecting Notifications from the mobile profile", async () => {
  state.isPhone = true;
  await renderShell();
  await click("Open navigation");
  await click("Alice");
  await click("Notifications");
  expect(mobileDialog()).toBeTruthy();
  expect(container.querySelector('[aria-label="Update avatar"]')).toBeNull();
});

it("opens the incoming requests profile section from a mobile notification", async () => {
  await openMobileNotifications();
  await act(async () => panel().querySelector('[aria-label="Unread"]').closest("button").click());
  expect(mobileDialog()).toBeNull();
  expect(button("Incoming").getAttribute("aria-pressed")).toBe("true");
  expect(container.querySelector('[aria-label="Update avatar"]')).toBeTruthy();
});

it("opens an unread conversation from the mobile overlay", async () => {
  await openMobileNotifications();
  const conversation = [...panel().querySelectorAll("button")].find((item) => item.textContent.includes("3 new messages"));
  await act(async () => conversation.click());
  expect(mobileDialog()).toBeNull();
  expect(container.querySelector("main main").textContent).toBe("Room 42 (dm)");
});

it("keeps the notification section and loaded feed when switching between mobile and desktop", async () => {
  await openMobileNotifications();
  state.isPhone = false;
  await renderShell();
  expect(mobileDialog()).toBeNull();
  expect(button("Notifications").getAttribute("aria-pressed")).toBe("true");
  expect(container.querySelector('[aria-label="Update avatar"]')).toBeTruthy();
  state.isPhone = true;
  await renderShell();
  expect(mobileDialog()).toBeTruthy();
  expect(panel().textContent).toContain("Bob sent you a friend request");
  expect(notifications.listNotifications).toHaveBeenCalledOnce();
});

it("keeps keyboard focus inside the mobile overlay and closes it on Escape", async () => {
  await openMobileNotifications();
  const first = button("Mark all read");
  const last = [...mobileDialog().querySelectorAll("button")].at(-1);
  first.focus();
  await act(async () => first.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(last);
  await act(async () => last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(first);
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(mobileDialog()).toBeNull();
});
