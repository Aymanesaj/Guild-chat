import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/loadModule.mjs";
import * as messageContent from "../src/utils/messageContent.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function chat() {
  const sockets = [];
  const timers = new Set();
  const window = new EventTarget();
  window.location = { protocol: "https:", host: "test.local" };
  let restCalls = 0;
  let refreshCalls = 0;
  class Socket {
    static OPEN = 1;
    readyState = 0;
    frames = [];
    constructor() { sockets.push(this); }
    send(frame) { this.frames.push(JSON.parse(frame)); }
    open() { this.readyState = Socket.OPEN; this.onopen?.(); }
    emit(event, data) { this.onmessage?.({ data: JSON.stringify({ event, data }) }); }
    close(code = 1000) { this.readyState = 3; return this.onclose?.({ code }); }
  }
  const api = await loadModule("api/messages.js", {
    "./http": {
      buildQuery: () => "", jsonBody: () => ({}), LOGOUT_EVENT: "auth:logout",
      request: async () => { restCalls++; return []; },
      ensureFreshToken: async () => {},
      refreshSession: async () => { refreshCalls++; },
    },
    "./tokens": {
      getAccessToken: () => "test-token", getRefreshToken: () => "test-refresh",
      isAccessTokenExpired: () => false,
    },
    "./users": { resolveUsers: async () => new Map() },
    "../utils/messageContent": messageContent,
  }, {
    window, WebSocket: Socket,
    setTimeout: (callback, delay) => {
      const timer = { callback, delay };
      timers.add(timer);
      return timer;
    },
    clearTimeout: (timer) => timers.delete(timer),
  });
  return {
    api, sockets, timers,
    get restCalls() { return restCalls; },
    get refreshCalls() { return refreshCalls; },
    logout: () => window.dispatchEvent(new Event("auth:logout")),
  };
}

test("presence subscriptions deduplicate IDs and batch frames without REST polling", async () => {
  const client = await chat();
  const ids = Array.from({ length: 205 }, (_, index) => `user-${index}`);
  const stop = client.api.subscribeToPresence([...ids, ids[0], null, ""], () => {});
  client.sockets[0].open();
  const frames = client.sockets[0].frames;
  assert.deepEqual(frames.map((frame) => frame.data.user_ids.length), [100, 100, 5]);
  assert.equal(new Set(frames.flatMap((frame) => frame.data.user_ids)).size, 205);
  assert.ok(frames.every((frame) => frame.event === "presence.subscribe"));
  assert.equal(client.restCalls, 0);
  stop();
  client.logout();
});

test("snapshots and changes reach all watchers until the final unsubscribe", async () => {
  const client = await chat();
  const first = [], second = [];
  const stopFirst = client.api.subscribeToPresence(["alice"], (event) => first.push(event.status));
  client.sockets[0].open();
  const stopSecond = client.api.subscribeToPresence(["alice"], (event) => second.push(event.status));
  const socket = client.sockets[0];
  socket.emit("presence.snapshot", { statuses: { alice: "online" } });
  assert.deepEqual(first, ["online"]);
  assert.deepEqual(second, ["online"]);
  stopFirst();
  assert.equal(socket.frames.filter((frame) => frame.event === "presence.unsubscribe").length, 0);
  socket.emit("presence.changed", { user_id: "alice", status: "offline" });
  socket.emit("presence.changed", { user_id: "alice", status: "invalid" });
  assert.deepEqual(first, ["online"]);
  assert.deepEqual(second, ["online", "offline"]);
  stopSecond();
  assert.equal(socket.frames.filter((frame) => frame.event === "presence.unsubscribe").length, 1);
  client.logout();
});

test("reconnect restores room and presence subscriptions and requests list resync", async () => {
  const client = await chat();
  const events = [];
  client.api.connectChat();
  client.api.onRoomEvent((event) => events.push(event.type));
  client.api.subscribeToRoom(42, () => {});
  client.api.subscribeToPresence(["alice"], () => {});
  const old = client.sockets[0];
  old.open();
  assert.deepEqual(events, []);
  await old.close(1006);
  assert.equal(client.refreshCalls, 1);
  const timer = [...client.timers].find((item) => item.delay === 1000);
  assert.ok(timer);
  client.timers.delete(timer);
  timer.callback();
  const socket = client.sockets[1];
  socket.open();
  assert.deepEqual(socket.frames.map((frame) => frame.event), ["subscribe", "presence.subscribe"]);
  assert.equal(socket.frames[0].data.room_id, 42);
  assert.deepEqual(events, ["resync"]);
  old.emit("room.added", { room_id: 99 });
  assert.deepEqual(events, ["resync"]);
  client.logout();
});

test("the signed-in socket stays open without a room and closes on logout", async () => {
  const client = await chat();
  client.api.connectChat();
  client.api.connectChat();
  assert.equal(client.sockets.length, 1);
  const socket = client.sockets[0];
  socket.open();
  const stop = client.api.subscribeToRoom(42, () => {});
  stop();
  assert.equal(client.timers.size, 0);
  assert.equal(socket.readyState, 1);
  client.logout();
  await tick();
  assert.equal(socket.readyState, 3);
  assert.equal(client.timers.size, 0);
});
