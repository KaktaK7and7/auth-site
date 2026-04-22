let session_id = 0;

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
  el.textContent = text;
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
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

// отправка сообщения
async function send(msg) {
  add("user", msg);

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

  add("assistant", d.answer);

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

    session_id = 0;
    sessionEl.textContent = "0";
    messages.innerHTML = "";

    loadPersona();
  };
});

// старт
loadPersona();
loadMemory();