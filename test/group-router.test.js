const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { normalizeGroupName } = require("../lib/group-router");

test("group names are normalized and validated", () => {
  assert.equal(normalizeGroupName("  Моя   команда  "), "Моя команда");
  assert.throws(() => normalizeGroupName("a"), /от 2 до 80/);
  assert.throws(() => normalizeGroupName("x".repeat(81)), /от 2 до 80/);
});

test("network browser client is valid JavaScript and exposes friends and groups", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "public", "network.js"),
    "utf8",
  );
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /\/api\/social\/friends/);
  assert.match(source, /\/api\/social\/groups/);
  assert.match(source, /\/api\/social\/messages/);
});

test("friends and messages pages are present", () => {
  for (const file of ["friends.html", "messages.html"]) {
    const html = fs.readFileSync(path.join(__dirname, "..", "public", file), "utf8");
    assert.match(html, /ZIREN/);
    assert.match(html, /network\.js/);
  }
});
