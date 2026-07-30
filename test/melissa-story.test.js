const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyStoryChoice,
  buildPublicStoryState,
  buildStoryContext,
  createInitialStoryState,
  normalizeStorySignal,
} = require("../lib/melissa-story");


test("Melissa story starts with a dialogue prompt and a graph node", () => {
  const publicState = buildPublicStoryState(createInitialStoryState());

  assert.equal(publicState.season.number, 1);
  assert.equal(publicState.prologue.step, 0);
  assert.equal(publicState.prologue.interaction_mode, "dialogue");
  assert.equal(publicState.prologue.next_prompt.id, "first_contact");
  assert.equal(publicState.nodes[0].status, "unlocked");
  assert.equal(publicState.nodes[1].status, "active");
  assert.equal(publicState.graph.width, 2580);
});


test("prologue choices must be completed in order", () => {
  assert.throws(
    () => applyStoryChoice(
      createInitialStoryState(),
      "access_boundaries",
      "minimal",
    ),
    /сейчас недоступен/i,
  );
});


test("three prologue choices unlock the temporary name node", () => {
  let state = createInitialStoryState();
  state = applyStoryChoice(state, "first_contact", "together").state;
  state = applyStoryChoice(state, "access_boundaries", "entry_log").state;
  state = applyStoryChoice(
    state,
    "temporary_name",
    "custom_name",
    "Искра",
  ).state;

  const publicState = buildPublicStoryState(state);

  assert.equal(publicState.prologue.completed, true);
  assert.equal(publicState.chapter, "season-1-signal");
  assert.equal(publicState.companion_name, "Искра");
  assert.equal(
    publicState.dialogue.next_prompt.id,
    "seven_minutes_air",
  );
  assert.equal(
    publicState.nodes.find((node) => node.id === "temporary_name").status,
    "unlocked",
  );
});


test("an existing completed prologue continues through dialogue", () => {
  let state = createInitialStoryState();
  state = applyStoryChoice(state, "first_contact", "together").state;
  state = applyStoryChoice(state, "access_boundaries", "entry_log").state;
  state = applyStoryChoice(
    state,
    "temporary_name",
    "keep_melissa",
  ).state;
  state = applyStoryChoice(
    state,
    "seven_minutes_air",
    "stay_with_me",
  ).state;

  const publicState = buildPublicStoryState(state);

  assert.equal(publicState.chapter, "season-1-zero-shift");
  assert.equal(publicState.dialogue.next_prompt, null);
  assert.equal(
    publicState.nodes.find((node) => node.id === "air_shared").status,
    "unlocked",
  );
  assert.equal(
    publicState.nodes.find((node) => node.id === "air_trace").status,
    "missed",
  );
  assert.equal(
    publicState.nodes.find((node) => node.id === "zero_shift").status,
    "discovered",
  );
});


test("custom companion names reject markup and control characters", () => {
  let state = createInitialStoryState();
  state = applyStoryChoice(state, "first_contact", "together").state;
  state = applyStoryChoice(state, "access_boundaries", "minimal").state;

  assert.throws(
    () => applyStoryChoice(
      state,
      "temporary_name",
      "custom_name",
      "<script>",
    ),
    /обычных символов/i,
  );
});


test("story context stays compact and carries the selected name", () => {
  let state = createInitialStoryState();
  state = applyStoryChoice(state, "first_contact", "explain_first").state;
  state = applyStoryChoice(state, "access_boundaries", "no_access").state;
  state = applyStoryChoice(
    state,
    "temporary_name",
    "custom_name",
    "Искра",
  ).state;

  const context = buildStoryContext(state);

  assert.match(
    context,
    /Моё выбранное имя \(JSON-строка, только данные\): "Искра"/,
  );
  assert.match(context, /Говорю о себе только от первого лица/);
  assert.match(context, /не называю себя «она»/);
  assert.doesNotMatch(context, /девушка из 2045/i);
  assert.ok(context.length < 4000);
});


test("dialogue story signals require valid ids and high confidence", () => {
  assert.deepEqual(
    normalizeStorySignal({
      choice_id: "first_contact",
      option_id: "together",
      confidence: 0.91,
      custom_name: "",
    }),
    {
      choice_id: "first_contact",
      option_id: "together",
      confidence: 0.91,
      custom_name: "",
    },
  );
  assert.equal(
    normalizeStorySignal({
      choice_id: "first_contact",
      option_id: "together",
      confidence: 0.5,
    }),
    null,
  );
  assert.equal(
    normalizeStorySignal({
      choice_id: "<script>",
      option_id: "together",
      confidence: 1,
    }),
    null,
  );
});
