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


let socialPool = null;
let socialRoot = null;
let socialSchemaPromise = null;
let socialInitPromise = null;


function getSocialPool() {
  if (!socialPool) {
    socialPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL
        ? { rejectUnauthorized: false }
        : false,
    });
  }

  return socialPool;
}


function ensureSocialSchema() {
  if (!socialSchemaPromise) {
    socialSchemaPromise = initSocialSchema(getSocialPool()).catch((error) => {
      socialSchemaPromise = null;
      throw error;
    });
  }

  return socialSchemaPromise;
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
      await ensureSocialSchema();
      const pool = getSocialPool();
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


async function sendPublicSocialProfile(userId, res) {
  await ensureSocialSchema();
  const pool = getSocialPool();
  const profileResult = await pool.query(
    `
    SELECT id, username, avatar_url, status_text, bio,
           public_profile_enabled, show_friends_on_profile
    FROM users
    WHERE id = $1
    LIMIT 1
    `,
    [userId],
  );
  const profile = profileResult.rows[0];

  if (!profile?.public_profile_enabled) {
    return res.status(404).json({
      ok: false,
      error: "Профиль не найден или закрыт",
    });
  }

  const friendsVisible = Boolean(profile.show_friends_on_profile);

  if (!friendsVisible) {
    res.set("Cache-Control", "private, no-store");
    return res.json({
      ok: true,
      profile: {
        id: Number(profile.id),
        username: profile.username,
        avatar_url: profile.avatar_url || "/images/Ziren.png",
        status_text: profile.status_text || "",
        bio: profile.bio || "",
        friends_visible: false,
        friends_count: null,
        friends: [],
      },
    });
  }

  const friendsResult = await pool.query(
    `
    SELECT friend.id, friend.username, friend.avatar_url,
           friend.public_profile_enabled
    FROM friendships relation
    JOIN users friend
      ON friend.id = CASE
        WHEN relation.user_low_id = $1 THEN relation.user_high_id
        ELSE relation.user_low_id
      END
    WHERE relation.status = 'accepted'
      AND (relation.user_low_id = $1 OR relation.user_high_id = $1)
    ORDER BY LOWER(friend.username), friend.id
    LIMIT 200
    `,
    [userId],
  );

  res.set("Cache-Control", "private, no-store");
  return res.json({
    ok: true,
    profile: {
      id: Number(profile.id),
      username: profile.username,
      avatar_url: profile.avatar_url || "/images/Ziren.png",
      status_text: profile.status_text || "",
      bio: profile.bio || "",
      friends_visible: true,
      friends_count: friendsResult.rowCount || 0,
      friends: friendsResult.rows.map((friend) => ({
        id: Number(friend.id),
        username: friend.username,
        avatar_url: friend.avatar_url || "/images/Ziren.png",
        public_profile_url: friend.public_profile_enabled
          ? `/community/${friend.id}`
          : null,
      })),
    },
  });
}


function sendApiNotFound(req, res, next) {
  const requestPath = String(req?.path || req?.url || "");

  if (!requestPath.startsWith("/social")) {
    return res.status(404).json({
      ok: false,
      error: "API route not found",
    });
  }

  const publicMatch = requestPath.match(/^\/social\/public\/(\d+)\/?$/);

  if (publicMatch) {
    const userId = Number.parseInt(publicMatch[1], 10);
    return sendPublicSocialProfile(userId, res).catch((error) => {
      console.error("public social profile error:", error);
      return res.status(503).json({
        ok: false,
        error: "Social profile unavailable",
      });
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