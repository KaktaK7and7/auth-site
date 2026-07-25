const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_CORS_ORIGINS,
  extractBearerToken,
  hashDesktopToken,
  parseAllowedOrigins,
} = require("../lib/security");


test("extractBearerToken accepts one bearer token", () => {
  assert.equal(extractBearerToken("Bearer desktop-secret"), "desktop-secret");
  assert.equal(extractBearerToken("bearer lower-case"), "lower-case");
});


test("extractBearerToken rejects malformed authorization values", () => {
  assert.equal(extractBearerToken("desktop-secret"), "");
  assert.equal(extractBearerToken("Bearer one two"), "");
  assert.equal(extractBearerToken(""), "");
});


test("hashDesktopToken is deterministic and does not expose the source token", () => {
  const tokenHash = hashDesktopToken("desktop-secret");

  assert.equal(tokenHash, hashDesktopToken("desktop-secret"));
  assert.notEqual(tokenHash, "desktop-secret");
  assert.equal(tokenHash.length, 64);
});


test("parseAllowedOrigins uses safe defaults and supports explicit overrides", () => {
  assert.deepEqual(
    [...parseAllowedOrigins("")],
    DEFAULT_CORS_ORIGINS,
  );
  assert.deepEqual(
    [...parseAllowedOrigins("https://one.example, https://two.example")],
    ["https://one.example", "https://two.example"],
  );
});


test("development origins match the Tauri and Vite loopback hosts", () => {
  const defaultOrigins = parseAllowedOrigins("");

  assert.equal(defaultOrigins.has("http://localhost:1420"), true);
  assert.equal(defaultOrigins.has("http://127.0.0.1:1420"), true);
  assert.equal(defaultOrigins.has("http://localhost:5173"), true);
  assert.equal(defaultOrigins.has("http://127.0.0.1:5173"), true);
});
