const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");


function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}


test("Assistant capability manifest has unique feature and action ids", () => {
  const manifest = JSON.parse(read("public/assistant-capabilities.json"));

  assert.ok(Array.isArray(manifest.features));
  assert.ok(manifest.features.length >= 10);
  assert.equal(manifest.modes.snake.badge, "LOCAL · FREE");
  assert.equal(manifest.modes.melissa.badge, "SMART · PLUS / PRO");

  const featureIds = manifest.features.map((feature) => feature.feature_id);
  assert.equal(new Set(featureIds).size, featureIds.length);

  const actionIds = manifest.features.flatMap((feature) =>
    (feature.actions || []).map((action) => action.id),
  );
  assert.equal(new Set(actionIds).size, actionIds.length);

  const required = [
    "system.text_input",
    "system.keyboard",
    "system.window_control",
    "system.scheduler",
    "system.power",
    "system.brightness",
    "system.status",
    "social.messaging",
  ];
  required.forEach((featureId) => assert.ok(featureIds.includes(featureId)));
});


test("capability page and renderer remain valid", () => {
  const html = read("public/features.html");
  const script = read("public/features.js");

  assert.match(html, /Что умеет/);
  assert.match(html, /features\.js/);
  assert.match(script, /assistant-capabilities\.json/);
  assert.doesNotThrow(() => new Function(script));
});
