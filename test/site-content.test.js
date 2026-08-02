const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");


function readPublicFile(fileName) {
  return fs.readFileSync(
    path.join(__dirname, "..", "public", fileName),
    "utf8",
  );
}


test("home page presents Ziren as a company without assistant mascot content", () => {
  const home = readPublicFile("index.html");

  assert.match(home, /class="company-hero"/);
  assert.match(home, /id="directions"/);
  assert.match(home, /data-community-ticker/);
  assert.match(home, /href="\/register\.html"/);
  assert.match(home, /Одна среда для комьюнити и разработки/);
  assert.match(home, /Предложить идею или оставить отзыв/);
  assert.doesNotMatch(home, /Мелисс/i);
  assert.doesNotMatch(home, /melissa-/i);
});


test("assistant page owns Melissa details and personalized chat entry points", () => {
  const assistant = readPublicFile("assistant.html");

  assert.match(assistant, /id="companion"/);
  assert.match(assistant, /Характер не выбирается кнопкой/);
  assert.match(assistant, /Живой сюжет включён по умолчанию/);
  assert.match(assistant, /Команды и общение — разная логика/);
  assert.match(assistant, /class="assistant-logic__modes"/);
  assert.match(assistant, /data-assistant-chat-label/);
  assert.match(assistant, /Что мы дорабатываем/);
  assert.match(assistant, /id="chronicle"/);
  assert.match(assistant, /Хроника связи/);
  assert.match(assistant, /2045 года/);
  assert.match(assistant, /Ветки не[\s\S]*сходятся обратно/);
  assert.match(assistant, /Доверие, близость, самостоятельность/);
  assert.match(assistant, /id="vision"/);
  assert.match(assistant, /Перевести видимый текст/);
  assert.match(assistant, /Разобрать ошибку или интерфейс/);
  assert.match(assistant, /Это не постоянное наблюдение/);
  assert.match(assistant, /не добавляется в память компаньона/);
});


test("contacts page does not expose the owner's personal GitHub profile", () => {
  const contacts = readPublicFile("contacts.html");

  assert.doesNotMatch(contacts, /github\.com\/KaktaK7and7/i);
  assert.doesNotMatch(contacts, />GitHub</i);
  assert.match(contacts, /ziren\.store@gmail\.com/);
});
