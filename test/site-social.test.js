const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");


test("site social profile script remains valid browser JavaScript", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "public", "site.js"),
    "utf8",
  );

  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /\/api\/social\/friends/);
  assert.match(source, /show_friends_on_profile/);
  assert.match(source, /\/api\/social\/public\//);
  assert.match(source, /\/profile-social\.css/);
});
