const assert = require("node:assert/strict");
const test = require("node:test");

const {
  PLAN_CATALOG,
  getPublicPlanCatalog,
} = require("../lib/subscription-service");


test("subscription catalog has stable Free Plus Pro order and launch prices", () => {
  const plans = getPublicPlanCatalog();
  assert.deepEqual(plans.map((plan) => plan.id), ["free", "plus", "pro"]);
  assert.equal(plans[0].price_month_rub, 0);
  assert.equal(plans[1].price_month_rub, 399);
  assert.equal(plans[1].price_year_rub, 3990);
  assert.equal(plans[2].price_month_rub, 899);
  assert.equal(plans[2].price_year_rub, 8990);
});


test("Free keeps local Snake while Melissa starts at Plus", () => {
  assert.ok(PLAN_CATALOG.free.entitlements.includes("snake_local_commands"));
  assert.ok(!PLAN_CATALOG.free.entitlements.includes("melissa_chat"));
  assert.ok(PLAN_CATALOG.plus.entitlements.includes("melissa_semantic_commands"));
  assert.ok(PLAN_CATALOG.plus.entitlements.includes("melissa_chat"));
  assert.ok(PLAN_CATALOG.pro.entitlements.includes("melissa_chat"));
});


test("Pro has a larger internal AI budget than Plus", () => {
  assert.ok(PLAN_CATALOG.plus.ai_budget_microusd > 0);
  assert.ok(PLAN_CATALOG.pro.ai_budget_microusd > PLAN_CATALOG.plus.ai_budget_microusd);
});
