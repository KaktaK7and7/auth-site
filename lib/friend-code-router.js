const crypto = require("crypto");
const express = require("express");

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 6;
const CODE_PREFIX = "ZR-";
const MAX_SEARCH_LENGTH = 64;

function randomFriendCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let value = CODE_PREFIX;
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    value += CODE_ALPHABET[bytes[index] % CODE_ALPHABET.length];
  }
  return value;
}

function normalizeQuery(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, MAX_SEARCH_LENGTH);
}

function normalizeFriendCode(value) {
  const compact = String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!compact.startsWith("ZR") || compact.length !== CODE_LENGTH + 2) {
    return "";
  }
  return `${CODE_PREFIX}${compact.slice(2)}`;
}

async function ensureFriendCode(pool, userId) {
  const current = await pool.query(
    "SELECT friend_code FROM users WHERE id = $1 LIMIT 1",
    [userId],
  );
  if (!current.rows.length) return null;
  if (current.rows[0].friend_code) return current.rows[0].friend_code;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = randomFriendCode();
    try {
      const updated = await pool.query(
        `
        UPDATE users
        SET friend_code = $2
        WHERE id = $1 AND friend_code IS NULL
        RETURNING friend_code
        `,
        [userId, code],
      );
      if (updated.rows[0]?.friend_code) return updated.rows[0].friend_code;

      const reread = await pool.query(
        "SELECT friend_code FROM users WHERE id = $1 LIMIT 1",
        [userId],
      );
      if (reread.rows[0]?.friend_code) return reread.rows[0].friend_code;
    } catch (error) {
      if (error?.code !== "23505") throw error;
    }
  }

  throw new Error("Не удалось создать уникальный код пользователя");
}

async function initFriendCodeSchema(pool) {
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS friend_code VARCHAR(16);
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_friend_code_unique
    ON users(friend_code)
    WHERE friend_code IS NOT NULL;
  `);

  const missing = await pool.query(
    "SELECT id FROM users WHERE friend_code IS NULL ORDER BY id LIMIT 5000",
  );
  for (const row of missing.rows) {
    await ensureFriendCode(pool, Number(row.id));
  }
}

function createFriendCodeRouter({ pool, resolveUser }) {
  if (!pool || typeof resolveUser !== "function") {
    throw new Error("Friend code router dependencies are not configured");
  }

  const router = express.Router();

  router.use(async (req, res, next) => {
    try {
      const user = await resolveUser(req);
      if (!user) {
        return res.status(401).json({ ok: false, error: "Not authenticated" });
      }
      req.friendCodeUser = user;
      return next();
    } catch (error) {
      console.error("friend code auth error:", error);
      return res.status(503).json({ ok: false, error: "Social service unavailable" });
    }
  });

  router.get("/friend-code", async (req, res) => {
    try {
      const friendCode = await ensureFriendCode(pool, Number(req.friendCodeUser.id));
      res.set("Cache-Control", "no-store");
      return res.json({ ok: true, friend_code: friendCode });
    } catch (error) {
      console.error("friend code read error:", error);
      return res.status(500).json({ ok: false, error: "Не удалось получить код пользователя" });
    }
  });

  router.get("/users/search", async (req, res) => {
    try {
      const query = normalizeQuery(req.query.q);
      if (query.length < 2) {
        return res.status(400).json({ ok: false, error: "Введи ник или уникальный код" });
      }

      const code = normalizeFriendCode(query);
      const result = code
        ? await pool.query(
            `
            SELECT candidate.id, candidate.username, candidate.avatar_url,
                   candidate.status_text, candidate.public_profile_enabled,
                   candidate.friend_code, relation.status AS friendship_status,
                   relation.requested_by
            FROM users candidate
            LEFT JOIN friendships relation
              ON relation.user_low_id = LEAST($1::int, candidate.id)
              AND relation.user_high_id = GREATEST($1::int, candidate.id)
            WHERE candidate.id <> $1 AND candidate.friend_code = $2
            LIMIT 1
            `,
            [req.friendCodeUser.id, code],
          )
        : await pool.query(
            `
            SELECT candidate.id, candidate.username, candidate.avatar_url,
                   candidate.status_text, candidate.public_profile_enabled,
                   candidate.friend_code, relation.status AS friendship_status,
                   relation.requested_by
            FROM users candidate
            LEFT JOIN friendships relation
              ON relation.user_low_id = LEAST($1::int, candidate.id)
              AND relation.user_high_id = GREATEST($1::int, candidate.id)
            WHERE candidate.id <> $1
              AND LOWER(candidate.username) LIKE LOWER($2)
            ORDER BY
              CASE WHEN LOWER(candidate.username) = LOWER($3) THEN 0 ELSE 1 END,
              LOWER(candidate.username), candidate.id
            LIMIT 20
            `,
            [req.friendCodeUser.id, `%${query}%`, query],
          );

      return res.json({
        ok: true,
        search_mode: code ? "code" : "username",
        users: result.rows.map((row) => ({
          id: Number(row.id),
          username: row.username,
          avatar_url: row.avatar_url || "/images/Ziren.png",
          status_text: row.status_text || "",
          friend_code: row.friend_code || null,
          public_profile_url: row.public_profile_enabled ? `/community/${row.id}` : null,
          friendship_status: row.friendship_status || "none",
          request_direction:
            row.friendship_status === "pending"
              ? Number(row.requested_by) === Number(req.friendCodeUser.id)
                ? "outgoing"
                : "incoming"
              : null,
        })),
      });
    } catch (error) {
      console.error("friend code search error:", error);
      return res.status(500).json({ ok: false, error: "Не удалось выполнить поиск пользователей" });
    }
  });

  return router;
}

module.exports = {
  createFriendCodeRouter,
  ensureFriendCode,
  initFriendCodeSchema,
  normalizeFriendCode,
};
