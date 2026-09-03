const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const {
  normalizeBaseUrl,
  runStagingSmoke,
  semanticCapabilitiesFromManifest,
} = require("../scripts/staging-smoke");

function testManifest() {
  const features = Array.from({ length: 10 }, (_, index) => ({
    feature_id: index === 0 ? "system.volume" : `system.test_public_${index}`,
    title: index === 0 ? "Volume" : `Feature ${index}`,
    plan: "free",
    status: "testing",
    snake: true,
    melissa: true,
    actions: [
      {
        id: index === 0 ? "volume.set" : `feature.${index}.run`,
        title: index === 0 ? "Set volume" : `Run ${index}`,
        example: index === 0 ? "поставь громкость" : `command ${index}`,
        snake: true,
        melissa: true,
      },
    ],
  }));

  return {
    schema_version: 1,
    generated_from: "ziren-assistant-v2:ModuleRegistry",
    modes: {},
    features,
  };
}

function testReleaseInfo() {
  return {
    schema_version: 1,
    service: "ziren-auth-site",
    commit: "abcdef1234567890",
    environment: "test",
  };
}

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    return await callback(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function silentLogger() {
  return { log() {}, error() {} };
}


test("staging smoke validates public catalog/manifest without credentials or AI usage", async () => {
  let semanticCalls = 0;
  const manifest = testManifest();

  const report = await withServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/release.json") {
      res.end(JSON.stringify(testReleaseInfo()));
      return;
    }
    if (req.url === "/api/subscriptions/catalog") {
      res.end(JSON.stringify({
        ok: true,
        plans: [{ id: "free" }, { id: "plus" }, { id: "pro" }],
      }));
      return;
    }
    if (req.url === "/assistant-capabilities.json") {
      res.end(JSON.stringify(manifest));
      return;
    }
    if (req.url === "/api/assistant/command-route") semanticCalls += 1;
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false }));
  }, (baseUrl) => runStagingSmoke({
    baseUrl,
    logger: silentLogger(),
  }));

  assert.equal(report.ok, true);
  assert.equal(semanticCalls, 0);
  assert.deepEqual(
    report.results.map((item) => item.status),
    ["pass", "pass", "pass", "skip"],
  );
});


test("authenticated semantic smoke sends a bounded classifier request but no local action", async () => {
  const manifest = testManifest();
  let receivedSemanticBody = null;

  const report = await withServer((req, res) => {
    res.setHeader("Content-Type", "application/json");

    if (req.url === "/release.json") {
      res.end(JSON.stringify(testReleaseInfo()));
      return;
    }
    if (req.url === "/api/subscriptions/catalog") {
      res.end(JSON.stringify({
        ok: true,
        plans: [{ id: "free" }, { id: "plus" }, { id: "pro" }],
      }));
      return;
    }
    if (req.url === "/assistant-capabilities.json") {
      res.end(JSON.stringify(manifest));
      return;
    }
    if (req.url === "/api/subscriptions/me") {
      assert.equal(req.headers.authorization, "Bearer test-token");
      res.end(JSON.stringify({ ok: true, subscription: { plan: "plus" } }));
      return;
    }
    if (req.url === "/api/assistant/command-route" && req.method === "POST") {
      assert.equal(req.headers.authorization, "Bearer test-token");
      let raw = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => {
        receivedSemanticBody = JSON.parse(raw);
        res.end(JSON.stringify({
          ok: true,
          matched: true,
          command_like: true,
          feature_id: "system.volume",
          action_id: "volume.set",
          arguments: { percent: 37 },
          confidence: 0.97,
        }));
      });
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false }));
  }, (baseUrl) => runStagingSmoke({
    baseUrl,
    token: "test-token",
    semantic: true,
    logger: silentLogger(),
  }));

  assert.equal(report.ok, true);
  assert.ok(receivedSemanticBody);
  assert.equal(receivedSemanticBody.message, "поставь громкость на 37 процентов");
  const volume = receivedSemanticBody.capabilities.find(
    (feature) => feature.feature_id === "system.volume",
  );
  assert.ok(volume);
  assert.deepEqual(volume.actions.map((action) => action.action_id), ["volume.set"]);
});


test("semantic capability projection publishes Melissa actions only", () => {
  const manifest = testManifest();
  manifest.features[0].actions.push({
    id: "volume.snake_only",
    title: "Snake only",
    example: "локально",
    snake: true,
    melissa: false,
  });

  const capabilities = semanticCapabilitiesFromManifest(manifest);
  const volume = capabilities.find((feature) => feature.feature_id === "system.volume");

  assert.ok(volume);
  assert.deepEqual(volume.actions.map((action) => action.action_id), ["volume.set"]);
});


test("staging smoke accepts only http and https base URLs", () => {
  assert.equal(normalizeBaseUrl("https://example.test/"), "https://example.test");
  assert.equal(normalizeBaseUrl("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
  assert.throws(() => normalizeBaseUrl("file:///tmp/site"), /http\/https/);
});
