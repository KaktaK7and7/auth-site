const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeMessageBody,
  normalizeVoiceAlias,
} = require("../lib/social-router");


test("voice alias is normalized but remains user-readable", () => {
  assert.equal(normalizeVoiceAlias("  Диана   Работа  "), "Диана Работа");
});


test("voice alias rejects control characters and oversized values", () => {
  assert.throws(() => normalizeVoiceAlias(`Диана\u0000`));
  assert.throws(() => normalizeVoiceAlias("а".repeat(49)));
});


test("message body preserves line breaks but rejects empty and oversized text", () => {
  assert.equal(normalizeMessageBody("  привет\nмир  "), "привет\nмир");
  assert.throws(() => normalizeMessageBody("   "));
  assert.throws(() => normalizeMessageBody("x".repeat(4001)));
});


test("screenshot caption may be empty", () => {
  assert.equal(normalizeMessageBody("", { required: false }), "");
});
