const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const publicDir = path.join(__dirname, "..", "public");


test("pricing browser script is valid JavaScript", () => {
  const source = fs.readFileSync(path.join(publicDir, "pricing.js"), "utf8");
  assert.doesNotThrow(() => new Function(source));
});


test("pricing page clearly describes beta and no automatic overage", () => {
  const html = fs.readFileSync(path.join(publicDir, "pricing.html"), "utf8");
  assert.match(html, /SUBSCRIPTIONS · BETA/i);
  assert.match(html, /списаний сейчас нет/i);
  assert.match(html, /Автоматического списания сверх тарифа нет/i);
  assert.match(html, /отдельные credits/i);
  assert.match(html, /автопродлен/i);
});


test("terms keep checkout disabled during beta", () => {
  const html = fs.readFileSync(path.join(publicDir, "terms.html"), "utf8");
  assert.match(html, /платёжный\s+checkout\s+не\s+активен/i);
  assert.match(html, /реальные списания.+не производятся/is);
});
