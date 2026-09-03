const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");


const pages = ["index.html", "assistant.html", "features.html", "pricing.html"];

function readPage(name) {
  return fs.readFileSync(path.join(__dirname, "..", "public", name), "utf8");
}

function primaryNav(html) {
  const match = html.match(/<nav class="site-nav__links"[\s\S]*?<\/nav>/);
  assert.ok(match, "primary navigation must exist");
  return match[0];
}


test("all core product pages use the compact navigation stylesheet", () => {
  for (const page of pages) {
    const html = readPage(page);
    assert.match(html, /href="\/nav-v1\.css"/, `${page} must include nav-v1.css`);
  }
});


test("primary navigation never contains Friends or Messages", () => {
  for (const page of pages) {
    const nav = primaryNav(readPage(page));
    assert.doesNotMatch(nav, /href="\/friends\.html"/, `${page} exposes Friends in primary nav`);
    assert.doesNotMatch(nav, /href="\/messages\.html"/, `${page} exposes Messages in primary nav`);
  }
});


test("primary navigation stays bounded to six links", () => {
  for (const page of pages) {
    const nav = primaryNav(readPage(page));
    const links = nav.match(/<a\s/g) || [];
    assert.ok(links.length <= 6, `${page} has ${links.length} primary links`);
  }
});


test("authenticated account menu keeps social destinations available", () => {
  for (const page of pages) {
    const html = readPage(page);
    assert.match(html, /class="site-account-menu"/, `${page} has no account menu`);
    assert.match(html, /href="\/friends\.html"/, `${page} has no Friends account link`);
    assert.match(html, /href="\/messages\.html"/, `${page} has no Messages account link`);
  }
});
