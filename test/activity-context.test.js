const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildActivityContext,
  buildCapabilityContext,
  normalizeCapabilities,
} = require("../lib/activity-context");


test("capability context is compact and strips control characters", () => {
  const normalized = normalizeCapabilities([
    {
      feature_id: "MEDIA.PLAYER",
      display_name: "Музыка\n",
      actions: ["пауза", "следующий трек"],
    },
  ]);
  const context = buildCapabilityContext(normalized);

  assert.equal(normalized[0].feature_id, "media.player");
  assert.match(context, /Музыка \(media\.player\): пауза, следующий трек/);
  assert.match(context, /локальное ядро/);
});

test("web chat receives the safe default local capability catalog", () => {
  const context = buildCapabilityContext([]);

  assert.match(context, /Запуск приложений/);
  assert.match(context, /Управление музыкой/);
  assert.match(context, /Управление окнами/);
});


test("activity context contains only bounded factual event fields", () => {
  const context = buildActivityContext([
    {
      event_type: "command.completed",
      feature_id: "media.player",
      subject_label: "включить музыку",
      occurred_at: "2026-07-29T20:00:00.000Z",
    },
  ]);

  assert.match(context, /command\.completed/);
  assert.match(context, /включить музыку/);
  assert.match(context, /Не говори, что ведёшь учёт/);
});
