import { describe, expect, it } from "vitest";
import {
  applyNotificationsRead,
  applyUnreadEvent,
  describeNotification,
  formatUnread,
  notificationDestination,
  timeAgo,
} from "./notifications";

const ME = "me";
const activity = (fields = {}) => ({
  type: "activity", roomId: 5, change: "new", senderId: "bob", isSystem: false, ...fields,
});

describe("formatUnread", () => {
  it("is empty for nothing, the number up to 99, then 99+", () => {
    expect(formatUnread(0)).toBe("");
    expect(formatUnread(undefined)).toBe("");
    expect(formatUnread(7)).toBe("7");
    expect(formatUnread(99)).toBe("99");
    expect(formatUnread(100)).toBe("99+");
  });
});

describe("applyUnreadEvent", () => {
  const counts = new Map([["5", 2]]);

  it("adds one for someone else's new message", () => {
    expect(applyUnreadEvent(counts, activity(), { userId: ME }).get("5")).toBe(3);
    expect(applyUnreadEvent(new Map(), activity({ roomId: 9 }), { userId: ME }).get("9")).toBe(1);
  });

  it("ignores my messages, room events, edits, deletes, and the room being read", () => {
    for (const event of [
      activity({ senderId: ME }),
      activity({ isSystem: true, senderId: null }),
      activity({ change: "edited" }),
      activity({ change: "deleted" }),
    ]) {
      expect(applyUnreadEvent(counts, event, { userId: ME })).toBe(counts);
    }
    expect(applyUnreadEvent(counts, activity(), { userId: ME, isReading: (key) => key === "5" })).toBe(counts);
  });

  it("stops at 100, like the server", () => {
    expect(applyUnreadEvent(new Map([["5", 100]]), activity(), { userId: ME }).get("5")).toBe(100);
  });

  it("room.read sets the server's count; removal forgets the room", () => {
    expect(applyUnreadEvent(counts, { type: "read", roomId: 5, unread: 0 }, { userId: ME }).get("5")).toBe(0);
    expect(applyUnreadEvent(counts, { type: "read", roomId: 5, unread: 2 }, { userId: ME })).toBe(counts);
    expect(applyUnreadEvent(counts, { type: "removed", roomId: 5 }, { userId: ME }).has("5")).toBe(false);
  });

  it("other events change nothing", () => {
    expect(applyUnreadEvent(counts, { type: "updated", roomId: 5 }, { userId: ME })).toBe(counts);
  });
});

describe("describeNotification", () => {
  const n = (type, fields = {}) => ({ type, actor_username: "Alice", room_id: 5, role: null, ...fields });

  it("has a sentence per type", () => {
    expect(describeNotification(n("FRIEND_REQUEST"))).toBe("Alice sent you a friend request");
    expect(describeNotification(n("FRIEND_ACCEPTED"))).toBe("Alice accepted your friend request");
    expect(describeNotification(n("ROOM_ADDED"), "general")).toBe("Alice added you to #general");
    expect(describeNotification(n("ROOM_REMOVED"))).toBe("Alice removed you from a room");
    expect(describeNotification(n("ROLE_CHANGED", { role: "OWNER" }), "general")).toBe("Alice made you owner in #general");
  });

  it("stays readable for a type this client does not know", () => {
    expect(describeNotification(n("SOMETHING_NEW"))).toBe("You have a new notification");
  });
});

describe("notificationDestination", () => {
  it("friend notifications open the profile tabs, room ones the room, removal nothing", () => {
    expect(notificationDestination({ type: "FRIEND_REQUEST" })).toEqual({ type: "profile", tab: "requests" });
    expect(notificationDestination({ type: "FRIEND_ACCEPTED" })).toEqual({ type: "profile", tab: "friends" });
    expect(notificationDestination({ type: "ROOM_ADDED", room_id: 5 })).toEqual({ type: "room", roomId: 5 });
    expect(notificationDestination({ type: "ROLE_CHANGED", room_id: 5 })).toEqual({ type: "room", roomId: 5 });
    expect(notificationDestination({ type: "ROOM_REMOVED", room_id: 5 })).toBeNull();
    expect(notificationDestination({ type: "SOMETHING_NEW" })).toBeNull();
  });
});

describe("applyNotificationsRead", () => {
  const list = [{ id: "a", read: false }, { id: "b", read: false }, { id: "c", read: true }];

  it("marks the listed ids, or all", () => {
    expect(applyNotificationsRead(list, { ids: ["a"], all: false }).map((n) => n.read)).toEqual([true, false, true]);
    expect(applyNotificationsRead(list, { ids: null, all: true }).every((n) => n.read)).toBe(true);
  });

  it("returns the same list when nothing changes", () => {
    expect(applyNotificationsRead(list, { ids: ["c", "zzz"], all: false })).toBe(list);
  });
});

describe("timeAgo", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");

  it("rounds to the nearest unit", () => {
    expect(timeAgo("2026-10-25T11:59:30Z", now)).toMatch(/now/);
    expect(timeAgo("2026-10-25T11:55:00Z", now)).toMatch(/5 minutes ago/);
    expect(timeAgo("2026-10-25T09:00:00Z", now)).toMatch(/3 hours ago/);
    expect(timeAgo("2026-10-24T12:00:00Z", now)).toMatch(/yesterday/);
    expect(timeAgo("nonsense", now)).toBe("");
  });
});
