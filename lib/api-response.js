const express = require("express");
const { v2: cloudinary } = require("cloudinary");
const { Pool } = require("pg");

const {
  extractBearerToken,
  hashDesktopToken,
} = require("./security");
const { MAX_SCREENSHOT_BYTES } = require("./screenshot");
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


async function initSocialSafetySchema(pool) {
  await pool.query(`
    ALTER TABLE friend_preferences
    ADD COLUMN IF NOT EXISTS announce_enabled_at TIMESTAMP;
  `);

  await pool.query(`
    UPDATE friend_preferences
    SET announce_enabled_at = COALESCE(announce_enabled_at, updated_at, CURRENT_TIMESTAMP)
    WHERE announce_messages = TRUE
      AND announce_enabled_at IS NULL;
  `);

  await pool.query(`
    CREATE OR REPLACE FUNCTION ziren_set_announce_enabled_at()
    RETURNS trigger AS $$
    BEGIN
      IF NEW.announce_messages = FALSE THEN
        NEW.announce_enabled_at := NULL;
      ELSIF TG_OP = 'INSERT' THEN
        NEW.announce_enabled_at := CURRENT_TIMESTAMP;
      ELSIF OLD.announce_messages = FALSE OR OLD.announce_enabled_at IS NULL THEN
        NEW.announce_enabled_at := CURRENT_TIMESTAMP;
      ELSE
        NEW.announce_enabled_at := OLD.announce_enabled_at;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await pool.query(`
    DROP TRIGGER IF EXISTS trg_friend_preferences_announce_enabled_at
    ON friend_preferences;

    CREATE TRIGGER trg_friend_preferences_announce_enabled_at
    BEFORE INSERT OR UPDATE OF announce_messages, voice_alias
    ON friend_preferences
    FOR EACH ROW
    EXECUTE FUNCTION ziren_set_announce_enabled_at();
  `);
}


function ensureSocialSchema() {
  if (!socialSchemaPromise) {
    const pool = getSocialPool();
    socialSchemaPromise = initSocialSchema(pool)
      .then(() => initSocialSafetySchema(pool))
      .catch((error) => {
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


function serializeAnnouncement(row) {
  const id = Number(row.id);

  return {
    id,
    sender_id: Number(row.sender_id),
    recipient_id: Number(row.recipient_id),
    kind: row.kind,
    body: row.body || "",
    created_at: row.created_at,
    read_at: row.read_at || null,
    attachment_url:
      row.kind === "screenshot" && row.attachment_public_id
        ? `/api/social/messages/${id}/attachment`
        : null,
    sender_username: row.sender_username,
    sender_voice_name: row.sender_voice_alias || row.sender_username,
  };
}


function serializeScreenshotMessage(row) {
  const id = Number(row.id);

  return {
    id,
    sender_id: Number(row.sender_id),
    recipient_id: Number(row.recipient_id),
    kind: "screenshot",
    body: row.body || "",
    created_at: row.created_at,
    read_at: row.read_at || null,
    attachment_url: `/api/social/messages/${id}/attachment`,
  };
}


function isJpegBuffer(value) {
  return Buffer.isBuffer(value)
    && value.length >= 4
    && value.length <= MAX_SCREENSHOT_BYTES
    && value[0] === 0xff
    && value[1] === 0xd8
    && value[2] === 0xff;
}


function uploadMessageScreenshot(buffer, senderId) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "ziren/messages",
        public_id: `screen_${senderId}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        resource_type: "image",
        type: "authenticated",
        overwrite: false,
        format: "jpg",
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(result);
      },
    );

    stream.end(buffer);
  });
}


async function requireSocialFriend(pool, userId, friendId) {
  const result = await pool.query(
    `
    SELECT id
    FROM friendships
    WHERE status = 'accepted'
      AND user_low_id = LEAST($1::int, $2::int)
      AND user_high_id = GREATEST($1::int, $2::int)
    LIMIT 1
    `,
    [userId, friendId],
  );

  return Boolean(result.rows.length);
}


async function sendSocialScreenshot(pool, req, res) {
  const user = await resolveSocialUser(pool, req);

  if (!user) {
    return res.status(401).json({
      ok: false,
      error: "Not authenticated",
    });
  }

  const recipientId = Number.parseInt(String(req.query?.recipient_id || ""), 10);

  if (!Number.isInteger(recipientId) || recipientId <= 0 || recipientId === Number(user.id)) {
    return res.status(400).json({
      ok: false,
      error: "Некорректный получатель",
    });
  }

  if (!isJpegBuffer(req.body)) {
    return res.status(400).json({
      ok: false,
      error: "Некорректный снимок экрана",
    });
  }

  if (!await requireSocialFriend(pool, user.id, recipientId)) {
    return res.status(403).json({
      ok: false,
      error: "Пользователь не находится у тебя в друзьях",
    });
  }

  const uploaded = await uploadMessageScreenshot(req.body, user.id);

  try {
    const result = await pool.query(
      `
      INSERT INTO direct_messages (
        sender_id,
        recipient_id,
        kind,
        body,
        attachment_public_id,
        attachment_format
      )
      VALUES ($1, $2, 'screenshot', '', $3, $4)
      RETURNING id, sender_id, recipient_id, body, created_at, read_at
      `,
      [
        user.id,
        recipientId,
        uploaded.public_id,
        uploaded.format || "jpg",
      ],
    );

    return res.status(201).json({
      ok: true,
      message: serializeScreenshotMessage(result.rows[0]),
    });
  } catch (error) {
    if (uploaded?.public_id) {
      cloudinary.uploader.destroy(
        uploaded.public_id,
        { resource_type: "image", type: "authenticated" },
        () => {},
      );
    }
    throw error;
  }
}


async function sendSafeAnnouncements(pool, req, res) {
  const user = await resolveSocialUser(pool, req);

  if (!user) {
    return res.status(401).json({
      ok: false,
      error: "Not authenticated",
    });
  }

  const result = await pool.query(
    `
    SELECT
      message.id,
      message.sender_id,
      message.recipient_id,
      message.kind,
      message.body,
      message.attachment_public_id,
      message.attachment_format,
      message.created_at,
      message.read_at,
      sender.username AS sender_username,
      COALESCE(preferences.voice_alias, '') AS sender_voice_alias
    FROM direct_messages message
    JOIN users sender ON sender.id = message.sender_id
    JOIN friend_preferences preferences
      ON preferences.owner_user_id = message.recipient_id
      AND preferences.friend_user_id = message.sender_id
      AND preferences.announce_messages = TRUE
      AND preferences.announce_enabled_at IS NOT NULL
      AND message.created_at >= preferences.announce_enabled_at
    JOIN friendships relation
      ON relation.user_low_id = LEAST(message.sender_id, message.recipient_id)
      AND relation.user_high_id = GREATEST(message.sender_id, message.recipient_id)
      AND relation.status = 'accepted'
    WHERE message.recipient_id = $1
      AND message.announced_at IS NULL
    ORDER BY message.id ASC
    LIMIT 10
    `,
    [user.id],
  );

  res.set("Cache-Control", "no-store");
  return res.json({
    ok: true,
    messages: result.rows.map(serializeAnnouncement),
  });
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

      root.post(
        "/social/screenshots",
        express.raw({
          type: ["image/jpeg", "image/jpg"],
          limit: MAX_SCREENSHOT_BYTES,
        }),
        async (req, res) => {
          try {
            return await sendSocialScreenshot(pool, req, res);
          } catch (error) {
            console.error("social screenshot upload error:", error);
            return res.status(500).json({
              ok: false,
              error: "Не удалось отправить скриншот",
            });
          }
        },
      );

      // This route intentionally precedes the generic social router. It adds
      // an opt-in timestamp boundary so enabling speech never replays old chat
      // history that arrived before the user granted the permission.
      root.get("/social/announcements", async (req, res) => {
        try {
          return await sendSafeAnnouncements(pool, req, res);
        } catch (error) {
          console.error("social announcements error:", error);
          return res.status(500).json({
            ok: false,
            error: "Не удалось проверить новые сообщения",
          });
        }
      });

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
    SELECT friend.id, friend.username, friend.avatar_url
    FROM friendships relation
    JOIN users friend
      ON friend.id = CASE
        WHEN relation.user_low_id = $1 THEN relation.user_high_id
        ELSE relation.user_low_id
      END
    WHERE relation.status = 'accepted'
      AND (relation.user_low_id = $1 OR relation.user_high_id = $1)
      AND friend.public_profile_enabled = TRUE
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
        public_profile_url: `/community/${friend.id}`,
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