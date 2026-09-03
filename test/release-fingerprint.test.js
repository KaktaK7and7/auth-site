const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildReleaseInfo,
  writeReleaseInfo,
} = require("../scripts/write-release-info");
const {
  assertReleaseInfo,
  normalizeCommit,
} = require("../scripts/staging-smoke");

test("release fingerprint exposes only bounded deployment metadata", () => {
  const info = buildReleaseInfo({
    RAILWAY_GIT_COMMIT_SHA: "a".repeat(40),
    RAILWAY_ENVIRONMENT_NAME: "staging",
    DATABASE_URL: "postgres://secret",
    AI_INTERNAL_TOKEN: "do-not-leak",
  });

  assert.equal(info.schema_version, 1);
  assert.equal(info.service, "ziren-auth-site");
  assert.equal(info.commit, "a".repeat(40));
  assert.equal(info.environment, "staging");
  assert.equal(Object.hasOwn(info, "DATABASE_URL"), false);
  assert.equal(Object.hasOwn(info, "AI_INTERNAL_TOKEN"), false);
  assert.equal(JSON.stringify(info).includes("do-not-leak"), false);
});

test("release fingerprint can be written as valid JSON", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ziren-release-"));
  const target = path.join(root, "release.json");
  try {
    const info = writeReleaseInfo(target);
    const parsed = JSON.parse(fs.readFileSync(target, "utf8"));
    assert.equal(parsed.schema_version, 1);
    assert.equal(parsed.service, info.service);
    assert.equal(parsed.version, info.version);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("staging release contract detects stale commit", () => {
  const body = {
    schema_version: 1,
    service: "ziren-auth-site",
    version: "1.0.0",
    commit: "abcdef1234567890",
    environment: "staging",
  };

  assert.doesNotThrow(() => assertReleaseInfo(body, "abcdef1"));
  assert.throws(() => assertReleaseInfo(body, "1234567"), /Stale deployment/);
  assert.equal(normalizeCommit("ABCDEF1"), "abcdef1");
});
