const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");


const source = fs.readFileSync(
  path.join(__dirname, "..", "lib", "api-response.js"),
  "utf8",
);


test("semantic gateway keeps the 40-action per-feature contract", () => {
  assert.match(source, /feature\.actions\.slice\(0,\s*40\)/);
});


test("semantic gateway preserves structured voice examples", () => {
  assert.match(source, /action\.voice_examples/);
  assert.match(source, /voice_examples:\s*voiceExamples/);
  assert.match(source, /\.slice\(0,\s*8\)/);
});


test("semantic gateway bounds argument hints instead of accepting unbounded prompt text", () => {
  assert.match(
    source,
    /String\(action\.argument_hint\s*\|\|\s*""\)\.trim\(\)\.slice\(0,\s*160\)/,
  );
});
