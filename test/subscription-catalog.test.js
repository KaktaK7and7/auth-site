const assert = require("node:assert/strict");
const test = require("node:test");

const {
  PLAN_CATALOG,
  getPublicPlanCatalog,
  monthlyQuotaWindow,
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


test("included AI resource refreshes every calendar month even for annual billing", () => {
  const august = monthlyQuotaWindow(new Date("2026-08-17T23:59:00Z"));
  assert.equal(august.start.toISOString(), "2026-08-01T00:00:00.000Z");
  assert.equal(august.end.toISOString(), "2026-09-01T00:00:00.000Z");

  const december = monthlyQuotaWindow(new Date("2026-12-31T12:00:00Z"));
  assert.equal(december.start.toISOString(), "2026-12-01T00:00:00.000Z");
  assert.equal(december.end.toISOString(), "2027-01-01T00:00:00.000Z");
});
