const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeDrawingRequest,
} = require("../lib/drawing-request");


test("drawing request keeps only bounded safe fields", () => {
  const normalized = normalizeDrawingRequest({
    kind: "technical",
    title: "  Робо-рука\u0000  ",
    prompt: "  Вид сбоку\nи схема суставов  ",
    story_relevant: false,
    completion_line: "Ну? Хвалить будешь?",
    user_id: 999,
    image_data_url: "must-not-pass",
  });

  assert.deepEqual(normalized, {
    kind: "technical",
    title: "Робо-рука",
    prompt: "Вид сбоку и схема суставов",
    story_relevant: false,
    completion_line: "Ну? Хвалить будешь?",
  });
});


test("story drawings are always marked as story relevant", () => {
  const normalized = normalizeDrawingRequest({
    kind: "story",
    title: "Белый шум",
    prompt: "Коридор из неполного воспоминания",
  });

  assert.equal(normalized.story_relevant, true);
});


test("drawing request rejects missing title or subject", () => {
  assert.equal(
    normalizeDrawingRequest({ title: "", prompt: "Рука" }),
    null,
  );
  assert.equal(
    normalizeDrawingRequest({ title: "Рука", prompt: "x" }),
    null,
  );
});
