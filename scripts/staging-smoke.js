const { argv, env, exit } = require("node:process");

const DEFAULT_BASE_URL = "https://auth-site-p0-security-test.up.railway.app";
const REQUEST_TIMEOUT_MS = 12_000;

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) throw new Error("Base URL is required");
  const parsed = new URL(raw);
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error("Only http/https staging URLs are allowed");
  }
  return parsed.toString().replace(/\/$/, "");
}

function normalizeCommit(value) {
  const commit = String(value || "").trim().toLowerCase();
  if (!commit) return "";
  if (!/^[0-9a-f]{7,64}$/.test(commit)) {
    throw new Error("Expected commit must be a hexadecimal git SHA/prefix");
  }
  return commit;
}

function parseArgs(values) {
  const result = {
    baseUrl: env.ZIREN_STAGING_URL || DEFAULT_BASE_URL,
    token: env.ZIREN_DESKTOP_TOKEN || "",
    expectedCommit: env.ZIREN_EXPECTED_STAGING_COMMIT || "",
    semantic: false,
  };

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--base-url") {
      result.baseUrl = values[index + 1] || "";
      index += 1;
    } else if (value === "--token") {
      result.token = values[index + 1] || "";
      index += 1;
    } else if (value === "--expected-commit") {
      result.expectedCommit = values[index + 1] || "";
      index += 1;
    } else if (value === "--semantic") {
      result.semantic = true;
    } else if (value === "--help" || value === "-h") {
      result.help = true;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  result.baseUrl = normalizeBaseUrl(result.baseUrl);
  result.token = String(result.token || "").trim();
  result.expectedCommit = normalizeCommit(result.expectedCommit);
  return result;
}

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function requestJson(baseUrl, path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    return { response, body };
  } finally {
    clearTimeout(timeout);
  }
}

function assertReleaseInfo(body, expectedCommit = "") {
  if (!body || typeof body !== "object") {
    throw new Error("Release fingerprint is not a JSON object");
  }
  if (body.schema_version !== 1 || body.service !== "ziren-auth-site") {
    throw new Error("Unexpected release fingerprint contract");
  }
  const deployedCommit = String(body.commit || "").trim().toLowerCase();
  if (expectedCommit) {
    if (!deployedCommit) {
      throw new Error(`Deployment does not expose a commit; expected ${expectedCommit}`);
    }
    if (!deployedCommit.startsWith(expectedCommit) && !expectedCommit.startsWith(deployedCommit)) {
      throw new Error(`Stale deployment: expected ${expectedCommit}, got ${deployedCommit}`);
    }
  }
  return body;
}

function assertManifest(manifest) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Capability manifest is not JSON object");
  }
  if (manifest.schema_version !== 1) {
    throw new Error(`Unexpected capability schema: ${manifest.schema_version}`);
  }
  if (manifest.generated_from !== "ziren-assistant-v2:ModuleRegistry") {
    throw new Error(`Unexpected capability source: ${manifest.generated_from}`);
  }
  if (!Array.isArray(manifest.features) || manifest.features.length < 10) {
    throw new Error("Capability manifest is unexpectedly small");
  }
  if (manifest.features.some((feature) => feature.feature_id === "system.test")) {
    throw new Error("Internal system.test capability leaked into public manifest");
  }
  for (const feature of manifest.features) {
    for (const action of feature.actions || []) {
      if (typeof action.snake !== "boolean" || typeof action.melissa !== "boolean") {
        throw new Error(`Missing route flags for ${action.id || "unknown action"}`);
      }
      if (!action.snake && !action.melissa) {
        throw new Error(`Action has no route: ${action.id || "unknown action"}`);
      }
    }
  }
  return manifest;
}

function assertCatalog(body) {
  if (!body?.ok || !Array.isArray(body.plans)) {
    throw new Error("Subscription catalog response is invalid");
  }
  const ids = body.plans.map((plan) => plan.id);
  if (ids.join(",") !== "free,plus,pro") {
    throw new Error(`Unexpected plan order: ${ids.join(",")}`);
  }
  return body;
}

function semanticCapabilitiesFromManifest(manifest) {
  const preferred = new Set([
    "system.volume",
    "system.keyboard",
    "system.scheduler",
    "system.clipboard",
    "system.window_control",
  ]);
  return manifest.features
    .filter((feature) => preferred.has(feature.feature_id))
    .map((feature) => ({
      feature_id: feature.feature_id,
      actions: (feature.actions || [])
        .filter((action) => action.melissa)
        .map((action) => ({
          action_id: action.id,
          display_name: action.title || action.id,
          argument_hint: "",
          voice_examples: action.example ? [action.example] : [],
        })),
    }))
    .filter((feature) => feature.actions.length > 0);
}

async function runStagingSmoke({ baseUrl, token = "", expectedCommit = "", semantic = false, logger = console }) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const expected = normalizeCommit(expectedCommit);
  const results = [];

  async function check(name, callback) {
    try {
      const detail = await callback();
      results.push({ name, status: "pass", detail: detail || "ok" });
      logger.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ name, status: "fail", detail: message });
      logger.error(`FAIL ${name} — ${message}`);
    }
  }

  let manifest = null;
  let releaseInfo = null;

  await check("deployment fingerprint", async () => {
    const { response, body } = await requestJson(normalizedBaseUrl, "/release.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    releaseInfo = assertReleaseInfo(body, expected);
    return `${releaseInfo.commit || "unknown commit"} ${releaseInfo.environment || "unknown env"}`;
  });

  await check("subscription catalog", async () => {
    const { response, body } = await requestJson(normalizedBaseUrl, "/api/subscriptions/catalog");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    assertCatalog(body);
    return "Free / Plus / Pro";
  });

  await check("Core-generated capability manifest", async () => {
    const { response, body } = await requestJson(normalizedBaseUrl, "/assistant-capabilities.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    manifest = assertManifest(body);
    return `${manifest.features.length} modules`;
  });

  if (token) {
    await check("authenticated subscription status", async () => {
      const { response, body } = await requestJson(normalizedBaseUrl, "/api/subscriptions/me", {
        headers: authHeaders(token),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!body?.ok || !body.subscription) {
        throw new Error("Authenticated subscription response is invalid");
      }
      return String(body.subscription.plan || body.subscription.plan_name || "plan loaded");
    });
  } else {
    results.push({
      name: "authenticated subscription status",
      status: "skip",
      detail: "Set ZIREN_DESKTOP_TOKEN or --token to enable",
    });
    logger.log("SKIP authenticated subscription status — no desktop token");
  }

  if (semantic) {
    if (!token) {
      results.push({
        name: "semantic command classifier",
        status: "skip",
        detail: "Desktop token is required",
      });
      logger.log("SKIP semantic command classifier — no desktop token");
    } else if (!manifest) {
      results.push({
        name: "semantic command classifier",
        status: "skip",
        detail: "Capability manifest did not load",
      });
      logger.log("SKIP semantic command classifier — manifest unavailable");
    } else {
      await check("semantic command classifier", async () => {
        const capabilities = semanticCapabilitiesFromManifest(manifest);
        const { response, body } = await requestJson(
          normalizedBaseUrl,
          "/api/assistant/command-route",
          {
            method: "POST",
            headers: {
              ...authHeaders(token),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message: "поставь громкость на 37 процентов",
              capabilities,
            }),
          },
        );
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${body?.error || "classifier failed"}`);
        }
        if (!body?.ok || typeof body.matched !== "boolean") {
          throw new Error("Classifier response is invalid");
        }
        if (
          body.matched !== true
          || body.feature_id !== "system.volume"
          || body.action_id !== "volume.set"
        ) {
          throw new Error(
            `Unexpected route: matched=${body.matched} ${body.feature_id || ""}/${body.action_id || ""}`,
          );
        }
        return `system.volume/volume.set confidence=${body.confidence ?? "?"}`;
      });
    }
  }

  return {
    ok: !results.some((result) => result.status === "fail"),
    base_url: normalizedBaseUrl,
    expected_commit: expected || null,
    deployed_commit: releaseInfo?.commit || null,
    semantic_requested: Boolean(semantic),
    results,
  };
}

function printHelp() {
  console.log(`Ziren staging smoke\n\nUsage:\n  node scripts/staging-smoke.js [--base-url URL] [--token TOKEN] [--expected-commit SHA] [--semantic]\n\nEnvironment:\n  ZIREN_STAGING_URL             Override staging origin\n  ZIREN_DESKTOP_TOKEN           Temporary desktop bearer token for authenticated checks\n  ZIREN_EXPECTED_STAGING_COMMIT Expected deployed git SHA/prefix\n\nNotes:\n  Public fingerprint/catalog/manifest checks never require credentials.\n  --semantic performs one real AI classifier request and may consume included AI resource.\n  This script never executes a local PC-control action.`);
}

async function main() {
  const options = parseArgs(argv.slice(2));
  if (options.help) {
    printHelp();
    return 0;
  }
  const report = await runStagingSmoke(options);
  console.log(JSON.stringify(report, null, 2));
  return report.ok ? 0 : 1;
}

if (require.main === module) {
  main()
    .then((code) => exit(code))
    .catch((error) => {
      console.error(error instanceof Error ? error.stack || error.message : error);
      exit(1);
    });
}

module.exports = {
  DEFAULT_BASE_URL,
  assertCatalog,
  assertManifest,
  assertReleaseInfo,
  normalizeBaseUrl,
  normalizeCommit,
  parseArgs,
  runStagingSmoke,
  semanticCapabilitiesFromManifest,
};
