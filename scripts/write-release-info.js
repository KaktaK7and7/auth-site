const fs = require("node:fs");
const path = require("node:path");
const pkg = require("../package.json");

function clean(value, max = 160) {
  return String(value || "").trim().slice(0, max);
}

function buildReleaseInfo(env = process.env) {
  const commit = clean(
    env.RAILWAY_GIT_COMMIT_SHA
      || env.GIT_COMMIT_SHA
      || env.RENDER_GIT_COMMIT
      || env.COMMIT_SHA,
    64,
  );
  const environment = clean(
    env.RAILWAY_ENVIRONMENT_NAME
      || env.NODE_ENV
      || "unknown",
    80,
  );

  return {
    schema_version: 1,
    service: "ziren-auth-site",
    version: clean(pkg.version, 40),
    commit: commit || null,
    environment,
    generated_at: new Date().toISOString(),
  };
}

function writeReleaseInfo(outputPath = path.join(__dirname, "..", "public", "release.json")) {
  const info = buildReleaseInfo();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(info, null, 2)}\n`, { encoding: "utf8" });
  return info;
}

if (require.main === module) {
  const info = writeReleaseInfo();
  console.log(`Ziren release fingerprint: ${info.service} ${info.version} ${info.commit || "no-commit"} ${info.environment}`);
}

module.exports = {
  buildReleaseInfo,
  writeReleaseInfo,
};
