const featureState = {
  manifest: null,
  query: "",
};

function text(value) {
  return String(value ?? "");
}

function normalize(value) {
  return text(value).toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
}

function modeCard(mode, key) {
  const article = document.createElement("article");
  article.className = "features-mode-card";

  const head = document.createElement("div");
  head.className = "features-mode-card__head";
  const title = document.createElement("h3");
  title.textContent = mode.title;
  const badge = document.createElement("span");
  badge.className = `feature-badge ${key === "snake" ? "feature-badge--snake" : ""}`;
  badge.textContent = mode.badge;
  head.append(title, badge);

  const description = document.createElement("p");
  description.textContent = mode.description;
  article.append(head, description);
  return article;
}

function routeBadge(label, snake = false) {
  const badge = document.createElement("b");
  badge.className = `feature-action__route ${snake ? "feature-action__route--snake" : ""}`;
  badge.textContent = label;
  return badge;
}

function actionNode(action, feature) {
  const item = document.createElement("li");
  item.className = "feature-action";

  const copy = document.createElement("span");
  const title = document.createElement("strong");
  title.textContent = action.title;
  const id = document.createElement("code");
  id.textContent = action.id;

  const routes = document.createElement("span");
  routes.className = "feature-action__routes";
  const snake = typeof action.snake === "boolean" ? action.snake : Boolean(feature.snake);
  const melissa = typeof action.melissa === "boolean" ? action.melissa : Boolean(feature.melissa);
  if (snake) routes.append(routeBadge("ЗМЕЯ", true));
  if (melissa) routes.append(routeBadge("МЕЛИССА"));

  copy.append(title, id, routes);

  const example = document.createElement("em");
  example.textContent = action.example ? `«${action.example}»` : "";
  item.append(copy, example);
  return item;
}

function featureMatches(feature, query) {
  if (!query) return true;
  const haystack = [
    feature.feature_id,
    feature.title,
    feature.note,
    ...(feature.actions || []).flatMap((action) => [
      action.id,
      action.title,
      action.example,
    ]),
  ].map(normalize).join(" ");
  return haystack.includes(query);
}

function featureCard(feature) {
  const article = document.createElement("article");
  article.className = "feature-card";

  const head = document.createElement("div");
  head.className = "feature-card__head";

  const copy = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = feature.title;
  const meta = document.createElement("div");
  meta.className = "feature-card__meta";
  meta.textContent = feature.feature_id;
  copy.append(title, meta);

  const badges = document.createElement("div");
  badges.className = "feature-card__badges";

  const status = document.createElement("span");
  status.className = `feature-badge ${feature.status === "testing" ? "feature-badge--testing" : ""}`;
  status.textContent = feature.status === "testing" ? "TESTING" : "AVAILABLE";
  badges.append(status);

  if (feature.melissa) {
    const melissa = document.createElement("span");
    melissa.className = "feature-badge";
    melissa.textContent = "МЕЛИССА";
    badges.append(melissa);
  }

  if (feature.snake) {
    const snake = document.createElement("span");
    snake.className = "feature-badge feature-badge--snake";
    snake.textContent = "ЗМЕЯ";
    badges.append(snake);
  }

  head.append(copy, badges);
  article.append(head);

  const actions = document.createElement("ul");
  actions.className = "feature-actions";
  (feature.actions || []).forEach((action) => actions.append(actionNode(action, feature)));
  article.append(actions);

  if (feature.note) {
    const note = document.createElement("p");
    note.className = "feature-note";
    note.textContent = feature.note;
    article.append(note);
  }

  return article;
}

function renderFeatures() {
  const list = document.querySelector("[data-feature-list]");
  const empty = document.querySelector("[data-feature-empty]");
  if (!list || !featureState.manifest) return;

  const query = normalize(featureState.query.trim());
  const features = (featureState.manifest.features || []).filter((feature) =>
    featureMatches(feature, query),
  );

  list.replaceChildren(...features.map(featureCard));
  if (empty) empty.hidden = features.length > 0;
}

async function loadFeatureManifest() {
  const list = document.querySelector("[data-feature-list]");

  try {
    const response = await fetch("/assistant-capabilities.json", {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("manifest request failed");

    const manifest = await response.json();
    if (!manifest || !Array.isArray(manifest.features)) {
      throw new Error("invalid manifest");
    }

    featureState.manifest = manifest;

    const count = document.querySelector("[data-feature-count]");
    if (count) count.textContent = String(manifest.features.length);

    const modes = document.querySelector("[data-mode-list]");
    if (modes && manifest.modes) {
      modes.replaceChildren(
        modeCard(manifest.modes.snake, "snake"),
        modeCard(manifest.modes.melissa, "melissa"),
      );
    }

    renderFeatures();
  } catch (error) {
    console.error("Не удалось загрузить capability manifest", error);
    if (list) {
      list.innerHTML = '<div class="features-loading">Каталог возможностей временно недоступен.</div>';
    }
  }
}

function setupFeatureSearch() {
  const search = document.querySelector("[data-feature-search]");
  if (!search) return;

  search.addEventListener("input", () => {
    featureState.query = search.value;
    renderFeatures();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupFeatureSearch();
  loadFeatureManifest();
});
