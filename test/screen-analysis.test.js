const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeScreenAnalysisResponse,
} = require("../lib/screen-analysis");


test("screen analysis keeps bounded annotations and a linked safe click", () => {
  const normalized = normalizeScreenAnalysisResponse({
    answer: "  Нажми кнопку справа.  ",
    session_id: 17,
    mode: "guide",
    annotations: [{
      id: "next",
      label: "Продолжить",
      kind: "target",
      x: 0.75,
      y: 0.7,
      width: 0.4,
      height: 0.1,
      step: 1,
      ignored: "secret",
    }],
    action: {
      type: "click",
      target_id: "next",
      label: "Продолжить",
      risk: "safe",
      reason: "Обратимый переход.",
      x: 999,
    },
  });

  assert.equal(normalized.annotations[0].width, 0.25);
  assert.equal(normalized.action.type, "click");
  assert.equal(normalized.action.target_id, "next");
  assert.equal(normalized.action.x, undefined);
});


test("screen analysis blocks an action that is not linked to a visible target", () => {
  const normalized = normalizeScreenAnalysisResponse({
    answer: "Я не буду нажимать это автоматически.",
    session_id: 3,
    mode: "explain",
    annotations: [],
    action: {
      type: "click",
      target_id: "missing",
      label: "Удалить",
      risk: "safe",
      reason: "",
    },
  });

  assert.equal(normalized.action.type, "none");
  assert.equal(normalized.action.risk, "blocked");
});


test("screen analysis blocks a risky label even when upstream marks it safe", () => {
  const normalized = normalizeScreenAnalysisResponse({
    answer: "Я только покажу опасную кнопку.",
    session_id: 4,
    mode: "annotate",
    annotations: [{
      id: "delete",
      label: "Удалить аккаунт",
      kind: "target",
      x: 0.6,
      y: 0.6,
      width: 0.2,
      height: 0.1,
      step: 0,
    }],
    action: {
      type: "click",
      target_id: "delete",
      label: "Продолжить",
      risk: "safe",
      reason: "",
    },
  });

  assert.equal(normalized.action.type, "none");
  assert.equal(normalized.action.risk, "blocked");
});


test("screen analysis repairs a unique safe target for an explicit click", () => {
  const normalized = normalizeScreenAnalysisResponse({
    answer: "Я не могу сама нажать, нажми на профиль.",
    session_id: 8,
    mode: "guide",
    annotations: [{
      id: "profile",
      label: "Кнопка профиля Как_так?",
      kind: "target",
      x: 0.75,
      y: 0.1,
      width: 0.12,
      height: 0.06,
      step: 0,
    }],
    action: {
      type: "none",
      target_id: "",
      label: "Профиль",
      risk: "blocked",
      reason: "",
    },
  }, {
    message: "нажми на мой профиль и ник",
  });

  assert.equal(normalized.action.type, "click");
  assert.equal(normalized.action.target_id, "profile");
  assert.equal(normalized.action.risk, "safe");
  assert.match(normalized.answer, /нажимаю/i);
  assert.doesNotMatch(normalized.answer, /не могу/i);
});


test("screen analysis never repairs a risky explicit click", () => {
  const normalized = normalizeScreenAnalysisResponse({
    answer: "Удалить аккаунт?",
    session_id: 9,
    mode: "guide",
    annotations: [{
      id: "delete",
      label: "Удалить аккаунт",
      kind: "target",
      x: 0.75,
      y: 0.1,
      width: 0.12,
      height: 0.06,
      step: 0,
    }],
    action: {
      type: "none",
      target_id: "",
      label: "Удалить аккаунт",
      risk: "blocked",
      reason: "",
    },
  }, {
    message: "нажми удалить аккаунт",
  });

  assert.equal(normalized.action.type, "none");
  assert.equal(normalized.action.risk, "blocked");
});


test("screen analysis never clicks an oversized target", () => {
  const normalized = normalizeScreenAnalysisResponse({
    answer: "Вот профиль.",
    session_id: 10,
    mode: "guide",
    annotations: [{
      id: "whole-screen",
      label: "Профиль",
      kind: "target",
      x: 0.05,
      y: 0.05,
      width: 0.8,
      height: 0.7,
      step: 0,
    }],
    action: {
      type: "click",
      target_id: "whole-screen",
      label: "Профиль",
      risk: "safe",
      reason: "",
    },
  }, {
    message: "нажми на мой профиль",
  });

  assert.equal(normalized.action.type, "none");
  assert.equal(normalized.action.risk, "blocked");
});
