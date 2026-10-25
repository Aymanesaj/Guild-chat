import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as notificationsApi from "../../api/notifications";
import * as roomsApi from "../../api/rooms";
import { UnreadProvider, useUnread } from "./UnreadContext";

let roomListener = null;
vi.mock("../../api/messages", () => ({
  onRoomEvent: (listener) => {
    roomListener = listener;
    return () => {
      roomListener = null;
    };
  },
}));
vi.mock("../../api/notifications", () => ({
  MAX_UNREAD: 100,
  getUnreadCounts: vi.fn(),
  markRoomRead: vi.fn(),
}));
vi.mock("../../api/rooms", () => ({ getDmRooms: vi.fn() }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const GROUPS = [{ id: 1, name: "general", type: "group" }];
const DM = { id: 7, type: "dm", peer: { id: "bob", username: "bob" } };

let root;
let unread;

function Probe({ onValue }) {
  const value = useUnread();
  useEffect(() => onValue(value));
  return null;
}

async function mount({ activeRoomId = null, groups = GROUPS } = {}) {
  root = createRoot(document.createElement("div"));
  const render = (props) =>
    root.render(
      <UnreadProvider userId="me" groupRooms={props.groups} activeRoomId={props.activeRoomId}>
        <Probe onValue={(value) => { unread = value; }} />
      </UnreadProvider>,
    );
  await act(async () => render({ activeRoomId, groups }));
  return render;
}

const emit = (event) => act(() => roomListener(event));
const count = (roomId) => unread.counts.get(String(roomId));

beforeEach(() => {
  vi.clearAllMocks();
  roomsApi.getDmRooms.mockResolvedValue([DM]);
  notificationsApi.getUnreadCounts.mockImplementation(async (ids) => new Map(ids.map((id) => [id, id === 1 ? 2 : 0])));
  notificationsApi.markRoomRead.mockResolvedValue({ unread: 0 });
});

afterEach(() => {
  act(() => root.unmount());
});

describe("UnreadProvider", () => {
  it("loads counts for group rooms and for DMs it loads itself", async () => {
    await mount();

    expect(roomsApi.getDmRooms).toHaveBeenCalled();
    expect(count(1)).toBe(2);
    expect(count(7)).toBe(0);
    expect(unread.unreadConversations.map(({ room, count: n }) => [room.id, n])).toEqual([[1, 2]]);
  });

  it("someone else's message adds one; mine and the open room's do not", async () => {
    await mount({ activeRoomId: 1 });

    await emit({ type: "activity", roomId: 7, change: "new", senderId: "bob", isSystem: false });
    await emit({ type: "activity", roomId: 7, change: "new", senderId: "me", isSystem: false });
    await emit({ type: "activity", roomId: 1, change: "new", senderId: "bob", isSystem: false });

    expect(count(7)).toBe(1);
    expect(count(1)).toBe(2);
  });

  it("room.read sets the count from the server", async () => {
    await mount();

    await emit({ type: "read", roomId: 1, unread: 0 });

    expect(count(1)).toBe(0);
    expect(unread.unreadConversations).toEqual([]);
  });

  it("markRead clears at once and tells the server once per newer message", async () => {
    await mount();

    await act(async () => unread.markRead(1, "66f0c1a2b3c4d5e6f7a8b9c1"));
    await act(async () => unread.markRead(1, "66f0c1a2b3c4d5e6f7a8b9c1"));
    await act(async () => unread.markRead(1, "66f0c1a2b3c4d5e6f7a8b9c0")); // older: ignored
    await act(async () => unread.markRead(1, "66f0c1a2b3c4d5e6f7a8b9c2"));

    expect(count(1)).toBe(0);
    expect(notificationsApi.markRoomRead.mock.calls).toEqual([
      [1, "66f0c1a2b3c4d5e6f7a8b9c1"],
      [1, "66f0c1a2b3c4d5e6f7a8b9c2"],
    ]);
  });

  it("a new room loads only its own count; a reconnect reloads everything", async () => {
    const render = await mount();
    notificationsApi.getUnreadCounts.mockClear();

    await act(async () => render({ activeRoomId: null, groups: [...GROUPS, { id: 3, name: "new", type: "group" }] }));
    expect(notificationsApi.getUnreadCounts.mock.calls).toEqual([[[3]]]);

    await act(async () => roomListener({ type: "resync" }));
    expect(notificationsApi.getUnreadCounts).toHaveBeenLastCalledWith([1, 3, 7]);
  });
});
