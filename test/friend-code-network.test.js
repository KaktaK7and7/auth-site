const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { normalizeFriendCode } = require("../lib/friend-code-router");

test("friend code accepts human-friendly formatting", () => {
  assert.equal(normalizeFriendCode("zr-2a4b6c"), "ZR-2A4B6C");
  assert.equal(normalizeFriendCode("ZR 2A4B6C"), "ZR-2A4B6C");
  assert.equal(normalizeFriendCode("nickname"), "");
});

test("new Network browser scripts remain valid JavaScript", () => {
  for (const file of ["network-enhance.js", "network-profile.js"]) {
    const source = fs.readFileSync(
      path.join(__dirname, "..", "public", file),
      "utf8",
    );
    assert.doesNotThrow(() => new Function(source), file);
  }
});

test("friends page advertises nickname and permanent code lookup", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "public", "friends.html"),
    "utf8",
  );
  assert.match(source, /Ник или код ZR-XXXXXX/);
  assert.match(source, /data-friend-code/);
  assert.match(source, /network-enhance\.js/);
});
