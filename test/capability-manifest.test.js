const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const manifestPath = path.join(__dirname, "..", "public", "assistant-capabilities.json");

function loadManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}


test("website capability manifest is generated from the real Core registry", () => {
  const manifest = loadManifest();

  assert.equal(manifest.schema_version, 1);
  assert.equal(
    manifest.generated_from,
    "ziren-assistant-v2:ModuleRegistry",
  );
  assert.ok(Array.isArray(manifest.features));
  assert.ok(manifest.features.length > 0);
  assert.ok(!manifest.features.some((feature) => feature.feature_id === "system.test"));
});


test("every published capability action carries explicit Snake and Melissa routes", () => {
  const manifest = loadManifest();

  for (const feature of manifest.features) {
    assert.equal(typeof feature.snake, "boolean", feature.feature_id);
    assert.equal(typeof feature.melissa, "boolean", feature.feature_id);
    assert.ok(Array.isArray(feature.actions), feature.feature_id);

    for (const action of feature.actions) {
      assert.equal(typeof action.snake, "boolean", action.id);
      assert.equal(typeof action.melissa, "boolean", action.id);
      assert.ok(action.snake || action.melissa, `${action.id} has no executable route`);
    }
  }
});


test("F-key route boundary survives Core-to-website synchronization", () => {
  const manifest = loadManifest();
  const keyboard = manifest.features.find(
    (feature) => feature.feature_id === "system.keyboard",
  );
  assert.ok(keyboard);

  const actions = new Map(keyboard.actions.map((action) => [action.id, action]));
  assert.deepEqual(
    { snake: actions.get("keyboard.f1").snake, melissa: actions.get("keyboard.f1").melissa },
    { snake: true, melissa: false },
  );
  assert.deepEqual(
    {
      snake: actions.get("keyboard.function_key").snake,
      melissa: actions.get("keyboard.function_key").melissa,
    },
    { snake: false, melissa: true },
  );
});


test("capability catalog renderer exposes per-action route badges", () => {
  const script = fs.readFileSync(
    path.join(__dirname, "..", "public", "features.js"),
    "utf8",
  );

  assert.match(script, /typeof action\.snake === "boolean"/);
  assert.match(script, /typeof action\.melissa === "boolean"/);
  assert.match(script, /routeBadge\("ЗМЕЯ"/);
  assert.match(script, /routeBadge\("МЕЛИССА"/);
});
