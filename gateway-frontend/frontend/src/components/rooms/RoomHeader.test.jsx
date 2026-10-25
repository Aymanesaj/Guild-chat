import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import RoomHeader from "./RoomHeader";

const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("../ui/ToastProvider", () => ({ useToast: () => toast }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container;
let root;
let remove;
let read;
const button = (label) => [...document.querySelectorAll("button")].find((item) =>
  item.getAttribute("aria-label") === label || item.textContent === label);
async function click(label) {
  expect(button(label), label).toBeTruthy();
  await act(async () => button(label).click());
}
async function render(onMarkRead = read) {
  await act(async () => root.render(<RoomHeader roomName="Bob" isDm onHideDm={remove} onMarkRead={onMarkRead} />));
}
beforeEach(async () => {
  vi.clearAllMocks();
  remove = vi.fn(async () => {});
  read = vi.fn(async () => {});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await render();
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

it("shows a dropdown with read and delete actions instead of a remove button", async () => {
  expect(button("Remove conversation")).toBeUndefined();
  expect(document.querySelector('[role="menu"]')).toBeNull();
  await click("Conversation options");
  expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(2);
  await click("Mark as read");
  expect(read).toHaveBeenCalledOnce();
  expect(remove).not.toHaveBeenCalled();
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it("deletes only on selection and prevents repeat actions while pending", async () => {
  let finish;
  remove.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await click("Conversation options");
  expect(remove).not.toHaveBeenCalled();
  await click("Delete conversation");
  expect(remove).toHaveBeenCalledOnce();
  expect(button("Conversation options").disabled).toBe(true);
  await act(async () => finish());
  expect(button("Conversation options").disabled).toBe(false);
});

it("disables mark as read until message history is available", async () => {
  await render(null);
  await click("Conversation options");
  expect(button("Mark as read").disabled).toBe(true);
  expect(button("Delete conversation").disabled).toBe(false);
});

it("handles a rejected action without an unhandled promise rejection", async () => {
  remove.mockRejectedValueOnce(new Error("Please retry"));
  await click("Conversation options");
  await click("Delete conversation");
  expect(toast.error).toHaveBeenCalledWith("Please retry");
  expect(button("Conversation options").disabled).toBe(false);
});

it("Escape closes the dropdown and restores focus to the trigger", async () => {
  await click("Conversation options");
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(button("Conversation options"));
});
