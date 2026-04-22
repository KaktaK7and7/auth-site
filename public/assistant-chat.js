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


// загрузка персонажа
async function loadPersona() {
  const r = await fetch("/api/assistant/persona");
  const d = await r.json();

  nameEl.textContent = d.name || "Мелисса";
  roleEl.textContent = d.identity || "";
}

// загрузка памяти
async function loadMemory() {
  const r = await fetch("/api/assistant/memory");
  const d = await r.json();

  memoryEl.textContent = JSON.stringify(d, null, 2);
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

    await fetch("/api/assistant/preset", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ preset_name: preset })
    });

    // сначала очищаем
    session_id = 0;
    sessionEl.textContent = "0";
    messages.innerHTML = "";

    // потом генерим текст
    let text = "Я изменилась 😉";

    if (preset === "cute") text = "Теперь я буду заботиться о тебе 💖";
    if (preset === "spicy") text = "Оу... теперь будет жарко 😏";
    if (preset === "friend") text = "Ну всё, теперь я твоя подруга 😄";
    if (preset === "shy_love") text = "Эм... я... теперь немного другая... 👉👈";
    if (preset === "aggressive") text = "Ну всё, готовься 😈";
    if (preset === "calm") text = "Хорошо, давай спокойно пообщаемся.";

    // теперь показываем
    add("assistant", text);

    loadPersona();
  };
});

// старт
loadPersona();
loadMemory();
loadMessages();