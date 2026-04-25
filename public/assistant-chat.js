let session_id = 0;
let typingEl = null;
let user_id = null;

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

const nameEl = document.getElementById("name");
const roleEl = document.getElementById("role");

const nameInput = document.getElementById("assistant-name-input");
const saveNameBtn = document.getElementById("save-name-btn");

// вывод сообщения
function add(role, text) {
  const el = document.createElement("div");
  el.className = "msg " + role;

  const time = new Date().toLocaleTimeString();

  el.innerHTML = `
    <div>${text}</div>
    <div style="font-size:10px;opacity:0.5;margin-top:4px">${time}</div>
  `;

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
  let i = 0;
  const el = document.createElement("div");
  el.className = "msg assistant";
  messages.appendChild(el);

  const interval = setInterval(() => {
    el.textContent += text[i];
    i++;
    messages.scrollTop = messages.scrollHeight;

    if (i >= text.length) {
      clearInterval(interval);
    }
  }, 10);
}

function setActivePreset(presetName) {
  document.querySelectorAll(".presets button").forEach(btn => {
    btn.classList.remove("active-preset");
    if (btn.getAttribute("data") === presetName) {
      btn.classList.add("active-preset");
    }
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
    add("assistant", `Теперь меня зовут ${escapeHtml(savedName)}`);
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

  setActivePreset(d.preset_name);
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
    add("assistant", "Ошибка");
    return;
  }

  session_id = d.session_id;
  sessionEl.textContent = session_id;

  typeText(d.answer);
  hideTyping();

  loadMemory();
  loadMemoryItems();
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
});

if (memoryClearBtn) {
  memoryClearBtn.onclick = async () => {
    const confirmed = confirm("Вы уверены? Это удалит всю память ассистента о вас.");
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

// пресеты
document.querySelectorAll(".presets button").forEach(btn => {
  btn.onclick = async () => {
    const preset = btn.getAttribute("data");

    const res = await fetch("/api/assistant/preset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preset_name: preset })
    });

    if (!res.ok) {
      add("assistant", "Не получилось сменить характер 😔");
      return;
    }

    let text = "Я изменилась 😉";

    if (preset === "cute") text = "Теперь я буду заботиться о тебе 💖";
    if (preset === "spicy") text = "Оу... теперь будет жарко 😏";
    if (preset === "friend") text = "Ну всё, теперь я твоя подруга 😄";
    if (preset === "shy_love") text = "Эм... я... теперь немного другая... 👉👈";
    if (preset === "aggressive") text = "Ну всё, готовься 😈";
    if (preset === "calm") text = "Хорошо, давай спокойно пообщаемся.";

    add("assistant", text);
    await loadPersona();
  };
});

// старт
(async function init() {
  try {
    await loadUser();      // ← ДОБАВИЛИ
    await loadPersona();
    await loadMemory();
    await loadMemoryItems();
    await loadMessages();
  } catch (e) {
    console.error("init error:", e);
  }
})();
