const express = require("express");
const { v2: cloudinary } = require("cloudinary");
const { Pool } = require("pg");

const {
  extractBearerToken,
  hashDesktopToken,
} = require("./security");
const {
  createSocialRouter,
  initSocialSchema,
} = require("./social-router");


let socialRoot = null;
let socialInitPromise = null;


function createSocialPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL
      ? { rejectUnauthorized: false }
      : false,
  });
}


async function resolveSocialUser(pool, req) {
  if (req.session?.user) {
    return req.session.user;
  }

  const token = extractBearerToken(req.headers?.authorization);

  if (!token) {
    return null;
  }

  const result = await pool.query(
    `
    SELECT users.id, users.username, users.email, users.avatar_url,
           users.created_at, users.last_login_at, users.bio,
           users.status_text, users.public_profile_enabled,
           users.show_in_community, users.activity_tracking_enabled,
           users.ai_context_enabled, users.show_friends_on_profile
    FROM desktop_sessions
    JOIN users ON users.id = desktop_sessions.user_id
    WHERE desktop_sessions.token_hash = $1
      AND desktop_sessions.expires_at > CURRENT_TIMESTAMP
    LIMIT 1
    `,
    [hashDesktopToken(token)],
  );

  return result.rows[0] || null;
}


async function ensureSocialRoot() {
  if (socialRoot) {
    return socialRoot;
  }

  if (!socialInitPromise) {
    socialInitPromise = (async () => {
      const pool = createSocialPool();
      await initSocialSchema(pool);

      const root = express.Router();
      root.use(
        "/social",
        createSocialRouter({
          pool,
          cloudinary,
          resolveUser: (req) => resolveSocialUser(pool, req),
        }),
      );

      socialRoot = root;
      return root;
    })().catch((error) => {
      socialInitPromise = null;
      throw error;
    });
  }

  return socialInitPromise;
}


function sendApiNotFound(req, res, next) {
  const requestPath = String(req?.path || req?.url || "");

  if (!requestPath.startsWith("/social")) {
    return res.status(404).json({
      ok: false,
      error: "API route not found",
    });
  }

  return ensureSocialRoot()
    .then((router) => router(req, res, next))
    .catch((error) => {
      console.error("social API initialization error:", error);
      return res.status(503).json({
        ok: false,
        error: "Social service unavailable",
      });
    });
}


module.exports = {
  sendApiNotFound,
};