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


function extractFirstNavigation(html) {
  const match = html.match(/<nav[^>]*data-nav-links[^>]*>([\s\S]*?)<\/nav>/i);
  return match ? match[1] : "";
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


test("Ziren 1.0 global navigation stays compact and moves account actions out of the primary row", () => {
  const home = readPublicFile("index.html");
  const navigation = extractFirstNavigation(home);

  assert.match(home, /href="\/nav-v1\.css"/);
  assert.match(home, /class="site-account-menu"/);
  assert.match(home, /href="\/profile"/);
  assert.match(home, /href="\/friends\.html"/);
  assert.match(home, /href="\/messages\.html"/);
  assert.match(home, /Мой тариф/);

  const primaryLinks = navigation.match(/<a\b/gi) || [];
  assert.ok(primaryLinks.length <= 6, `primary navigation has ${primaryLinks.length} links`);
  assert.doesNotMatch(navigation, /href="\/friends\.html"/);
  assert.doesNotMatch(navigation, /href="\/messages\.html"/);
});


test("assistant page reflects Ziren 1.0 routing, Melissa v2 and Chronicle redesign", () => {
  const assistant = readPublicFile("assistant.html");
  const navigation = extractFirstNavigation(assistant);

  assert.match(assistant, /Змея выполняет\. Мелисса понимает/);
  assert.match(assistant, /FREE · LOCAL/);
  assert.match(assistant, /SMART · AI/);
  assert.match(assistant, /structured actions/);
  assert.match(assistant, /data-assistant-chat-label/);
  assert.match(assistant, /id="companion"/);
  assert.match(assistant, /Melissa v2/);
  assert.match(assistant, /Chibi overlay/);
  assert.match(assistant, /id="chronicle"/);
  assert.match(assistant, /Chronicle v1/);
  assert.match(assistant, /Память ≠ Хроника/);
  assert.match(assistant, /id="vision"/);
  assert.match(assistant, /Анализ не равен праву нажимать/);
  assert.match(assistant, /Перевести видимый текст/);

  assert.doesNotMatch(navigation, /href="#vision"/);
  assert.doesNotMatch(assistant, /выделять нужные элементы\s+рамками/i);
  assert.doesNotMatch(assistant, /Сохранить в Холст/i);
});


test("contacts page does not expose the owner's personal GitHub profile", () => {
  const contacts = readPublicFile("contacts.html");

  assert.doesNotMatch(contacts, /github\.com\/KaktaK7and7/i);
  assert.doesNotMatch(contacts, />GitHub</i);
  assert.match(contacts, /ziren\.store@gmail\.com/);
});
