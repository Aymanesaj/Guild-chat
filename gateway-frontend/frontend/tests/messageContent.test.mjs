import assert from "node:assert/strict";
import test from "node:test";
import {
  assertMessageSize,
  limitMessageInput,
  MAX_MESSAGE_BYTES,
  MAX_MESSAGE_INPUT_BYTES,
  messageByteLength,
} from "../src/utils/messageContent.js";

test("message validation accepts the boundary and rejects the next byte", () => {
  assert.doesNotThrow(() => assertMessageSize("a".repeat(MAX_MESSAGE_BYTES)));
  assert.throws(() => assertMessageSize("a".repeat(MAX_MESSAGE_BYTES + 1)), /4,000 bytes/);
});

test("message length counts UTF-8 bytes for accents and emoji", () => {
  assert.equal(messageByteLength("é😀"), 6);
  assert.doesNotThrow(() => assertMessageSize("😀".repeat(1000)));
  assert.throws(() => assertMessageSize("😀".repeat(1001)), /4,000 bytes/);
});

test("whitespace contributes to the displayed byte count", () => {
  assert.equal(messageByteLength(" a\n"), 3);
  assertMessageSize("");
});

test("large pastes are capped at the input byte limit", () => {
  assert.equal(limitMessageInput("a".repeat(100_000)), "a".repeat(MAX_MESSAGE_INPUT_BYTES));
});

test("input truncation preserves complete Unicode characters", () => {
  const prefix = "a".repeat(MAX_MESSAGE_INPUT_BYTES - 1);
  assert.equal(limitMessageInput(prefix + "😀"), prefix);
  assert.equal(limitMessageInput("😀".repeat(2000)), "😀".repeat(1250));
});

test("profile input caps use the same byte-safe truncation", () => {
  assert.equal(limitMessageInput("é".repeat(251), 500), "é".repeat(250));
  assert.equal(limitMessageInput("a".repeat(499) + "😀", 500), "a".repeat(499));
  assert.equal(messageByteLength("😀".repeat(20)), 80);
  assert.equal(messageByteLength("😀".repeat(70)), 280);
});
