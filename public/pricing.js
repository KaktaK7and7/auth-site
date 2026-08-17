const FEATURE_LABELS = {
  snake_local_commands: "Змея и локальные команды",
  custom_triggers: "Пользовательские голосовые триггеры",
  local_pc_control: "Локальное управление Windows",
  reminders_alarms: "Напоминания и будильники",
  screenshots_recording: "Скриншоты и запись экрана",
  ziren_network: "Ziren Network: друзья, чаты и группы",
  melissa_semantic_commands: "Мелисса понимает естественные команды",
  melissa_chat: "Диалог с Мелиссой",
  long_term_memory: "Умная долгосрочная память",
  persona_and_chronicle: "Персона и Хроника связи",
  screen_analysis: "AI-анализ экрана",
  proactive_reactions: "Контекстные и инициативные реакции",
  priority_ai_budget: "Повышенный AI-ресурс",
  drawing_generation: "Генеративные функции по мере выпуска",
  experimental_features: "Экспериментальные AI-функции",
  priority_beta_access: "Приоритетный beta-доступ",
};

let billingPeriod = "month";
let catalog = [];

function formatRub(value) {
  return new Intl.NumberFormat("ru-RU").format(Number(value) || 0) + " ₽";
}

function planButton(plan) {
  const link = document.createElement("a");
  link.className = plan.id === "plus"
    ? "site-button site-button--primary"
    : "site-button site-button--ghost";
  link.href = "/register.html";
  link.textContent = plan.id === "free" ? "Начать бесплатно" : "Доступ после beta";
  return link;
}

function renderPlans() {
  const grid = document.querySelector("[data-pricing-grid]");
  if (!grid) return;

  const nodes = catalog.map((plan) => {
    const card = document.createElement("article");
    card.className = `pricing-card${plan.id === "plus" ? " pricing-card--featured" : ""}`;

    const badge = document.createElement("span");
    badge.className = "pricing-card__badge";
    badge.textContent = plan.id === "plus" ? `${plan.badge} · РЕКОМЕНДУЕМ` : plan.badge;

    const title = document.createElement("h2");
    title.textContent = plan.name;

    const tagline = document.createElement("p");
    tagline.className = "pricing-card__tagline";
    tagline.textContent = plan.tagline;

    const price = document.createElement("div");
    price.className = "pricing-card__price";
    const amount = document.createElement("strong");
    const suffix = document.createElement("span");
    const selectedPrice = billingPeriod === "year"
      ? plan.price_year_rub
      : plan.price_month_rub;
    amount.textContent = formatRub(selectedPrice);
    suffix.textContent = plan.id === "free"
      ? "навсегда"
      : billingPeriod === "year" ? "/ год" : "/ месяц";
    price.append(amount, suffix);

    const yearNote = document.createElement("div");
    yearNote.className = "pricing-card__year-note";
    if (plan.id !== "free" && billingPeriod === "year") {
      const monthly = Math.round(plan.price_year_rub / 12);
      yearNote.textContent = `≈ ${formatRub(monthly)} в месяц`;
    } else if (plan.id !== "free") {
      yearNote.textContent = "Годовой тариф ≈ 2 месяца бесплатно";
    }

    const list = document.createElement("ul");
    (plan.entitlements || []).slice(0, plan.id === "pro" ? 9 : 8).forEach((entitlement) => {
      const item = document.createElement("li");
      item.textContent = FEATURE_LABELS[entitlement] || entitlement;
      list.append(item);
    });

    card.append(badge, title, tagline, price, yearNote, list, planButton(plan));
    return card;
  });

  grid.replaceChildren(...nodes);
}

async function loadCatalog() {
  const response = await fetch("/api/subscriptions/catalog", { cache: "no-store" });
  if (!response.ok) throw new Error("catalog unavailable");
  const data = await response.json();
  catalog = Array.isArray(data.plans) ? data.plans : [];
  renderPlans();
}

async function loadCurrentSubscription() {
  const sessionResponse = await fetch("/api/me", {
    credentials: "include",
    cache: "no-store",
  });
  if (!sessionResponse.ok) return;
  const session = await sessionResponse.json();
  if (!session.loggedIn) return;

  const response = await fetch("/api/subscriptions/me", {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) return;
  const data = await response.json();
  const subscription = data.subscription;
  if (!subscription) return;

  const panel = document.querySelector("[data-subscription-panel]");
  const title = document.querySelector("[data-current-plan]");
  const description = document.querySelector("[data-current-description]");
  const usage = document.querySelector("[data-ai-usage]");
  const percent = document.querySelector("[data-ai-percent]");
  const bar = document.querySelector("[data-ai-bar]");
  if (!panel || !title || !description) return;

  panel.hidden = false;
  title.textContent = `Сейчас: ${subscription.plan_name || subscription.plan}`;
  description.textContent = subscription.beta_override
    ? "На beta-этапе облачные функции открыты для тестирования без списаний. Счётчик уже работает, чтобы мы настроили реальные лимиты до запуска оплаты."
    : subscription.ai_enabled
      ? "Облачные возможности Мелиссы активны."
      : "Локальная Змея активна; облачные возможности Мелиссы сейчас недоступны.";

  if (subscription.plan !== "free" && usage && percent && bar) {
    const used = Math.max(0, Math.min(100, Number(subscription.ai_usage_percent) || 0));
    usage.hidden = false;
    percent.textContent = `${used}%`;
    bar.style.width = `${used}%`;
  }
}

function bindPeriodSwitch() {
  document.querySelectorAll("[data-period]").forEach((button) => {
    button.addEventListener("click", () => {
      billingPeriod = button.dataset.period === "year" ? "year" : "month";
      document.querySelectorAll("[data-period]").forEach((item) => {
        item.classList.toggle("is-active", item === button);
      });
      renderPlans();
    });
  });
}

bindPeriodSwitch();
Promise.allSettled([loadCatalog(), loadCurrentSubscription()]).then((results) => {
  if (results[0].status === "rejected") {
    const grid = document.querySelector("[data-pricing-grid]");
    if (grid) grid.textContent = "Не удалось загрузить тарифы. Обнови страницу чуть позже.";
  }
});
