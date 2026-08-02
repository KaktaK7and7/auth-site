let session_id = 0;
let typingEl = null;
let user_id = null;
let currentStory = null;
let storyWebZoom = 0.52;
let expandedStoryNodeId = "";
let storyPanState = null;
let selectedPersonaPreset = "";

const STORY_WEB_PADDING = 240;
const STORY_FOCUS_ZOOM = 0.82;

const messages = document.getElementById("messages");
const form = document.getElementById("form");
const input = document.getElementById("input");
const sessionEl = document.getElementById("session");
const memoryEl = document.getElementById("memory");
const memoryItemsEl = document.getElementById("memory-items");
const memoryForm = document.getElementById("memory-form");
const memoryInput = document.getElementById("memory-input");
const memoryToggle = document.getElementById("memory-toggle");
const memoryModal = document.getElementById("memory-modal");
const memoryModalClose = document.getElementById("memory-modal-close");
const memoryClearBtn = document.getElementById("memory-clear-btn");
const storyOpenBtn = document.getElementById("story-open-btn");
const storyModal = document.getElementById("story-modal");
const storyModalClose = document.getElementById("story-modal-close");
const storyModeLabel = document.getElementById("story-mode-label");
const storyPathLabel = document.getElementById("story-path-label");
const storyNextLabel = document.getElementById("story-next-label");
const storySummaryMode = document.getElementById("story-summary-mode");
const storySummaryPath = document.getElementById("story-summary-path");
const storySummaryLink = document.getElementById("story-summary-link");
const storyGuidance = document.getElementById("story-guidance");
const storyGuidanceStep = document.getElementById("story-guidance-step");
const storyGuidanceTitle = document.getElementById("story-guidance-title");
const storyGuidanceStatus = document.getElementById("story-guidance-status");
const storyGuidanceObjective = document.getElementById("story-guidance-objective");
const storyGuidanceWhy = document.getElementById("story-guidance-why");
const storyGuidanceSuggestions = document.getElementById("story-guidance-suggestions");
const storyWeb = document.getElementById("story-web");
const storyWebViewport = document.getElementById("story-web-viewport");
const storyNodeInspector = document.getElementById("story-node-inspector");
const storyFocusBtn = document.getElementById("story-focus-btn");
const storyFitBtn = document.getElementById("story-fit-btn");
const storyZoomOutBtn = document.getElementById("story-zoom-out");
const storyZoomInBtn = document.getElementById("story-zoom-in");
const storyZoomLabel = document.getElementById("story-zoom-label");
const companionModeStoryBtn = document.getElementById("companion-mode-story");
const companionModePlainBtn = document.getElementById("companion-mode-plain");
const companionModeNote = document.getElementById("companion-mode-note");
const personaPresetPanel = document.getElementById("persona-preset-panel");
const personaPresetList = document.getElementById("persona-preset-list");

const nameEl = document.getElementById("name");
const roleEl = document.getElementById("role");

const nameInput = document.getElementById("assistant-name-input");
const saveNameBtn = document.getElementById("save-name-btn");
const assistantResetBtn = document.getElementById("assistant-reset-btn");
const resetConfirmation = document.getElementById("reset-confirmation");
const resetConfirmCheckbox = document.getElementById("reset-confirm-checkbox");
const resetConfirmBtn = document.getElementById("reset-confirm-btn");
const resetCancelBtn = document.getElementById("reset-cancel-btn");

// вывод сообщения
function add(role, text) {
  const el = document.createElement("div");
  el.className = "msg " + role;

  const time = new Date().toLocaleTimeString();
  const textEl = document.createElement("div");
  const timeEl = document.createElement("div");

  textEl.textContent = String(text ?? "");
  timeEl.textContent = time;
  timeEl.style.fontSize = "10px";
  timeEl.style.opacity = "0.5";
  timeEl.style.marginTop = "4px";

  el.append(textEl, timeEl);

  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
}

function getAssistantTypingName() {
  return nameEl?.textContent?.trim() || "Ассистент";
}

function showTyping() {
  typingEl = document.createElement("div");
  typingEl.className = "msg assistant";
  typingEl.textContent = `${getAssistantTypingName()} печатает...`;
  messages.appendChild(typingEl);
  messages.scrollTop = messages.scrollHeight;
}

function hideTyping() {
  if (typingEl) {
    typingEl.remove();
    typingEl = null;
  }
}

function typeText(text) {
  const content = String(text ?? "");
  let i = 0;
  const el = document.createElement("div");
  el.className = "msg assistant";
  messages.appendChild(el);

  if (!content) return;

  const interval = setInterval(() => {
    el.textContent += content[i];
    i++;
    messages.scrollTop = messages.scrollHeight;

    if (i >= content.length) {
      clearInterval(interval);
    }
  }, 10);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getStoryNode(story, nodeId) {
  return story?.nodes?.find((node) => node.id === nodeId) || null;
}

function clampStoryWebZoom(value) {
  return Math.min(1.2, Math.max(0.18, value));
}

function getStoryWebDimensions(story = currentStory) {
  const graphWidth = Number(story?.graph?.width) || 2840;
  const graphHeight = Number(story?.graph?.height) || 3360;

  return {
    graphWidth,
    graphHeight,
    stageWidth: graphWidth + STORY_WEB_PADDING * 2,
    stageHeight: graphHeight + STORY_WEB_PADDING * 2,
  };
}

function syncStoryWebScale() {
  if (!storyWeb || !currentStory?.graph) return;

  const { stageWidth, stageHeight } = getStoryWebDimensions();
  const canvas = storyWeb.querySelector(".story-web__canvas");

  storyWeb.style.width = `${stageWidth * storyWebZoom}px`;
  storyWeb.style.height = `${stageHeight * storyWebZoom}px`;

  if (canvas) {
    canvas.style.width = `${stageWidth}px`;
    canvas.style.height = `${stageHeight}px`;
    canvas.style.transform = `scale(${storyWebZoom})`;
  }

  if (storyZoomLabel) {
    storyZoomLabel.textContent = `${Math.round(storyWebZoom * 100)}%`;
  }
}

function setStoryWebZoom(nextValue, clientX, clientY) {
  if (!storyWebViewport || !storyWeb || !currentStory?.graph) return;

  const nextZoom = clampStoryWebZoom(nextValue);
  if (nextZoom === storyWebZoom) return;

  const bounds = storyWebViewport.getBoundingClientRect();
  const viewportX =
    typeof clientX === "number"
      ? clientX - bounds.left
      : storyWebViewport.clientWidth / 2;
  const viewportY =
    typeof clientY === "number"
      ? clientY - bounds.top
      : storyWebViewport.clientHeight / 2;
  const graphX = (storyWebViewport.scrollLeft + viewportX) / storyWebZoom;
  const graphY = (storyWebViewport.scrollTop + viewportY) / storyWebZoom;

  storyWebZoom = nextZoom;
  syncStoryWebScale();

  requestAnimationFrame(() => {
    storyWebViewport.scrollTo({
      left: graphX * nextZoom - viewportX,
      top: graphY * nextZoom - viewportY,
      behavior: "auto"
    });
  });
}

function renderStoryInspector(node) {
  if (!storyNodeInspector || !node) return;

  const statusLabels = {
    active: "ТЕКУЩАЯ РАЗВИЛКА",
    unlocked: "ПРОЖИТО",
    discovered: "ОБНАРУЖЕНО",
    missed: "НЕПРОЖИТЫЙ ПУТЬ",
    hidden: "СИГНАЛ ОТСУТСТВУЕТ"
  };
  const status = document.createElement("span");
  const title = document.createElement("strong");
  const description = document.createElement("p");

  status.textContent = statusLabels[node.status] || "УЗЕЛ СВЯЗИ";
  title.textContent = node.title;
  description.textContent = node.description;
  storyNodeInspector.replaceChildren(status, title, description);
}

function renderStoryWeb(story) {
  if (!storyWeb || !story?.graph || !Array.isArray(story.nodes)) return;

  const { stageWidth, stageHeight } = getStoryWebDimensions(story);
  const nodeWidth = 190;
  const nodeHeight = 84;
  const nodesById = new Map(story.nodes.map((node) => [node.id, node]));
  const svgNamespace = "http://www.w3.org/2000/svg";
  const canvas = document.createElement("div");
  const svg = document.createElementNS(svgNamespace, "svg");

  canvas.className = "story-web__canvas";
  canvas.style.width = `${stageWidth}px`;
  canvas.style.height = `${stageHeight}px`;
  canvas.style.transform = `scale(${storyWebZoom})`;
  svg.setAttribute("viewBox", `0 0 ${stageWidth} ${stageHeight}`);
  svg.setAttribute("aria-hidden", "true");

  for (const node of story.nodes) {
    for (const parentId of node.parent_ids || []) {
      const parent = nodesById.get(parentId);
      if (!parent) continue;

      const path = document.createElementNS(svgNamespace, "path");
      const startX = Number(parent.x) + STORY_WEB_PADDING + nodeWidth;
      const startY = Number(parent.y) + STORY_WEB_PADDING + nodeHeight / 2;
      const endX = Number(node.x) + STORY_WEB_PADDING;
      const endY = Number(node.y) + STORY_WEB_PADDING + nodeHeight / 2;
      const bend = Math.max(50, (endX - startX) * 0.48);

      path.setAttribute(
        "d",
        `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`
      );
      path.classList.add(
        `story-web__edge--${node.status || "hidden"}`
      );
      svg.appendChild(path);
    }
  }

  canvas.appendChild(svg);
  storyWeb.replaceChildren(canvas);
  syncStoryWebScale();

  for (const node of story.nodes) {
    const button = document.createElement("button");
    const type = document.createElement("span");
    const title = document.createElement("strong");
    const subtitle = document.createElement("small");
    const details = document.createElement("span");

    button.type = "button";
    button.className = `story-web__node is-${node.status || "hidden"}`;
    button.style.left = `${(Number(node.x) || 0) + STORY_WEB_PADDING}px`;
    button.style.top = `${(Number(node.y) || 0) + STORY_WEB_PADDING}px`;
    button.dataset.storyNodeId = node.id;
    button.setAttribute("aria-label", `${node.title}. ${node.subtitle}`);
    if (node.id === story.current_node_id) {
      button.classList.add("is-current-node");
    }
    if (node.id === expandedStoryNodeId) {
      button.classList.add("is-expanded");
      button.setAttribute("aria-expanded", "true");
    } else {
      button.setAttribute("aria-expanded", "false");
    }

    type.textContent = String(node.type || "node").toUpperCase();
    title.textContent = node.title;
    subtitle.textContent = node.subtitle;
    details.className = "story-web__node-details";
    details.textContent = node.description;
    button.append(type, title, subtitle, details);
    button.addEventListener("click", () => {
      const shouldExpand = expandedStoryNodeId !== node.id;

      expandedStoryNodeId = shouldExpand ? node.id : "";
      canvas.querySelectorAll(".story-web__node.is-expanded").forEach((item) => {
        item.classList.remove("is-expanded");
        item.setAttribute("aria-expanded", "false");
      });

      if (shouldExpand) {
        button.classList.add("is-expanded");
        button.setAttribute("aria-expanded", "true");
      }

      renderStoryInspector(node);
    });
    canvas.appendChild(button);
  }

  renderStoryInspector(
    getStoryNode(story, story.current_node_id) || story.nodes[0]
  );
}

function focusCurrentStoryNode() {
  if (!storyWebViewport || !currentStory) return;

  const node = getStoryNode(currentStory, currentStory.current_node_id);
  if (!node) return;

  storyWebZoom = Math.max(storyWebZoom, STORY_FOCUS_ZOOM);
  expandedStoryNodeId = node.id;
  renderStoryWeb(currentStory);

  requestAnimationFrame(() => {
    storyWebViewport.scrollTo({
      left: Math.max(
        0,
        (Number(node.x) + STORY_WEB_PADDING + 180) * storyWebZoom
          - storyWebViewport.clientWidth / 2
      ),
      top: Math.max(
        0,
        (Number(node.y) + STORY_WEB_PADDING + 88) * storyWebZoom
          - storyWebViewport.clientHeight / 2
      ),
      behavior: "smooth"
    });
  });
}

function fitEntireStoryWeb() {
  if (!storyWebViewport || !currentStory?.graph) return;

  const { stageWidth, stageHeight } = getStoryWebDimensions();
  const nextZoom = clampStoryWebZoom(
    Math.min(
      (storyWebViewport.clientWidth - 28) / stageWidth,
      (storyWebViewport.clientHeight - 28) / stageHeight
    )
  );

  storyWebZoom = nextZoom;
  syncStoryWebScale();
  requestAnimationFrame(() => {
    storyWebViewport.scrollTo({
      left: 0,
      top: 0,
      behavior: "smooth"
    });
  });
}

function renderStoryGuidance(story) {
  const guidance = story?.guidance;

  if (!guidance) {
    if (storyNextLabel) storyNextLabel.textContent = "Продолжайте разговор";
    return;
  }

  if (storyNextLabel) storyNextLabel.textContent = guidance.title;
  if (storyGuidanceStep) {
    storyGuidanceStep.textContent = guidance.status === "open_world"
      ? "СВОБОДНОЕ РАЗВИТИЕ"
      : `ШАГ ${guidance.step || 1} ИЗ ${guidance.total_steps || 4}`;
  }
  if (storyGuidanceTitle) storyGuidanceTitle.textContent = guidance.title;
  if (storyGuidanceObjective) {
    storyGuidanceObjective.textContent = guidance.objective;
  }
  if (storyGuidanceWhy) storyGuidanceWhy.textContent = guidance.why;
  if (storyGuidanceStatus) {
    storyGuidanceStatus.textContent = guidance.stalled
      ? "Разговор остановился. Теперь Мелисса должна сама предложить конкретное действие или потребовать решение."
      : guidance.completion_rule;
  }
  if (storyGuidanceSuggestions) {
    storyGuidanceSuggestions.replaceChildren();
    for (const suggestion of guidance.suggestions || []) {
      const item = document.createElement("li");
      item.textContent = suggestion;
      storyGuidanceSuggestions.appendChild(item);
    }
  }
  storyGuidance?.classList.toggle("is-stalled", Boolean(guidance.stalled));
}

function setModeControlsDisabled(disabled) {
  if (companionModeStoryBtn) companionModeStoryBtn.disabled = disabled;
  if (companionModePlainBtn) companionModePlainBtn.disabled = disabled;
}

function renderCompanionMode(story) {
  const storyEnabled = story?.story_mode?.enabled !== false;

  companionModeStoryBtn?.classList.toggle("is-selected", storyEnabled);
  companionModePlainBtn?.classList.toggle("is-selected", !storyEnabled);

  if (companionModeNote) {
    companionModeNote.textContent = story?.story_mode?.note || (
      storyEnabled
        ? "Характер развивается через прожитые решения и состояние вашей связи."
        : "Манеру общения определяет выбранный характер."
    );
  }

  if (personaPresetPanel) {
    personaPresetPanel.hidden = storyEnabled;
  }
}

function renderPersonaPresets(presets, selected) {
  if (!personaPresetList) return;

  selectedPersonaPreset = String(selected || "");
  personaPresetList.replaceChildren();

  for (const preset of presets || []) {
    const button = document.createElement("button");

    button.type = "button";
    button.textContent = preset.title;
    button.title = preset.description;
    button.dataset.presetId = preset.id;
    button.classList.toggle("is-selected", preset.id === selectedPersonaPreset);
    button.addEventListener("click", () => savePersonaPreset(preset.id));
    personaPresetList.appendChild(button);
  }
}

async function loadPersonaPresets() {
  if (!personaPresetList) return;

  try {
    const response = await fetch("/api/assistant/persona/presets", {
      headers: { "Accept": "application/json" }
    });
    const data = await response.json();

    if (!response.ok || !Array.isArray(data.presets)) {
      throw new Error(data.error || "Preset request failed");
    }

    renderPersonaPresets(data.presets, data.selected);
  } catch (error) {
    console.error("persona presets load error:", error);
    personaPresetList.textContent = "Не удалось загрузить характеры";
  }
}

async function savePersonaPreset(presetId) {
  if (!personaPresetList || presetId === selectedPersonaPreset) return;

  const buttons = personaPresetList.querySelectorAll("button");
  buttons.forEach((button) => { button.disabled = true; });

  try {
    const response = await fetch("/api/assistant/preset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preset_name: presetId })
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "Не удалось сохранить характер");
    }

    selectedPersonaPreset = presetId;
    buttons.forEach((button) => {
      button.classList.toggle("is-selected", button.dataset.presetId === presetId);
    });
    await loadPersona();
  } catch (error) {
    add("assistant", error instanceof Error ? error.message : "Не удалось сохранить характер");
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

async function setCompanionMode(enabled) {
  if (currentStory?.story_mode?.enabled === enabled) return;

  setModeControlsDisabled(true);

  try {
    const response = await fetch("/api/assistant/story/mode", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled })
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.story) {
      throw new Error(data.error || "Не удалось переключить режим");
    }

    renderStory(data.story);
    await Promise.all([loadPersona(), loadPersonaPresets()]);
  } catch (error) {
    add("assistant", error instanceof Error ? error.message : "Не удалось переключить режим");
  } finally {
    setModeControlsDisabled(false);
  }
}

function renderStory(story) {
  currentStory = story;
  const relationship = story?.relationship || {};
  const pathTitle = story?.path?.title || "Маршрут не определён";

  if (storyModeLabel) {
    storyModeLabel.textContent = story?.story_mode?.enabled
      ? "Живая история активна"
      : "Обычный режим активен";
  }
  if (storyPathLabel) storyPathLabel.textContent = pathTitle;
  if (storySummaryMode) {
    storySummaryMode.textContent =
      story?.story_mode?.label || "Живая история";
  }
  if (storySummaryPath) {
    storySummaryPath.textContent = `${pathTitle} · ${story?.path?.stance || "первый выбор впереди"}`;
  }
  if (storySummaryLink) {
    storySummaryLink.textContent =
      `Д ${relationship.trust || 0} · Б ${relationship.closeness || 0} · ` +
      `С ${relationship.autonomy || 0} · О ${relationship.caution || 0}`;
  }

  renderCompanionMode(story);
  renderStoryGuidance(story);
  renderStoryWeb(story);
}

async function loadStory() {
  try {
    const response = await fetch("/api/assistant/story", {
      headers: { "Accept": "application/json" }
    });
    const data = await response.json();

    if (!response.ok || !data.story) {
      throw new Error(data.error || "Story request failed");
    }

    renderStory(data.story);
    return data.story;
  } catch (error) {
    console.error("story load error:", error);
    if (storyPathLabel) storyPathLabel.textContent = "Не удалось загрузить";
    return null;
  }
}

async function openStoryModal() {
  if (!storyModal) return;
  storyModal.hidden = false;
  await loadStory();
  requestAnimationFrame(focusCurrentStoryNode);
}

function closeStoryModal() {
  if (!storyModal) return;
  storyModal.hidden = true;
}

function getMemoryItems(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.memory_items)) return data.memory_items;
  if (Array.isArray(data.memoryItems)) return data.memoryItems;
  return [];
}

function getMemoryItemText(item) {
  return item.content || item.text || item.value || item.fact || "";
}

function getMemoryItemId(item) {
  return item.id || item.memory_id || item.memoryItemId || item._id;
}

function getEntityText(entity, fields) {
  if (entity == null) return "";
  if (typeof entity === "string") return entity;

  return fields
    .map((field) => entity[field])
    .filter((value) => value != null && String(value).trim())
    .map((value) => String(value).trim())
    .join(" / ");
}

function renderEntityList(items, fields) {
  if (!Array.isArray(items) || !items.length) {
    return `<div class="memory-item">Пока пусто</div>`;
  }

  const renderedItems = items
    .map((item) => escapeHtml(getEntityText(item, fields)))
    .filter(Boolean);

  if (!renderedItems.length) {
    return `<div class="memory-item">Пока пусто</div>`;
  }

  return renderedItems
    .map((text) => `<div class="memory-item">${text}</div>`)
    .join("");
}

function renderMemoryItems(items) {
  if (!memoryItemsEl) return;

  if (!items.length) {
    memoryItemsEl.innerHTML = `<div class="memory-empty">Память пока пустая</div>`;
    return;
  }

  memoryItemsEl.innerHTML = items.map((item) => {
    const id = getMemoryItemId(item);
    const text = getMemoryItemText(item);
    const safeId = escapeHtml(id);
    const safeText = escapeHtml(text);

    return `
      <div class="memory-row" data-memory-id="${safeId}">
        <div class="memory-row-text">${safeText || "Без текста"}</div>
        <div class="memory-row-edit">
          <textarea rows="2">${safeText}</textarea>
          <div class="memory-actions">
            <button type="button" data-memory-action="save">Сохранить</button>
            <button type="button" data-memory-action="cancel">Отмена</button>
          </div>
        </div>
        <div class="memory-actions">
          <button type="button" data-memory-action="edit">Изм.</button>
          <button type="button" data-memory-action="delete">Удалить</button>
        </div>
      </div>
    `;
  }).join("");
}

async function loadMemoryItems() {
  if (!memoryItemsEl) return;

  memoryItemsEl.innerHTML = `<div class="memory-empty">Загрузка...</div>`;

  const r = await fetch("/api/assistant/memory-items");
  const d = await r.json();

  if (!r.ok) {
    memoryItemsEl.innerHTML = `<div class="memory-empty">Ошибка загрузки памяти</div>`;
    return;
  }

  renderMemoryItems(getMemoryItems(d));
}

async function saveAssistantName() {
  const newName = nameInput.value.trim();
  if (!newName) return;

  saveNameBtn.disabled = true;

  try {
    const r = await fetch("/api/assistant/name", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ name: newName })
    });
    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      add("assistant", "Не получилось сменить имя");
      return;
    }

    const savedName = String(data.name || newName).trim();
    nameEl.textContent = savedName;
    nameInput.value = savedName;
    await loadPersona();
    add("assistant", `Теперь меня зовут ${savedName}`);
  } finally {
    saveNameBtn.disabled = false;
  }
}


async function loadUser() {
  const r = await fetch("/api/me");
  const d = await r.json();

  if (!d.loggedIn) {
    window.location.href = "/login.html";
    return;
  }

  user_id = d.user.id;
}


// загрузка персонажа
async function loadPersona() {
  let d = {};

  try {
    const r = await fetch("/api/assistant/persona");
    if (!r.ok) throw new Error("Persona request failed");
    d = await r.json();
  } catch (error) {
    console.error("persona load error:", error);
    roleEl.textContent = "";

    return;
  }

  const assistantName = d.name || "Мелисса";

  nameEl.textContent = assistantName;
  roleEl.textContent = d.identity || "";

  if (nameInput) {
    nameInput.value = assistantName;
  }

}

// загрузка памяти
async function loadMemory() {
  const r = await fetch("/api/assistant/memory");
  const d = await r.json();

  if (!r.ok) {
    memoryEl.innerHTML = "<div>Ошибка загрузки памяти</div>";
    return;
  }

  const profile = d.profile || {};
  const interests = d.interests || [];
  const projects = d.projects || [];
  const entities = d.entities || {};

  memoryEl.innerHTML = `
    <div class="memory-group">
      <div class="memory-title">Профиль</div>
      <div class="memory-item"><strong>Имя:</strong> ${escapeHtml(profile.name || "—")}</div>
      <div class="memory-item"><strong>Город:</strong> ${escapeHtml(profile.city || "—")}</div>
      <div class="memory-item"><strong>Язык:</strong> ${escapeHtml(profile.language || "—")}</div>
    </div>

    <div class="memory-group">
      <div class="memory-title">Интересы</div>
      ${
        interests.length
          ? interests.map(x => `<div class="memory-tag">${escapeHtml(x)}</div>`).join("")
          : `<div class="memory-item">Пока пусто</div>`
      }
    </div>

    <div class="memory-group">
      <div class="memory-title">Проекты</div>
      ${
        projects.length
          ? projects.map(x => `<div class="memory-tag">${escapeHtml(x)}</div>`).join("")
          : `<div class="memory-item">Пока пусто</div>`
      }
    </div>

    <div class="memory-group">
      <div class="memory-title">Сущности</div>
      <div class="memory-title">Питомцы</div>
      ${renderEntityList(entities.pets, ["type", "name", "color"])}
      <div class="memory-title">Люди</div>
      ${renderEntityList(entities.people, ["name", "content"])}
      <div class="memory-title">Транспорт</div>
      ${renderEntityList(entities.vehicles, ["name", "content"])}
      <div class="memory-title">Прочее</div>
      ${renderEntityList(entities.other, ["text", "content", "name"])}
    </div>
  `;
}




let isOpen = false;

const toggle = document.getElementById("chat-toggle");
const widget = document.getElementById("chat-widget");

if (toggle && widget) {
  let isOpen = false;

  toggle.onclick = () => {
    if (!isOpen) {
      widget.classList.add("open");
      widget.classList.remove("closing");
      isOpen = true;
    } else {
      widget.classList.add("closing");

      setTimeout(() => {
        widget.classList.remove("open");
        isOpen = false;
      }, 200);
    }
  };
}

async function loadMessages() {
  const r = await fetch("/api/assistant/messages");
  const data = await r.json();

  if (!r.ok) {
    console.error("messages load error:", data);
    return;
  }

  messages.innerHTML = "";

  session_id = data.session_id || 0;
  sessionEl.textContent = String(session_id);

  for (const m of data.messages || []) {
    add(m.role, m.content);
  }

  messages.scrollTop = messages.scrollHeight;
}

const newChatBtn = document.getElementById("new-chat-btn");


if (newChatBtn) {
  newChatBtn.onclick = () => {
    session_id = 0;
    sessionEl.textContent = "0";
    messages.innerHTML = "";
    add("assistant", "Начнём новый разговор ✨");
  };
}

// отправка сообщения
async function send(msg) {

  // 🔥 ВОТ СЮДА
  if (!user_id) {
    add("assistant", "Ошибка: пользователь не найден");
    return;
  }

  add("user", msg);
  showTyping();

  const r = await fetch("/api/assistant/chat", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      user_id,
      message: msg,
      session_id
    })
  });

  const d = await r.json();

  if (!r.ok) {
    hideTyping();
    add("assistant", "Ошибка");
    return;
  }

  session_id = d.session_id;
  sessionEl.textContent = session_id;

  hideTyping();
  typeText(d.answer);

  loadMemory();
  loadMemoryItems();
  if (d.story) {
    renderStory(d.story);
  } else if (d.story_updated || d.story_momentum_updated) {
    loadStory();
  }
}

// форма
form.onsubmit = async (e) => {
  e.preventDefault();

  const msg = input.value.trim();
  if (!msg) return;

  input.value = "";
  send(msg);
};

if (saveNameBtn) {
  saveNameBtn.onclick = saveAssistantName;
}

function openMemoryModal() {
  if (!memoryModal) return;
  memoryModal.hidden = false;
  memoryToggle?.setAttribute("aria-expanded", "true");
  memoryInput?.focus();
}

function closeMemoryModal() {
  if (!memoryModal) return;
  memoryModal.hidden = true;
  memoryToggle?.setAttribute("aria-expanded", "false");
}

if (memoryToggle) {
  memoryToggle.setAttribute("aria-expanded", "false");
  memoryToggle.onclick = openMemoryModal;
}

if (memoryModalClose) {
  memoryModalClose.onclick = closeMemoryModal;
}

if (memoryModal) {
  memoryModal.addEventListener("click", (e) => {
    if (e.target.closest("[data-memory-close]")) {
      closeMemoryModal();
    }
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && memoryModal && !memoryModal.hidden) {
    closeMemoryModal();
  }
  if (e.key === "Escape" && storyModal && !storyModal.hidden) {
    closeStoryModal();
  }
});

if (storyOpenBtn) {
  storyOpenBtn.onclick = openStoryModal;
}

if (storyModalClose) {
  storyModalClose.onclick = closeStoryModal;
}

if (storyModal) {
  storyModal.addEventListener("click", (event) => {
    if (event.target.closest("[data-story-close]")) {
      closeStoryModal();
    }
  });
}

if (storyFocusBtn) {
  storyFocusBtn.onclick = focusCurrentStoryNode;
}

if (storyFitBtn) {
  storyFitBtn.onclick = fitEntireStoryWeb;
}

if (storyZoomOutBtn) {
  storyZoomOutBtn.onclick = () => setStoryWebZoom(storyWebZoom - 0.1);
}

if (storyZoomInBtn) {
  storyZoomInBtn.onclick = () => setStoryWebZoom(storyWebZoom + 0.1);
}

if (companionModeStoryBtn) {
  companionModeStoryBtn.onclick = () => setCompanionMode(true);
}

if (companionModePlainBtn) {
  companionModePlainBtn.onclick = () => setCompanionMode(false);
}

if (storyWebViewport) {
  storyWebViewport.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const direction = event.deltaY < 0 ? 1 : -1;
      setStoryWebZoom(
        storyWebZoom + direction * 0.08,
        event.clientX,
        event.clientY
      );
    },
    { passive: false }
  );

  storyWebViewport.addEventListener("pointerdown", (event) => {
    const target = event.target instanceof Element ? event.target : null;

    if (event.button !== 0 || target?.closest(".story-web__node")) {
      return;
    }

    event.preventDefault();

    storyPanState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: storyWebViewport.scrollLeft,
      scrollTop: storyWebViewport.scrollTop
    };
    try {
      storyWebViewport.setPointerCapture(event.pointerId);
    } catch (error) {
      console.debug("Pointer capture unavailable; using window drag events", error);
    }
    storyWebViewport.classList.add("is-panning");
  });

  const moveStoryPan = (event) => {
    if (!storyPanState || storyPanState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();

    storyWebViewport.scrollLeft =
      storyPanState.scrollLeft - (event.clientX - storyPanState.startX);
    storyWebViewport.scrollTop =
      storyPanState.scrollTop - (event.clientY - storyPanState.startY);
  };

  const finishStoryPan = (event) => {
    if (!storyPanState || storyPanState.pointerId !== event.pointerId) {
      return;
    }

    try {
      if (storyWebViewport.hasPointerCapture(event.pointerId)) {
        storyWebViewport.releasePointerCapture(event.pointerId);
      }
    } catch (error) {
      console.debug("Pointer capture already released", error);
    }

    storyPanState = null;
    storyWebViewport.classList.remove("is-panning");
  };

  window.addEventListener("pointermove", moveStoryPan, { passive: false });
  window.addEventListener("pointerup", finishStoryPan);
  window.addEventListener("pointercancel", finishStoryPan);
}

if (memoryClearBtn) {
  memoryClearBtn.onclick = async () => {
    const confirmed = confirm(
      "Удалить все сохранённые факты о вас? Диалоги и Хроника связи останутся без изменений."
    );
    if (!confirmed) return;

    memoryClearBtn.disabled = true;
    try {
      const r = await fetch("/api/assistant/memory/clear", {
        method: "POST"
      });

      if (!r.ok) {
        add("assistant", "Не получилось очистить память");
        return;
      }

      await loadMemoryItems();
      await loadMemory();
    } finally {
      memoryClearBtn.disabled = false;
    }
  };
}

function closeResetConfirmation() {
  if (!resetConfirmation) return;
  resetConfirmation.hidden = true;
  if (resetConfirmCheckbox) resetConfirmCheckbox.checked = false;
  if (resetConfirmBtn) resetConfirmBtn.disabled = true;
}

if (assistantResetBtn) {
  assistantResetBtn.onclick = () => {
    if (!resetConfirmation) return;
    resetConfirmation.hidden = false;
    resetConfirmation.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
}

if (resetCancelBtn) {
  resetCancelBtn.onclick = closeResetConfirmation;
}

if (resetConfirmCheckbox && resetConfirmBtn) {
  resetConfirmCheckbox.onchange = () => {
    resetConfirmBtn.disabled = !resetConfirmCheckbox.checked;
  };
}

if (resetConfirmBtn) {
  resetConfirmBtn.onclick = async () => {
    if (!resetConfirmCheckbox?.checked) return;

    resetConfirmBtn.disabled = true;
    if (assistantResetBtn) assistantResetBtn.disabled = true;

    try {
      const response = await fetch("/api/assistant/reset", {
        method: "POST"
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.story) {
        throw new Error(data.error || "Не удалось начать заново");
      }

      session_id = 0;
      sessionEl.textContent = "0";
      messages.replaceChildren();
      renderStory(data.story);
      closeResetConfirmation();
      await Promise.all([
        loadMemory(),
        loadMemoryItems(),
        loadPersona(),
        loadPersonaPresets()
      ]);
      add("assistant", "Начинаем заново. Я слышу тебя — остальное пока белый шум.");
    } catch (error) {
      add("assistant", error instanceof Error ? error.message : "Не удалось начать заново");
      resetConfirmBtn.disabled = false;
    } finally {
      if (assistantResetBtn) assistantResetBtn.disabled = false;
    }
  };
}

if (memoryForm) {
  memoryForm.onsubmit = async (e) => {
    e.preventDefault();

    const text = memoryInput.value.trim();
    if (!text) return;

    const button = memoryForm.querySelector("button");
    button.disabled = true;

    try {
      const r = await fetch("/api/assistant/memory-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text, text })
      });

      if (!r.ok) {
        add("assistant", "Не получилось добавить память");
        return;
      }

      memoryInput.value = "";
      await loadMemoryItems();
      await loadMemory();
    } finally {
      button.disabled = false;
    }
  };
}

if (memoryItemsEl) {
  memoryItemsEl.onclick = async (e) => {
    const button = e.target.closest("button[data-memory-action]");
    if (!button) return;

    const row = button.closest(".memory-row");
    if (!row) return;

    const id = row.getAttribute("data-memory-id");
    const action = button.getAttribute("data-memory-action");
    const textarea = row.querySelector("textarea");

    if (action === "edit") {
      row.classList.add("editing");
      textarea.focus();
      return;
    }

    if (action === "cancel") {
      row.classList.remove("editing");
      return;
    }

    if (action === "save") {
      const text = textarea.value.trim();
      if (!text) return;

      button.disabled = true;
      try {
        const r = await fetch(`/api/assistant/memory-items/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text, text })
        });

        if (!r.ok) {
          add("assistant", "Не получилось обновить память");
          return;
        }

        await loadMemoryItems();
        await loadMemory();
      } finally {
        button.disabled = false;
      }
      return;
    }

    if (action === "delete") {
      button.disabled = true;
      try {
        const r = await fetch(`/api/assistant/memory-items/${encodeURIComponent(id)}`, {
          method: "DELETE"
        });

        if (!r.ok) {
          add("assistant", "Не получилось удалить память");
          return;
        }

        await loadMemoryItems();
        await loadMemory();
      } finally {
        button.disabled = false;
      }
    }
  };
}

// старт
(async function init() {
  try {
    await loadUser();
    await loadPersona();
    await loadPersonaPresets();
    await loadMemory();
    await loadMemoryItems();
    await loadMessages();
    await loadStory();
  } catch (e) {
    console.error("init error:", e);
  }
})();
