import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { transformWithOxc } from "vite";
import * as messageContent from "../src/utils/messageContent.js";

const peer = { id: "peer", username: "alice", avatar: "avatar.png" };
const draft = { id: "draft-dm:peer", type: "dm", isDraft: true, peer_id: peer.id, peer };
const persisted = { id: 42, type: "dm", peer_id: peer.id, peer };
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function load(file, mocks) {
  const path = new URL(`../src/${file}`, import.meta.url);
  let code = await readFile(path, "utf8");
  if (file.endsWith(".jsx")) code = (await transformWithOxc(code, path.pathname)).code;
  const context = vm.createContext({ TextEncoder, console });
  const source = new vm.SourceTextModule(code, { context, identifier: path.pathname });
  await source.link((specifier) => {
    assert.ok(specifier in mocks, `Missing mock for ${specifier}`);
    const exports = mocks[specifier];
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context });
  });
  await source.evaluate();
  return source.namespace;
}

// Keep hook state across renders while inspecting the component's real props
// and running its effects explicitly, without a browser or extra dependencies.
function hooks() {
  const slots = [];
  let index = 0;
  let effects = [];
  const react = {
    useState(initial) {
      const key = index++;
      if (!(key in slots)) slots[key] = typeof initial === "function" ? initial() : initial;
      return [slots[key], (value) => {
        slots[key] = typeof value === "function" ? value(slots[key]) : value;
      }];
    },
    useRef(initial) {
      const key = index++;
      if (!(key in slots)) slots[key] = { current: initial };
      return slots[key];
    },
    useEffect(effect) { effects.push(effect); },
    useCallback: (callback) => callback,
    useMemo: (factory) => factory(),
  };
  return {
    react,
    render(component, props) { index = 0; effects = []; return component(props); },
    runEffects() { return effects.map((effect) => effect()).filter(Boolean); },
  };
}

async function roomsApi(request) {
  return load("api/rooms.js", {
    "./http": { request, jsonBody: (body) => ({ body }), buildQuery: () => "" },
    "./tokens": { getCurrentUserId: () => "me" },
    "./users": { resolveUsers: async () => new Map([[peer.id, peer]]) },
  });
}

test("opening a new DM is read-only and returns a stable local room with its peer", async () => {
  const calls = [];
  const api = await roomsApi(async (url, options) => { calls.push({ url, options }); return []; });
  const first = await api.openDm(peer);
  const second = await api.openDm(peer);
  assert.equal(first.isDraft, true);
  assert.equal(first.id, second.id);
  assert.equal(first.peer, peer);
  assert.ok(calls.every(({ url, options }) => url === "/api/orgs/rooms/dm" && !options.method));
});

test("opening an existing DM reuses its persisted ID without posting", async () => {
  const api = await roomsApi(async (_url, options) => {
    assert.equal(options.method, undefined);
    return [{ id: 42, type: "DM", userIdIfDm: peer.id }];
  });
  const room = await api.openDm(peer);
  assert.equal(room.id, 42);
  assert.equal(room.isDraft, undefined);
  assert.equal(room.peer, peer);
});

test("a failed existing-room lookup does not create a room or conceal the failure", async () => {
  const api = await roomsApi(async () => { throw new Error("offline"); });
  await assert.rejects(api.openDm(peer), /offline/);
});

async function mainPanel(overrides = {}) {
  const harness = hooks();
  const calls = [];
  const initialized = [];
  const module = await load("components/layout/MainPanel.jsx", {
    react: harness.react,
    "react/jsx-runtime": { jsx: (type, props, key) => ({ type, props, key }) },
    "../dms/DmView": { default: "DmView" },
    "../rooms/RoomView": { default: "RoomView" },
    "../../api/rooms": {
      getOrCreateDm: async (id) => { calls.push(["create", id]); return persisted; },
      openDm: async () => draft,
      ...overrides.rooms,
    },
    "../../api/messages": {
      sendMessage: async (id, content) => { calls.push(["send", id, content]); },
      onRoomEvent: () => () => {},
      ...overrides.messages,
    },
    "../../utils/messageContent": messageContent,
  });
  const props = { activeView: draft, onRoomInitialized: (...args) => initialized.push(args) };
  return { harness, calls, initialized, props, render: (next = props) => harness.render(module.default, next) };
}

test("first Send creates the room, sends to its real ID, then replaces only that draft", async () => {
  const view = await mainPanel();
  const local = view.render();
  assert.equal(local.props.roomId, null);
  assert.equal(local.props.peer, peer);
  assert.equal(view.calls.length, 0);
  await local.props.onSendDraft("  hello  ");
  assert.deepEqual(view.calls, [["create", peer.id], ["send", 42, "hello"]]);
  assert.equal(view.initialized[0][0], draft.id);
  assert.equal(view.initialized[0][1], persisted);
  const saved = view.render({ ...view.props, activeView: persisted });
  assert.equal(saved.key, local.key);
  assert.equal(saved.props.roomId, 42);
  assert.equal(saved.props.onSendDraft, undefined);
});

test("draft text survives visits to the DM list and the temporary-to-real ID change", async () => {
  const view = await mainPanel();
  view.render().props.onDraftChange("unfinished");
  view.render({ ...view.props, activeView: true });
  assert.equal(view.render().props.draft, "unfinished");
  const saved = view.render({ ...view.props, activeView: persisted });
  assert.equal(saved.props.draft, "unfinished");
});

test("blank or oversized first messages never create a room", async () => {
  const view = await mainPanel();
  const local = view.render();
  await local.props.onSendDraft("  ");
  await assert.rejects(local.props.onSendDraft("😀".repeat(1001)), /4,000 bytes/);
  assert.equal(view.calls.length, 0);
  assert.equal(view.initialized.length, 0);
});

test("a failed first send keeps the draft and can be retried", async () => {
  let failing = true;
  const view = await mainPanel({ messages: {
    sendMessage: async () => { if (failing) throw new Error("send failed"); },
  } });
  view.render().props.onDraftChange("keep me");
  await assert.rejects(view.render().props.onSendDraft("keep me"), /send failed/);
  assert.equal(view.initialized.length, 0);
  assert.equal(view.render().props.draft, "keep me");
  failing = false;
  await view.render().props.onSendDraft("keep me");
  assert.equal(view.initialized.length, 1);
});

test("creation failure prevents sending and preserves the conversation draft", async () => {
  const view = await mainPanel({ rooms: {
    getOrCreateDm: async () => { throw new Error("creation failed"); },
  } });
  view.render().props.onDraftChange("keep me");
  await assert.rejects(view.render().props.onSendDraft("keep me"), /creation failed/);
  assert.equal(view.calls.length, 0);
  assert.equal(view.initialized.length, 0);
  assert.equal(view.render().props.draft, "keep me");
});

test("a peer sending first promotes the local room through read-only discovery", async () => {
  let eventListener;
  let found = draft;
  const view = await mainPanel({
    rooms: { openDm: async () => found },
    messages: { onRoomEvent: (listener) => { eventListener = listener; return () => {}; } },
  });
  view.render();
  const cleanup = view.harness.runEffects();
  await tick();
  assert.equal(view.initialized.length, 0);
  found = persisted;
  eventListener({ type: "added" });
  await tick();
  assert.equal(view.initialized[0][1], persisted);
  assert.equal(view.calls.length, 0);
  cleanup.forEach((stop) => stop());
});

test("a temporary conversation has no history fetch or room subscription", async () => {
  const harness = hooks();
  const calls = [];
  const module = await load("hooks/useRoomMessages.js", {
    react: harness.react,
    "../api/messages": {
      deleteMessage: () => {}, editMessage: () => {}, sendMessage: () => {},
      listMessages: () => { calls.push("history"); return Promise.resolve([]); },
      subscribeToRoom: () => { calls.push("subscribe"); return () => {}; },
      onConnectionStatus: () => () => {},
    },
  });
  const temporary = harness.render(module.useRoomMessages, null);
  harness.runEffects();
  assert.equal(temporary.state, "success");
  assert.equal(temporary.messages.length, 0);
  assert.deepEqual(calls, []);
  harness.render(module.useRoomMessages, 42);
  const cleanup = harness.runEffects();
  await tick();
  assert.deepEqual(calls, ["subscribe", "history"]);
  cleanup.forEach((stop) => stop());
});
