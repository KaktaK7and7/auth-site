const crypto = require("crypto");


const DEFAULT_CORS_ORIGINS = [
  "https://www.ziren.store",
  "https://ziren.store",
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
  "http://localhost:1420",
  "http://127.0.0.1:1420",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];


function parseAllowedOrigins(rawValue) {
  const values = String(rawValue || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return new Set(values.length ? values : DEFAULT_CORS_ORIGINS);
}


function extractBearerToken(authorizationHeader) {
  const match = String(authorizationHeader || "").match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] || "";
}


function hashDesktopToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}


function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


module.exports = {
  DEFAULT_CORS_ORIGINS,
  escapeHtml,
  extractBearerToken,
  hashDesktopToken,
  parseAllowedOrigins,
};
