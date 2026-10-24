import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AppShell from "./AppShell";
import MainPanel from "./MainPanel";
import { getOrCreateDm, hideDm, syncDmRooms } from "../../api/rooms";

const state = vi.hoisted(() => ({ listeners: new Set(), visible: [], error: vi.fn() }));
vi.mock("../../api/rooms", async (original) => ({
  ...(await original()),
  getRooms: vi.fn(async () => []),
  syncDmRooms: vi.fn(async () => state.visible),
  hideDm: vi.fn(),
  getOrCreateDm: vi.fn(),
  openDm: vi.fn(async (peer) => ({ id: `draft-dm:${peer.id}`, isDraft: true, type: "dm", peer })),
}));
vi.mock("../../api/messages", () => ({
  connectChat: vi.fn(), sendMessage: vi.fn(),
  onRoomEvent: (listener) => { state.listeners.add(listener); return () => state.listeners.delete(listener); },
}));
vi.mock("../../api/friends", () => ({ getFriendsList: async () => [{ id: "bob", username: "Bob" }] }));
vi.mock("../../hooks/usePresence", () => ({ usePresence: () => new Map() }));
vi.mock("../../hooks/useSocketNotifications", () => ({ useSocketNotifications: () => {} }));
vi.mock("../../hooks/useMediaQuery", () => ({ useMediaQuery: () => false }));
vi.mock("../ui/ToastProvider", () => ({ useToast: () => ({ error: state.error }) }));
vi.mock("./ProfileOverlayContext", () => ({
  ProfileOverlayProvider: ({ children }) => children,
  useProfileOverlay: () => ({ currentUser: { id: "alice" } }),
}));
vi.mock("./Sidebar", () => ({ default: ({ onDirectMessages }) => <button onClick={onDirectMessages}>DM home</button> }));
vi.mock("../rooms/RoomView", async () => {
  const { default: Header } = await import("../rooms/RoomHeader");
  return { default: ({ roomName, isDm, onHideDm, draft, onDraftChange }) => <>
    <Header roomName={roomName} isDm={isDm} onHideDm={onHideDm} />
    <button onClick={() => onDraftChange("unsent text")}>Write draft</button>
    <input aria-label="Message draft" value={draft} onChange={(event) => onDraftChange(event.target.value)} />
  </> };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let container;
const dm = { id: 42, type: "dm", peer_id: "bob", peer: { id: "bob", username: "Bob" },
  last_message: { id: "old", content: "old history preview", sent_at: "2026-10-24T10:00:00Z" } };
const buttons = () => [...container.querySelectorAll("button")];
async function click(label) {
  const button = buttons().find((item) => item.textContent === label || item.getAttribute("aria-label") === label);
  expect(button, `button ${label}`).toBeTruthy();
  await act(async () => button.click());
}
async function emit(event) {
  await act(async () => [...state.listeners].forEach((listener) => listener(event)));
}
async function mount(element = <AppShell user={{ id: "alice" }} />) {
  await act(async () => root.render(element));
}
async function openBob() {
  const row = [...container.querySelectorAll("li")].find((item) => item.textContent.includes("Bob"));
  await act(async () => row.querySelector("button").click());
}
beforeEach(() => {
  vi.clearAllMocks();
  syncDmRooms.mockImplementation(async () => state.visible);
  state.listeners.clear();
  state.visible = [dm];
  hideDm.mockImplementation(async () => { state.visible = []; });
  getOrCreateDm.mockImplementation(async () => { state.visible = [dm]; return dm; });
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

it("hides an open persisted DM, returns home, and keeps it absent on sync", async () => {
  await mount();
  await openBob();
  await click("Write draft");
  await click("Remove conversation");
  expect(hideDm).toHaveBeenCalledWith(42);
  expect(container.textContent).toContain("Direct Messages");
  expect(container.textContent).not.toContain("old history preview");
  await emit({ type: "resync" });
  expect(container.textContent).not.toContain("old history preview");
  await click("Toggle friends");
  await click("Message Bob");
  expect(container.querySelector('[aria-label="Message draft"]').value).toBe("unsent text");
});

it("explicit friend reopening uses getOrCreateDm and opens the same persisted DM", async () => {
  state.visible = [];
  await mount();
  await click("Toggle friends");
  await click("Message Bob");
  expect(getOrCreateDm).toHaveBeenCalledWith("bob");
  expect(container.textContent).toContain("Bob");
  await click("Remove conversation");
  expect(hideDm).toHaveBeenCalledWith(42);
});

it("room.added discovers a hidden DM, restores its preview, and activity updates it", async () => {
  const carol = { ...dm, id: 43, peer: { id: "carol", username: "Carol" },
    last_message: { id: "carol-message", content: "hello", sent_at: "2026-10-25T10:00:00Z" } };
  state.visible = [carol];
  await mount();
  state.visible = [carol, dm];
  const calls = syncDmRooms.mock.calls.length;
  await emit({ type: "added", roomId: 42 });
  expect(syncDmRooms.mock.calls.length).toBeGreaterThan(calls);
  expect(container.textContent).toContain("old history preview");
  expect(container.querySelector("li").textContent).toContain("Carol");
  await emit({ type: "activity", roomId: 42, change: "new",
    preview: { id: "new", content: "incoming message", sent_at: "2026-10-25T11:00:00Z" } });
  expect(container.textContent).toContain("incoming message");
  expect(container.querySelector("li").textContent).toContain("Bob");
  expect(container.textContent).not.toContain("old history preview");
});

it("a hide failure leaves the active DM open and reports the error", async () => {
  hideDm.mockRejectedValue(new Error("Try again"));
  await mount();
  await openBob();
  await click("Remove conversation");
  expect(container.textContent).toContain("Remove conversation");
  expect(state.error).toHaveBeenCalledWith("Try again");
});

it("room.removed on another device closes the active DM", async () => {
  await mount();
  await openBob();
  state.visible = [];
  await emit({ type: "removed", roomId: "42" });
  expect(container.textContent).toContain("Direct Messages");
  expect(container.textContent).not.toContain("Remove conversation");
});

it("does not interrupt a different conversation opened while hiding is pending", async () => {
  let finish;
  hideDm.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await mount();
  await openBob();
  await click("Remove conversation");
  await click("DM home");
  await click("Toggle friends");
  await click("Message Bob");
  await act(async () => finish());
  expect(container.textContent).toContain("Remove conversation");
});

it.each([true, false])("draft DM has no remove action (isDraft=%s)", async (isDraft) => {
  await mount(<MainPanel activeView={{ ...dm, id: "draft-dm:bob", isDraft }}
    onRoomInitialized={vi.fn()} onHideDm={vi.fn()} />);
  expect(container.textContent).not.toContain("Remove conversation");
  expect(hideDm).not.toHaveBeenCalled();
});

it("activity arriving during room.added sync is replayed on the discovered DM", async () => {
  state.visible = [];
  await mount();
  let finish;
  syncDmRooms.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await emit({ type: "added", roomId: 42 });
  await emit({ type: "activity", roomId: 42, change: "new",
    preview: { id: "new", content: "received during sync", sent_at: "2026-10-25T11:00:00Z" } });
  await act(async () => finish([dm]));
  expect(container.textContent).toContain("received during sync");
});

it("group rooms do not expose the DM remove action", async () => {
  await mount(<MainPanel activeView={{ id: 43, type: "group", name: "Group" }}
    onRoomInitialized={vi.fn()} onHideDm={vi.fn()} />);
  expect(container.textContent).toContain("Members");
  expect(container.textContent).not.toContain("Remove conversation");
});
