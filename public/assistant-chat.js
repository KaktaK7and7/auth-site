let session_id = 0;
let typingEl = null;

const messages = document.getElementById("messages");
const form = document.getElementById("form");
const input = document.getElementById("input");
const sessionEl = document.getElementById("session");
const memoryEl = document.getElementById("memory");

const nameEl = document.getElementById("name");
const roleEl = document.getElementById("role");

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

function showTyping() {
  typingEl = document.createElement("div");
  typingEl.className = "msg assistant";
  typingEl.textContent = "Мелисса печатает...";
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


// загрузка персонажа
async function loadPersona() {
  const r = await fetch("/api/assistant/persona");
  const d = await r.json();

  nameEl.textContent = d.name || "Мелисса";
  roleEl.textContent = d.identity || "";
  setActivePreset(data.preset_name);
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
      <div class="memory-item"><strong>Имя:</strong> ${profile.name || "—"}</div>
      <div class="memory-item"><strong>Город:</strong> ${profile.city || "—"}</div>
      <div class="memory-item"><strong>Язык:</strong> ${profile.language || "—"}</div>
    </div>

    <div class="memory-group">
      <div class="memory-title">Интересы</div>
      ${
        interests.length
          ? interests.map(x => `<div class="memory-tag">${x}</div>`).join("")
          : `<div class="memory-item">Пока пусто</div>`
      }
    </div>

    <div class="memory-group">
      <div class="memory-title">Проекты</div>
      ${
        projects.length
          ? projects.map(x => `<div class="memory-tag">${x}</div>`).join("")
          : `<div class="memory-item">Пока пусто</div>`
      }
    </div>

    <div class="memory-group">
      <div class="memory-title">Сущности</div>
      <div class="memory-item"><strong>Питомцы:</strong> ${(entities.pets || []).length}</div>
      <div class="memory-item"><strong>Люди:</strong> ${(entities.people || []).length}</div>
      <div class="memory-item"><strong>Транспорт:</strong> ${(entities.vehicles || []).length}</div>
      <div class="memory-item"><strong>Прочее:</strong> ${(entities.other || []).length}</div>
    </div>
  `;
}

async function loadMessages() {
  const r = await fetch("/api/assistant/messages");
  const data = await r.json();

  if (!r.ok) return;

  messages.innerHTML = "";

  data.messages.forEach(m => {
    add(m.role, m.content);
  });

  session_id = data.session_id || 0;
  sessionEl.textContent = session_id;
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



// отправка сообщения
async function send(msg) {
  add("user", msg);
  showTyping();

  const r = await fetch("/api/assistant/chat", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
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
}

// форма
form.onsubmit = async (e) => {
  e.preventDefault();

  const msg = input.value.trim();
  if (!msg) return;

  input.value = "";
  send(msg);
};

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
loadPersona();
loadMemory();
loadMessages();