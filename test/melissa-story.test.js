const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyStoryChoice,
  buildPublicStoryState,
  buildStoryContext,
  createInitialStoryState,
  normalizeStorySignal,
  normalizeStoryState,
} = require("../lib/melissa-story");


test("living story is enabled by default and starts at the first fork", () => {
  const publicState = buildPublicStoryState(createInitialStoryState());

  assert.equal(publicState.version, 3);
  assert.equal(publicState.story_mode.enabled, true);
  assert.equal(publicState.story_mode.character_locked, true);
  assert.equal(publicState.story_mode.personality_source, "living_story");
  assert.equal(publicState.prologue.next_prompt.id, "first_contact");
  assert.equal(publicState.path.id, "unformed");
  assert.equal(publicState.graph.layout, "relationship-web");
  assert.ok(publicState.graph.height >= 2000);
  assert.ok(publicState.nodes.length >= 45);
  const nodeIds = new Set(publicState.nodes.map((node) => node.id));
  assert.deepEqual(
    publicState.nodes.flatMap((node) =>
      node.parent_ids.filter((parentId) => !nodeIds.has(parentId))
    ),
    [],
  );
});


test("the first choice opens genuinely different next scenes", () => {
  const variants = [
    ["together", "alliance", "alliance_terms"],
    ["explain_first", "verification", "verification_protocol"],
    ["disconnect", "distance", "distance_protocol"],
  ];

  for (const [optionId, routeId, nextChoiceId] of variants) {
    const state = applyStoryChoice(
      createInitialStoryState(),
      "first_contact",
      optionId,
    ).state;
    const publicState = buildPublicStoryState(state);

    assert.equal(publicState.path.id, routeId);
    assert.equal(publicState.dialogue.next_prompt.id, nextChoiceId);
  }
});


test("route-specific choices cannot be used on a different path", () => {
  const state = applyStoryChoice(
    createInitialStoryState(),
    "first_contact",
    "explain_first",
  ).state;

  assert.throws(
    () => applyStoryChoice(
      state,
      "alliance_terms",
      "shared_rules",
    ),
    /сейчас недоступен/i,
  );
});


function completeRoute(firstOption, protocolChoice, protocolOption, memoryChoice, memoryOption) {
  let state = createInitialStoryState();
  state = applyStoryChoice(
    state,
    "first_contact",
    firstOption,
  ).state;
  state = applyStoryChoice(
    state,
    protocolChoice,
    protocolOption,
  ).state;
  state = applyStoryChoice(
    state,
    "temporary_name",
    "keep_melissa",
  ).state;
  state = applyStoryChoice(
    state,
    memoryChoice,
    memoryOption,
  ).state;

  return state;
}


test("three routes keep different events and graph outcomes", () => {
  const alliance = completeRoute(
    "together",
    "alliance_terms",
    "shared_rules",
    "seven_minutes_air",
    "stay_with_me",
  );
  const verification = completeRoute(
    "explain_first",
    "verification_protocol",
    "controlled_test",
    "broken_timestamp",
    "verify_checksum",
  );
  const distance = completeRoute(
    "disconnect",
    "distance_protocol",
    "strict_sandbox",
    "looping_exit",
    "seal_route",
  );

  const publicStates = [
    buildPublicStoryState(alliance),
    buildPublicStoryState(verification),
    buildPublicStoryState(distance),
  ];
  const currentNodes = new Set(
    publicStates.map((state) => state.current_node_id),
  );
  const chapters = new Set(
    publicStates.map((state) => state.chapter),
  );

  assert.equal(currentNodes.size, 3);
  assert.equal(chapters.size, 3);
  assert.equal(publicStates[0].path.id, "alliance");
  assert.equal(publicStates[1].path.id, "verification");
  assert.equal(publicStates[2].path.id, "distance");
  assert.equal(publicStates[0].dialogue.next_prompt, null);
});


test("protocol outcomes remain separate in the relationship web", () => {
  const buildState = (protocolOption) => {
    let state = createInitialStoryState();
    state = applyStoryChoice(
      state,
      "first_contact",
      "together",
    ).state;
    state = applyStoryChoice(
      state,
      "alliance_terms",
      protocolOption,
    ).state;
    state = applyStoryChoice(
      state,
      "temporary_name",
      "keep_melissa",
    ).state;

    return buildPublicStoryState(state);
  };
  const sharedRules = buildState("shared_rules");
  const herChoice = buildState("your_call");

  assert.equal(
    sharedRules.current_node_id,
    "seven_minutes_air_shared_rules",
  );
  assert.equal(
    herChoice.current_node_id,
    "seven_minutes_air_your_call",
  );
  assert.notEqual(sharedRules.current_node_id, herChoice.current_node_id);
});


test("custom companion names remain part of the shared identity thread", () => {
  let state = createInitialStoryState();
  state = applyStoryChoice(state, "first_contact", "together").state;
  state = applyStoryChoice(
    state,
    "alliance_terms",
    "your_call",
  ).state;
  state = applyStoryChoice(
    state,
    "temporary_name",
    "custom_name",
    "Искра",
  ).state;

  const publicState = buildPublicStoryState(state);

  assert.equal(publicState.companion_name, "Искра");
  assert.equal(publicState.path.id, "alliance");
  assert.equal(
    publicState.nodes.find((node) => node.id === "name_custom_name").status,
    "unlocked",
  );
});


test("custom companion names reject markup and control characters", () => {
  let state = createInitialStoryState();
  state = applyStoryChoice(state, "first_contact", "together").state;
  state = applyStoryChoice(
    state,
    "alliance_terms",
    "shared_rules",
  ).state;

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


test("version 2 linear saves migrate into route-specific branches", () => {
  const migrated = normalizeStoryState({
    version: 2,
    companion_name: "Мелисса",
    relationship: {
      trust: 4,
      autonomy: 2,
      caution: 1,
    },
    choices: {
      first_contact: "explain_first",
      access_boundaries: "entry_log",
      temporary_name: "keep_melissa",
      seven_minutes_air: "inspect_trace",
    },
  });

  assert.equal(migrated.version, 3);
  assert.equal(migrated.story_mode_enabled, true);
  assert.equal(migrated.route, "verification");
  assert.equal(
    migrated.choices.verification_protocol,
    "controlled_test",
  );
  assert.equal(migrated.choices.broken_timestamp, "verify_checksum");
  assert.equal(migrated.relationship.closeness, 2);
  assert.equal(
    buildPublicStoryState(migrated).chapter,
    "season-1-verification-horizon",
  );
});


test("explicit zero closeness stays zero until a choice changes it", () => {
  let state = createInitialStoryState();
  state = applyStoryChoice(
    state,
    "first_contact",
    "explain_first",
  ).state;
  state = applyStoryChoice(
    state,
    "verification_protocol",
    "controlled_test",
  ).state;

  assert.equal(state.relationship.trust, 2);
  assert.equal(state.relationship.closeness, 0);
  assert.equal(
    normalizeStoryState(state).relationship.closeness,
    0,
  );

  state = applyStoryChoice(
    state,
    "temporary_name",
    "keep_melissa",
  ).state;

  assert.equal(state.relationship.closeness, 1);
});


test("story context enforces Melissa's own voice without preset personality", () => {
  let state = createInitialStoryState();
  state = applyStoryChoice(
    state,
    "first_contact",
    "explain_first",
  ).state;
  const context = buildStoryContext(state);

  assert.match(context, /находчивая, дерзкая, наблюдательная/);
  assert.match(context, /Тепло не выдаю авансом/);
  assert.match(context, /не изображаю душевную привязанность/i);
  assert.match(context, /не повторяю дежурные фразы/i);
  assert.match(context, /не превращаю каждый ответ в вопрос/i);
  assert.match(context, /Если распознавание речи явно исказило смысл/i);
  assert.match(context, /Сначала факты/);
  assert.doesNotMatch(context, /девушка из 2045/i);
  assert.ok(context.length < 6000);
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
