const PLAN_CATALOG = Object.freeze({
  free: Object.freeze({
    id: "free",
    name: "Free",
    price_month_rub: 0,
    price_year_rub: 0,
    ai_budget_microusd: 0,
    badge: "LOCAL",
    tagline: "Змея и локальное управление компьютером",
    entitlements: [
      "snake_local_commands",
      "custom_triggers",
      "local_pc_control",
      "reminders_alarms",
      "screenshots_recording",
      "ziren_network",
    ],
  }),
  plus: Object.freeze({
    id: "plus",
    name: "Plus",
    price_month_rub: 399,
    price_year_rub: 3990,
    ai_budget_microusd: 1_500_000,
    badge: "SMART",
    tagline: "Мелисса, память и естественное управление",
    entitlements: [
      "snake_local_commands",
      "custom_triggers",
      "local_pc_control",
      "reminders_alarms",
      "screenshots_recording",
      "ziren_network",
      "melissa_semantic_commands",
      "melissa_chat",
      "long_term_memory",
      "persona_and_chronicle",
      "screen_analysis",
      "proactive_reactions",
    ],
  }),
  pro: Object.freeze({
    id: "pro",
    name: "Pro",
    price_month_rub: 899,
    price_year_rub: 8990,
    ai_budget_microusd: 4_000_000,
    badge: "MAX",
    tagline: "Максимальный AI-ресурс и экспериментальные функции",
    entitlements: [
      "snake_local_commands",
      "custom_triggers",
      "local_pc_control",
      "reminders_alarms",
      "screenshots_recording",
      "ziren_network",
      "melissa_semantic_commands",
      "melissa_chat",
      "long_term_memory",
      "persona_and_chronicle",
      "screen_analysis",
      "proactive_reactions",
      "priority_ai_budget",
      "experimental_features",
      "priority_beta_access",
      "generation_credit_access",
    ],
  }),
});


function subscriptionsEnforced() {
  return ["1", "true", "yes", "on"].includes(
    String(process.env.SUBSCRIPTIONS_ENFORCED || "").trim().toLowerCase(),
  );
}


async function initSubscriptionSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_subscriptions (
      user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      plan VARCHAR(16) NOT NULL DEFAULT 'free',
      status VARCHAR(24) NOT NULL DEFAULT 'active',
      current_period_start TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      current_period_end TIMESTAMPTZ,
      ai_budget_override_microusd BIGINT,
      cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
      provider VARCHAR(40),
      provider_customer_id VARCHAR(160),
      provider_subscription_id VARCHAR(160),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (plan IN ('free', 'plus', 'pro'))
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_usage_events (
      id BIGSERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      operation VARCHAR(80) NOT NULL,
      model VARCHAR(100) NOT NULL,
      input_tokens INT NOT NULL DEFAULT 0,
      cached_input_tokens INT NOT NULL DEFAULT 0,
      output_tokens INT NOT NULL DEFAULT 0,
      cost_microusd BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_usage_user_created
    ON ai_usage_events(user_id, created_at DESC);
  `);
}


function serializePublicPlan(plan) {
  return {
    id: plan.id,
    name: plan.name,
    price_month_rub: plan.price_month_rub,
    price_year_rub: plan.price_year_rub,
    badge: plan.badge,
    tagline: plan.tagline,
    entitlements: [...plan.entitlements],
  };
}


function getPublicPlanCatalog() {
  return Object.values(PLAN_CATALOG).map(serializePublicPlan);
}


async function getSubscriptionStatus(pool, userId) {
  await initSubscriptionSchema(pool);

  const subscriptionResult = await pool.query(
    `
    SELECT plan, status, current_period_start, current_period_end,
           ai_budget_override_microusd, cancel_at_period_end
    FROM user_subscriptions
    WHERE user_id = $1
    LIMIT 1
    `,
    [userId],
  );

  const row = subscriptionResult.rows[0] || null;
  const now = new Date();
  let planId = "free";
  let status = "active";
  let periodStart = null;
  let periodEnd = null;
  let cancelAtPeriodEnd = false;
  let budgetOverride = null;

  if (row) {
    const candidate = PLAN_CATALOG[String(row.plan || "").toLowerCase()];
    const rowStatus = String(row.status || "active").toLowerCase();
    const end = row.current_period_end ? new Date(row.current_period_end) : null;
    const expired = Boolean(end && end.getTime() <= now.getTime());

    if (candidate && ["active", "trialing"].includes(rowStatus) && !expired) {
      planId = candidate.id;
      status = rowStatus;
      periodStart = row.current_period_start || null;
      periodEnd = row.current_period_end || null;
      cancelAtPeriodEnd = Boolean(row.cancel_at_period_end);
      budgetOverride = row.ai_budget_override_microusd;
    } else if (expired || !["active", "trialing"].includes(rowStatus)) {
      status = expired ? "expired" : rowStatus;
    }
  }

  const plan = PLAN_CATALOG[planId];
  const budget = budgetOverride === null || budgetOverride === undefined
    ? plan.ai_budget_microusd
    : Math.max(0, Number(budgetOverride) || 0);
  const usageStart = periodStart || new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const usageResult = await pool.query(
    `
    SELECT
      COALESCE(SUM(cost_microusd), 0)::bigint AS cost_microusd,
      COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
      COALESCE(SUM(cached_input_tokens), 0)::bigint AS cached_input_tokens,
      COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
      COUNT(*)::int AS requests
    FROM ai_usage_events
    WHERE user_id = $1
      AND created_at >= $2
      AND ($3::timestamptz IS NULL OR created_at < $3::timestamptz)
    `,
    [userId, usageStart, periodEnd],
  );

  const usage = usageResult.rows[0] || {};
  const spent = Math.max(0, Number(usage.cost_microusd) || 0);
  const remaining = Math.max(0, budget - spent);
  const usagePercent = budget > 0
    ? Math.min(100, Math.round((spent / budget) * 100))
    : 0;
  const betaOverride = !subscriptionsEnforced();

  return {
    plan: plan.id,
    plan_name: plan.name,
    status,
    ai_enabled: betaOverride || (plan.id !== "free" && remaining > 0),
    beta_override: betaOverride,
    ai_usage_percent: usagePercent,
    ai_remaining_percent: budget > 0 ? Math.max(0, 100 - usagePercent) : 0,
    ai_requests: Number(usage.requests) || 0,
    current_period_start: periodStart,
    current_period_end: periodEnd,
    cancel_at_period_end: cancelAtPeriodEnd,
    entitlements: [...plan.entitlements],
  };
}


module.exports = {
  PLAN_CATALOG,
  getPublicPlanCatalog,
  getSubscriptionStatus,
  initSubscriptionSchema,
  subscriptionsEnforced,
};
