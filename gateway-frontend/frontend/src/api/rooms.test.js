import { beforeEach, expect, it, vi } from "vitest";
import { getOrCreateDm, hideDm, sortDmRooms, syncDmRooms } from "./rooms";
import { request } from "./http";

vi.mock("./http", async (original) => ({ ...(await original()), request: vi.fn() }));
vi.mock("./users", () => ({ resolveUsers: async () => new Map() }));

beforeEach(() => vi.clearAllMocks());

it("hides through the encoded DM DELETE endpoint", async () => {
  request.mockResolvedValue(null);
  await hideDm("42/1");
  expect(request).toHaveBeenCalledWith("/api/orgs/rooms/dm/42%2F1",
    { method: "DELETE" }, "Failed to remove conversation");
});

it("explicit reopening uses get-or-create and preserves the persisted room id", async () => {
  request.mockResolvedValue({ id: 42, type: "DM", userIdIfDm: "bob" });
  const room = await getOrCreateDm("bob");
  expect(request).toHaveBeenCalledWith("/api/orgs/rooms/dm", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: "bob" }),
  }, "Failed to open conversation");
  expect(room).toMatchObject({ id: 42, type: "dm", peer_id: "bob" });
});

it("drops hidden DMs on sync and fetches their preview again when rediscovered", async () => {
  const known = [{ id: 42, last_message: { id: "old", content: "old" } }];
  request.mockResolvedValueOnce([]);
  expect(await syncDmRooms(known)).toEqual([]);
  request.mockResolvedValueOnce([{ id: 42, type: "DM", userIdIfDm: "bob" }])
    .mockResolvedValueOnce({ 42: { id: "new", content: "back again", created_at: "2026-10-25T10:00:00Z" } });
  const restored = await syncDmRooms([]);
  expect(restored[0].last_message).toEqual({ id: "new", content: "back again", sent_at: "2026-10-25T10:00:00Z" });
  expect(request).toHaveBeenLastCalledWith("/api/chat/rooms/last-messages?ids=42", {}, "Failed to load messages");
  expect(sortDmRooms([{ id: 3, created_at: "2026-10-24T10:00:00Z" }, ...restored])[0].id).toBe(42);
});
