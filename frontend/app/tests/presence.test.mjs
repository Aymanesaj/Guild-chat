import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

/** Exercise the actual shared-socket module with browser and HTTP boundaries mocked. */
async function client() {
  const sockets = [];
  const timers = new Map();
  const listeners = new Map();
  let timerId = 0;
  class WebSocket {
    static OPEN = 1;
    readyState = 0;
    sent = [];
    constructor() { sockets.push(this); }
    send(frame) { this.sent.push(JSON.parse(frame)); }
    open() { this.readyState = 1; this.onopen(); }
    receive(event, data) { this.onmessage({ data: JSON.stringify({ event, data }) }); }
    close(code = 1000) { this.readyState = 3; return this.onclose?.({ code }); }
  }
  const context = vm.createContext({
    WebSocket,
    console,
    window: {
      location: { protocol: "https:", host: "chat.test" },
      addEventListener: (event, handler) => listeners.set(event, handler),
    },
    setTimeout: (callback, delay) => {
      timers.set(++timerId, { callback, delay });
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  function stub(exports) {
    return new vm.SyntheticModule(Object.keys(exports), function () {
      Object.entries(exports).forEach(([name, value]) => this.setExport(name, value));
    }, { context });
  }
  const boundaries = {
    "./http": stub({
      buildQuery: () => "", ensureFreshToken: async () => {}, jsonBody: () => ({}),
      LOGOUT_EVENT: "logout", refreshSession: async () => {},
      request: () => { throw new Error("Presence must not make REST requests"); },
    }),
    "./tokens": stub({
      getAccessToken: () => "access", getRefreshToken: () => "refresh", isAccessTokenExpired: () => false,
    }),
    "./users": stub({ resolveUsers: async () => new Map() }),
  };
  const module = new vm.SourceTextModule(
    await readFile(new URL("../src/api/messages.js", import.meta.url), "utf8"), { context },
  );
  await module.link((name) => boundaries[name]);
  await module.evaluate();
  return {
    api: module.namespace, sockets, timers,
    logout: () => listeners.get("logout")(),
    runTimers: () => {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach(({ callback }) => callback());
    },
  };
}

function frames(socket, event) {
  return socket.sent.filter((frame) => frame.event === event);
}

test("snapshots and changes use the existing shared socket and ignore unwatched users", async () => {
  const { api, sockets } = await client();
  const statuses = new Map();
  api.connectChat();
  api.subscribeToRoom(42, () => {});
  api.subscribeToPresence(["alice", "bob", "alice"], ({ userId, status }) => statuses.set(userId, status));
  assert.equal(sockets.length, 1);
  const socket = sockets[0];
  socket.open();
  assert.equal(frames(socket, "subscribe").length, 1);
  assert.deepEqual(frames(socket, "presence.subscribe")[0].data.user_ids, ["alice", "bob"]);
  socket.receive("presence.snapshot", { statuses: { alice: "online", bob: "offline", other: "online" } });
  assert.deepEqual([...statuses], [["alice", "online"], ["bob", "offline"]]);
  socket.receive("presence.changed", { user_id: "alice", status: "offline" });
  socket.receive("presence.changed", { user_id: "bob", status: "invalid" });
  assert.equal(statuses.get("alice"), "offline");
  assert.equal(statuses.get("bob"), "offline");
});

test("overlapping views get snapshots and only the last listener unsubscribes", async () => {
  const { api, sockets } = await client();
  const first = [];
  const second = [];
  const unsubscribeFirst = api.subscribeToPresence(["alice", "bob"], (change) => first.push(change));
  const socket = sockets[0];
  socket.open();
  const unsubscribeSecond = api.subscribeToPresence(["alice"], (change) => second.push(change));
  assert.equal(frames(socket, "presence.subscribe").length, 2);
  socket.receive("presence.snapshot", { statuses: { alice: "online" } });
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  unsubscribeFirst();
  assert.deepEqual(frames(socket, "presence.unsubscribe")[0].data.user_ids, ["bob"]);
  socket.receive("presence.changed", { user_id: "alice", status: "offline" });
  assert.equal(first.length, 1);
  assert.equal(second.length, 2);
  unsubscribeSecond();
  assert.deepEqual(frames(socket, "presence.unsubscribe")[1].data.user_ids, ["alice"]);
});

test("reconnect restores watched users and updates from the new snapshot", async () => {
  const { api, sockets, runTimers } = await client();
  const statuses = new Map();
  api.subscribeToPresence(["alice"], ({ userId, status }) => statuses.set(userId, status));
  sockets[0].open();
  sockets[0].receive("presence.snapshot", { statuses: { alice: "online" } });
  await sockets[0].close(1006);
  runTimers();
  assert.equal(sockets.length, 2);
  sockets[1].open();
  assert.deepEqual(frames(sockets[1], "presence.subscribe")[0].data.user_ids, ["alice"]);
  sockets[1].receive("presence.snapshot", { statuses: { alice: "offline" } });
  // An old connection must not overwrite the reconnect's fresh snapshot.
  sockets[0].receive("presence.snapshot", { statuses: { alice: "online" } });
  assert.equal(statuses.get("alice"), "offline");
});

test("presence subscriptions and cleanup are batched at 100 user IDs", async () => {
  const { api, sockets } = await client();
  const ids = Array.from({ length: 205 }, (_, i) => `user-${i}`);
  const unsubscribe = api.subscribeToPresence(ids, () => {});
  sockets[0].open();
  assert.deepEqual(frames(sockets[0], "presence.subscribe").map((frame) => frame.data.user_ids.length), [100, 100, 5]);
  unsubscribe();
  assert.deepEqual(frames(sockets[0], "presence.unsubscribe").map((frame) => frame.data.user_ids.length), [100, 100, 5]);
});

test("logout clears subscriptions and reconnect timers", async () => {
  const { api, sockets, timers, logout, runTimers } = await client();
  let delivered = 0;
  api.subscribeToPresence(["alice"], () => delivered++);
  sockets[0].open();
  logout();
  assert.equal(timers.size, 0);
  sockets[0].receive("presence.changed", { user_id: "alice", status: "offline" });
  runTimers();
  assert.equal(delivered, 0);
  assert.equal(sockets.length, 1);
});
