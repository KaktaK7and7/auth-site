const express = require("express");

const { validateScreenshotDataUrl } = require("./screenshot");

const FRIEND_STATUS_PENDING = "pending";
const FRIEND_STATUS_ACCEPTED = "accepted";
const MESSAGE_KINDS = new Set(["text", "clipboard", "screenshot"]);
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_VOICE_ALIAS_LENGTH = 48;
const MAX_SEARCH_LENGTH = 64;
const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 100;


function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}


function normalizeVoiceAlias(value) {
  const alias = normalizeWhitespace(value);

  if (!alias) {
    return "";
  }

  if (
    alias.length > MAX_VOICE_ALIAS_LENGTH
    || /[\u0000-\u001f\u007f]/.test(alias)
  ) {
    throw new Error("Некорректное голосовое имя");
  }

  return alias;
}


function normalizeMessageBody(value, { required = true } = {}) {
  const body = String(value || "").trim();

  if (required && !body) {
    throw new Error("Сообщение не может быть пустым");
  }

  if (
    body.length > MAX_MESSAGE_LENGTH
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body)
  ) {
    throw new Error("Сообщение слишком длинное или содержит недопустимые символы");
  }

  return body;
}


function parsePositiveInt(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}


function canonicalPair(firstId, secondId) {
  const first = Number(firstId);
  const second = Number(secondId);

  if (!Number.isInteger(first) || !Number.isInteger(second) || first <= 0 || second <= 0) {
    throw new Error("Некорректный пользователь");
  }

  if (first === second) {
    throw new Error("Нельзя добавить самого себя в друзья");
  }

  return first < second
    ? { lowId: first, highId: second }
    : { lowId: second, highId: first };
}


function messageAttachmentPath(messageId) {
  return `/api/social/messages/${messageId}/attachment`;
}


function serializeMessage(row) {
  const id = Number(row.id);
  const senderId = Number(row.sender_id);
  const recipientId = Number(row.recipient_id);

  return {
    id,
    sender_id: senderId,
    recipient_id: recipientId,
    kind: row.kind,
    body: row.body || "",
    created_at: row.created_at,
    read_at: row.read_at || null,
    attachment_url:
      row.kind === "screenshot" && row.attachment_public_id
        ? messageAttachmentPath(id)
        : null,
  };
}


async function initSocialSchema(pool) {
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS show_friends_on_profile BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS friendships (
      id BIGSERIAL PRIMARY KEY,
      user_low_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_high_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      requested_by INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR(16) NOT NULL DEFAULT '${FRIEND_STATUS_PENDING}',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CHECK (user_low_id < user_high_id),
      CHECK (requested_by = user_low_id OR requested_by = user_high_id),
      CHECK (status IN ('${FRIEND_STATUS_PENDING}', '${FRIEND_STATUS_ACCEPTED}')),
      UNIQUE(user_low_id, user_high_id)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_friendships_low_status
    ON friendships(user_low_id, status);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_friendships_high_status
    ON friendships(user_high_id, status);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS friend_preferences (
      owner_user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      friend_user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      voice_alias VARCHAR(${MAX_VOICE_ALIAS_LENGTH}) NOT NULL DEFAULT '',
      announce_messages BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(owner_user_id, friend_user_id),
      CHECK (owner_user_id <> friend_user_id)
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_preferences_unique_voice_alias
    ON friend_preferences(owner_user_id, LOWER(voice_alias))
    WHERE voice_alias <> '';
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS direct_messages (
      id BIGSERIAL PRIMARY KEY,
      sender_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind VARCHAR(16) NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      attachment_public_id TEXT,
      attachment_format VARCHAR(16),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      read_at TIMESTAMP,
      announced_at TIMESTAMP,
      CHECK (sender_id <> recipient_id),
      CHECK (kind IN ('text', 'clipboard', 'screenshot'))
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_direct_messages_pair
    ON direct_messages(sender_id, recipient_id, id DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_direct_messages_recipient_unread
    ON direct_messages(recipient_id, read_at, id DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_direct_messages_recipient_announce
    ON direct_messages(recipient_id, announced_at, id ASC);
  `);
}


async function friendshipRow(pool, firstId, secondId, queryable = pool) {
  const { lowId, highId } = canonicalPair(firstId, secondId);
  const result = await queryable.query(
    `
    SELECT id, user_low_id, user_high_id, requested_by, status,
           created_at, updated_at
    FROM friendships
    WHERE user_low_id = $1 AND user_high_id = $2
    LIMIT 1
    `,
    [lowId, highId],
  );

  return result.rows[0] || null;
}


async function requireAcceptedFriendship(pool, userId, friendId, queryable = pool) {
  const relation = await friendshipRow(pool, userId, friendId, queryable);

  if (!relation || relation.status !== FRIEND_STATUS_ACCEPTED) {
    const error = new Error("Пользователь не находится у тебя в друзьях");
    error.statusCode = 403;
    throw error;
  }

  return relation;
}


async function listFriends(pool, userId) {
  const result = await pool.query(
    `
    SELECT
      friend.id,
      friend.username,
      friend.avatar_url,
      friend.status_text,
      friend.public_profile_enabled,
      COALESCE(preferences.voice_alias, '') AS voice_alias,
      COALESCE(preferences.announce_messages, FALSE) AS announce_messages,
      (
        SELECT COUNT(*)::int
        FROM direct_messages message
        WHERE message.sender_id = friend.id
          AND message.recipient_id = $1
          AND message.read_at IS NULL
      ) AS unread_count,
      (
        SELECT MAX(message.created_at)
        FROM direct_messages message
        WHERE
          (message.sender_id = $1 AND message.recipient_id = friend.id)
          OR
          (message.sender_id = friend.id AND message.recipient_id = $1)
      ) AS last_message_at
    FROM friendships relation
    JOIN users friend
      ON friend.id = CASE
        WHEN relation.user_low_id = $1 THEN relation.user_high_id
        ELSE relation.user_low_id
      END
    LEFT JOIN friend_preferences preferences
      ON preferences.owner_user_id = $1
      AND preferences.friend_user_id = friend.id
    WHERE relation.status = '${FRIEND_STATUS_ACCEPTED}'
      AND (relation.user_low_id = $1 OR relation.user_high_id = $1)
    ORDER BY last_message_at DESC NULLS LAST, LOWER(friend.username), friend.id
    `,
    [userId],
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    username: row.username,
    avatar_url: row.avatar_url || "/images/Ziren.png",
    status_text: row.status_text || "",
    public_profile_url: row.public_profile_enabled
      ? `/community/${row.id}`
      : null,
    voice_alias: row.voice_alias || "",
    announce_messages: Boolean(row.announce_messages),
    unread_count: Number(row.unread_count) || 0,
    last_message_at: row.last_message_at || null,
  }));
}


async function listFriendRequests(pool, userId) {
  const result = await pool.query(
    `
    SELECT
      relation.id,
      relation.requested_by,
      relation.created_at,
      other.id AS user_id,
      other.username,
      other.avatar_url,
      other.public_profile_enabled
    FROM friendships relation
    JOIN users other
      ON other.id = CASE
        WHEN relation.user_low_id = $1 THEN relation.user_high_id
        ELSE relation.user_low_id
      END
    WHERE relation.status = '${FRIEND_STATUS_PENDING}'
      AND (relation.user_low_id = $1 OR relation.user_high_id = $1)
    ORDER BY relation.created_at DESC, relation.id DESC
    `,
    [userId],
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    direction: Number(row.requested_by) === Number(userId)
      ? "outgoing"
      : "incoming",
    created_at: row.created_at,
    user: {
      id: Number(row.user_id),
      username: row.username,
      avatar_url: row.avatar_url || "/images/Ziren.png",
      public_profile_url: row.public_profile_enabled
        ? `/community/${row.user_id}`
        : null,
    },
  }));
}


async function uploadScreenshot(cloudinary, dataUrl, senderId) {
  const normalized = validateScreenshotDataUrl(dataUrl);

  if (!normalized) {
    const error = new Error("Некорректный снимок экрана");
    error.statusCode = 400;
    throw error;
  }

  const prefix = "data:image/jpeg;base64,";
  const buffer = Buffer.from(normalized.slice(prefix.length), "base64");

  return await new Promise((resolve, reject) => {
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


function createSocialRouter({ pool, cloudinary, resolveUser }) {
  if (!pool || !cloudinary || typeof resolveUser !== "function") {
    throw new Error("Social router dependencies are not configured");
  }

  const router = express.Router();

  router.use(async (req, res, next) => {
    try {
      const user = await resolveUser(req);

      if (!user) {
        return res.status(401).json({
          ok: false,
          error: "Not authenticated",
        });
      }

      req.socialUser = user;
      return next();
    } catch (error) {
      console.error("social auth error:", error);
      return res.status(503).json({
        ok: false,
        error: "Social service authentication unavailable",
      });
    }
  });

  router.get("/friends", async (req, res) => {
    try {
      const [friends, requests, privacyResult] = await Promise.all([
        listFriends(pool, req.socialUser.id),
        listFriendRequests(pool, req.socialUser.id),
        pool.query(
          `
          SELECT show_friends_on_profile
          FROM users
          WHERE id = $1
          LIMIT 1
          `,
          [req.socialUser.id],
        ),
      ]);

      res.set("Cache-Control", "no-store");
      return res.json({
        ok: true,
        total: friends.length,
        friends,
        requests,
        privacy: {
          show_friends_on_profile: Boolean(
            privacyResult.rows[0]?.show_friends_on_profile,
          ),
        },
      });
    } catch (error) {
      console.error("social friends error:", error);
      return res.status(500).json({
        ok: false,
        error: "Не удалось загрузить друзей",
      });
    }
  });

  router.get("/users/search", async (req, res) => {
    try {
      const query = normalizeWhitespace(req.query.q).slice(0, MAX_SEARCH_LENGTH);

      if (query.length < 2) {
        return res.status(400).json({
          ok: false,
          error: "Введи минимум два символа ника",
        });
      }

      const result = await pool.query(
        `
        SELECT
          candidate.id,
          candidate.username,
          candidate.avatar_url,
          candidate.status_text,
          candidate.public_profile_enabled,
          relation.status AS friendship_status,
          relation.requested_by
        FROM users candidate
        LEFT JOIN friendships relation
          ON relation.user_low_id = LEAST($1::int, candidate.id)
          AND relation.user_high_id = GREATEST($1::int, candidate.id)
        WHERE candidate.id <> $1
          AND LOWER(candidate.username) LIKE LOWER($2)
        ORDER BY
          CASE WHEN LOWER(candidate.username) = LOWER($3) THEN 0 ELSE 1 END,
          LOWER(candidate.username),
          candidate.id
        LIMIT 20
        `,
        [req.socialUser.id, `%${query}%`, query],
      );

      return res.json({
        ok: true,
        users: result.rows.map((row) => ({
          id: Number(row.id),
          username: row.username,
          avatar_url: row.avatar_url || "/images/Ziren.png",
          status_text: row.status_text || "",
          public_profile_url: row.public_profile_enabled
            ? `/community/${row.id}`
            : null,
          friendship_status: row.friendship_status || "none",
          request_direction:
            row.friendship_status === FRIEND_STATUS_PENDING
              ? (
                Number(row.requested_by) === Number(req.socialUser.id)
                  ? "outgoing"
                  : "incoming"
              )
              : null,
        })),
      });
    } catch (error) {
      console.error("social user search error:", error);
      return res.status(500).json({
        ok: false,
        error: "Не удалось выполнить поиск пользователей",
      });
    }
  });

  router.post("/friends/requests", async (req, res) => {
    const targetId = parsePositiveInt(req.body?.user_id);

    if (!targetId) {
      return res.status(400).json({
        ok: false,
        error: "Некорректный пользователь",
      });
    }

    try {
      const { lowId, highId } = canonicalPair(req.socialUser.id, targetId);
      const targetResult = await pool.query(
        "SELECT id FROM users WHERE id = $1 LIMIT 1",
        [targetId],
      );

      if (!targetResult.rows.length) {
        return res.status(404).json({
          ok: false,
          error: "Пользователь не найден",
        });
      }

      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        const existing = await client.query(
          `
          SELECT id, requested_by, status
          FROM friendships
          WHERE user_low_id = $1 AND user_high_id = $2
          FOR UPDATE
          `,
          [lowId, highId],
        );
        const relation = existing.rows[0];

        if (relation?.status === FRIEND_STATUS_ACCEPTED) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            ok: false,
            error: "Вы уже друзья",
          });
        }

        if (relation?.status === FRIEND_STATUS_PENDING) {
          if (Number(relation.requested_by) === Number(req.socialUser.id)) {
            await client.query("ROLLBACK");
            return res.status(409).json({
              ok: false,
              error: "Заявка уже отправлена",
            });
          }

          await client.query(
            `
            UPDATE friendships
            SET status = '${FRIEND_STATUS_ACCEPTED}',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            `,
            [relation.id],
          );
          await client.query("COMMIT");
          return res.status(200).json({
            ok: true,
            accepted: true,
          });
        }

        await client.query(
          `
          INSERT INTO friendships (
            user_low_id,
            user_high_id,
            requested_by,
            status
          )
          VALUES ($1, $2, $3, '${FRIEND_STATUS_PENDING}')
          `,
          [lowId, highId, req.socialUser.id],
        );
        await client.query("COMMIT");

        return res.status(201).json({
          ok: true,
          accepted: false,
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      if (/Нельзя добавить самого себя/.test(String(error.message || ""))) {
        return res.status(400).json({ ok: false, error: error.message });
      }

      console.error("social friend request error:", error);
      return res.status(500).json({
        ok: false,
        error: "Не удалось отправить заявку",
      });
    }
  });

  router.post("/friends/requests/:id/accept", async (req, res) => {
    const requestId = parsePositiveInt(req.params.id);

    if (!requestId) {
      return res.status(400).json({ ok: false, error: "Некорректная заявка" });
    }

    try {
      const result = await pool.query(
        `
        UPDATE friendships
        SET status = '${FRIEND_STATUS_ACCEPTED}',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND status = '${FRIEND_STATUS_PENDING}'
          AND requested_by <> $2
          AND (user_low_id = $2 OR user_high_id = $2)
        RETURNING id
        `,
        [requestId, req.socialUser.id],
      );

      if (!result.rows.length) {
        return res.status(404).json({
          ok: false,
          error: "Входящая заявка не найдена",
        });
      }

      return res.json({ ok: true });
    } catch (error) {
      console.error("social accept request error:", error);
      return res.status(500).json({ ok: false, error: "Не удалось принять заявку" });
    }
  });

  router.delete("/friends/requests/:id", async (req, res) => {
    const requestId = parsePositiveInt(req.params.id);

    if (!requestId) {
      return res.status(400).json({ ok: false, error: "Некорректная заявка" });
    }

    try {
      const result = await pool.query(
        `
        DELETE FROM friendships
        WHERE id = $1
          AND status = '${FRIEND_STATUS_PENDING}'
          AND (user_low_id = $2 OR user_high_id = $2)
        RETURNING id
        `,
        [requestId, req.socialUser.id],
      );

      if (!result.rows.length) {
        return res.status(404).json({ ok: false, error: "Заявка не найдена" });
      }

      return res.json({ ok: true });
    } catch (error) {
      console.error("social decline request error:", error);
      return res.status(500).json({ ok: false, error: "Не удалось удалить заявку" });
    }
  });

  router.delete("/friends/:friendId", async (req, res) => {
    const friendId = parsePositiveInt(req.params.friendId);

    if (!friendId) {
      return res.status(400).json({ ok: false, error: "Некорректный друг" });
    }

    try {
      const { lowId, highId } = canonicalPair(req.socialUser.id, friendId);
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        const deleted = await client.query(
          `
          DELETE FROM friendships
          WHERE user_low_id = $1
            AND user_high_id = $2
            AND status = '${FRIEND_STATUS_ACCEPTED}'
          RETURNING id
          `,
          [lowId, highId],
        );

        if (!deleted.rows.length) {
          await client.query("ROLLBACK");
          return res.status(404).json({ ok: false, error: "Друг не найден" });
        }

        await client.query(
          `
          DELETE FROM friend_preferences
          WHERE
            (owner_user_id = $1 AND friend_user_id = $2)
            OR
            (owner_user_id = $2 AND friend_user_id = $1)
          `,
          [req.socialUser.id, friendId],
        );
        await client.query("COMMIT");
        return res.json({ ok: true });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error("social unfriend error:", error);
      return res.status(500).json({ ok: false, error: "Не удалось удалить друга" });
    }
  });

  router.patch("/friends/:friendId/preferences", async (req, res) => {
    const friendId = parsePositiveInt(req.params.friendId);

    if (!friendId) {
      return res.status(400).json({ ok: false, error: "Некорректный друг" });
    }

    try {
      await requireAcceptedFriendship(pool, req.socialUser.id, friendId);
      const voiceAlias = normalizeVoiceAlias(req.body?.voice_alias);
      const announceMessages = req.body?.announce_messages;

      if (typeof announceMessages !== "boolean") {
        return res.status(400).json({
          ok: false,
          error: "Некорректная настройка озвучивания",
        });
      }

      await pool.query(
        `
        INSERT INTO friend_preferences (
          owner_user_id,
          friend_user_id,
          voice_alias,
          announce_messages,
          updated_at
        )
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
        ON CONFLICT (owner_user_id, friend_user_id)
        DO UPDATE SET
          voice_alias = EXCLUDED.voice_alias,
          announce_messages = EXCLUDED.announce_messages,
          updated_at = CURRENT_TIMESTAMP
        `,
        [req.socialUser.id, friendId, voiceAlias, announceMessages],
      );

      return res.json({
        ok: true,
        preferences: {
          voice_alias: voiceAlias,
          announce_messages: announceMessages,
        },
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ ok: false, error: error.message });
      }

      if (error.code === "23505") {
        return res.status(409).json({
          ok: false,
          error: "Это голосовое имя уже используется для другого друга",
        });
      }

      if (/голосовое имя/i.test(String(error.message || ""))) {
        return res.status(400).json({ ok: false, error: error.message });
      }

      console.error("social friend preferences error:", error);
      return res.status(500).json({
        ok: false,
        error: "Не удалось сохранить настройки друга",
      });
    }
  });

  router.patch("/privacy", async (req, res) => {
    if (typeof req.body?.show_friends_on_profile !== "boolean") {
      return res.status(400).json({ ok: false, error: "Некорректная настройка приватности" });
    }

    try {
      await pool.query(
        `
        UPDATE users
        SET show_friends_on_profile = $1
        WHERE id = $2
        `,
        [req.body.show_friends_on_profile, req.socialUser.id],
      );

      return res.json({
        ok: true,
        privacy: {
          show_friends_on_profile: req.body.show_friends_on_profile,
        },
      });
    } catch (error) {
      console.error("social privacy error:", error);
      return res.status(500).json({ ok: false, error: "Не удалось сохранить приватность друзей" });
    }
  });

  router.get("/public/:userId", async (req, res) => {
    const userId = parsePositiveInt(req.params.userId);

    if (!userId) {
      return res.status(404).json({ ok: false, error: "Профиль не найден" });
    }

    try {
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
        return res.status(404).json({ ok: false, error: "Профиль не найден или закрыт" });
      }

      const countResult = await pool.query(
        `
        SELECT COUNT(*)::int AS total
        FROM friendships
        WHERE status = '${FRIEND_STATUS_ACCEPTED}'
          AND (user_low_id = $1 OR user_high_id = $1)
        `,
        [userId],
      );
      const showFriends = Boolean(profile.show_friends_on_profile);
      let friends = [];

      if (showFriends) {
        const friendResult = await pool.query(
          `
          SELECT candidate.id, candidate.username, candidate.avatar_url,
                 candidate.public_profile_enabled
          FROM friendships relation
          JOIN users candidate
            ON candidate.id = CASE
              WHEN relation.user_low_id = $1 THEN relation.user_high_id
              ELSE relation.user_low_id
            END
          WHERE relation.status = '${FRIEND_STATUS_ACCEPTED}'
            AND (relation.user_low_id = $1 OR relation.user_high_id = $1)
          ORDER BY LOWER(candidate.username), candidate.id
          LIMIT 200
          `,
          [userId],
        );

        friends = friendResult.rows.map((friend) => ({
          id: Number(friend.id),
          username: friend.username,
          avatar_url: friend.avatar_url || "/images/Ziren.png",
          public_profile_url: friend.public_profile_enabled
            ? `/community/${friend.id}`
            : null,
        }));
      }

      return res.json({
        ok: true,
        profile: {
          id: Number(profile.id),
          username: profile.username,
          avatar_url: profile.avatar_url || "/images/Ziren.png",
          status_text: profile.status_text || "",
          bio: profile.bio || "",
          friends_visible: showFriends,
          friends_count: showFriends
            ? Number(countResult.rows[0]?.total) || 0
            : null,
          friends,
        },
      });
    } catch (error) {
      console.error("social public profile error:", error);
      return res.status(500).json({ ok: false, error: "Не удалось загрузить профиль" });
    }
  });

  router.get("/conversations/:friendId", async (req, res) => {
    const friendId = parsePositiveInt(req.params.friendId);
    const beforeId = parsePositiveInt(req.query.before_id);
    const requestedLimit = Number.parseInt(String(req.query.limit || DEFAULT_MESSAGE_LIMIT), 10);
    const limit = Math.max(
      1,
      Math.min(
        MAX_MESSAGE_LIMIT,
        Number.isInteger(requestedLimit) ? requestedLimit : DEFAULT_MESSAGE_LIMIT,
      ),
    );

    if (!friendId) {
      return res.status(400).json({ ok: false, error: "Некорректный друг" });
    }

    try {
      await requireAcceptedFriendship(pool, req.socialUser.id, friendId);
      const values = [req.socialUser.id, friendId, limit];
      let beforeClause = "";

      if (beforeId) {
        values.push(beforeId);
        beforeClause = `AND id < $${values.length}`;
      }

      const result = await pool.query(
        `
        SELECT id, sender_id, recipient_id, kind, body,
               attachment_public_id, attachment_format,
               created_at, read_at
        FROM direct_messages
        WHERE (
          (sender_id = $1 AND recipient_id = $2)
          OR
          (sender_id = $2 AND recipient_id = $1)
        )
        ${beforeClause}
        ORDER BY id DESC
        LIMIT $3
        `,
        values,
      );

      const messages = result.rows.reverse().map(serializeMessage);
      return res.json({
        ok: true,
        messages,
        next_before_id: messages.length === limit
          ? messages[0]?.id || null
          : null,
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ ok: false, error: error.message });
      }

      console.error("social conversation error:", error);
      return res.status(500).json({ ok: false, error: "Не удалось загрузить переписку" });
    }
  });

  router.post("/messages", async (req, res) => {
    const recipientId = parsePositiveInt(req.body?.recipient_id);
    const kind = String(req.body?.kind || "text").trim().toLowerCase();

    if (!recipientId || !MESSAGE_KINDS.has(kind)) {
      return res.status(400).json({ ok: false, error: "Некорректное сообщение" });
    }

    try {
      await requireAcceptedFriendship(pool, req.socialUser.id, recipientId);
      let body = "";
      let attachmentPublicId = null;
      let attachmentFormat = null;
      let uploadedAttachment = null;

      if (kind === "screenshot") {
        body = normalizeMessageBody(req.body?.body, { required: false });
        uploadedAttachment = await uploadScreenshot(
          cloudinary,
          req.body?.image_data_url,
          req.socialUser.id,
        );
        attachmentPublicId = uploadedAttachment.public_id;
        attachmentFormat = uploadedAttachment.format || "jpg";
      } else {
        body = normalizeMessageBody(req.body?.body);
      }

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
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, sender_id, recipient_id, kind, body,
                    attachment_public_id, attachment_format,
                    created_at, read_at
          `,
          [
            req.socialUser.id,
            recipientId,
            kind,
            body,
            attachmentPublicId,
            attachmentFormat,
          ],
        );

        return res.status(201).json({
          ok: true,
          message: serializeMessage(result.rows[0]),
        });
      } catch (error) {
        if (uploadedAttachment?.public_id) {
          cloudinary.uploader.destroy(
            uploadedAttachment.public_id,
            { resource_type: "image", type: "authenticated" },
            () => {},
          );
        }
        throw error;
      }
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ ok: false, error: error.message });
      }

      if (
        /Сообщение не может|Сообщение слишком|снимок экрана/i.test(
          String(error.message || ""),
        )
      ) {
        return res.status(400).json({ ok: false, error: error.message });
      }

      console.error("social message send error:", error);
      return res.status(500).json({ ok: false, error: "Не удалось отправить сообщение" });
    }
  });

  router.post("/messages/read", async (req, res) => {
    const friendId = parsePositiveInt(req.body?.friend_id);
    const upToId = parsePositiveInt(req.body?.up_to_id);

    if (!friendId) {
      return res.status(400).json({ ok: false, error: "Некорректный друг" });
    }

    try {
      await requireAcceptedFriendship(pool, req.socialUser.id, friendId);
      const values = [req.socialUser.id, friendId];
      let idClause = "";

      if (upToId) {
        values.push(upToId);
        idClause = `AND id <= $${values.length}`;
      }

      const result = await pool.query(
        `
        UPDATE direct_messages
        SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
        WHERE recipient_id = $1
          AND sender_id = $2
          AND read_at IS NULL
          ${idClause}
        RETURNING id
        `,
        values,
      );

      return res.json({
        ok: true,
        marked_read: result.rowCount || 0,
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ ok: false, error: error.message });
      }

      console.error("social mark read error:", error);
      return res.status(500).json({ ok: false, error: "Не удалось отметить сообщения прочитанными" });
    }
  });

  router.get("/announcements", async (req, res) => {
    try {
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
        JOIN friendships relation
          ON relation.user_low_id = LEAST(message.sender_id, message.recipient_id)
          AND relation.user_high_id = GREATEST(message.sender_id, message.recipient_id)
          AND relation.status = '${FRIEND_STATUS_ACCEPTED}'
        WHERE message.recipient_id = $1
          AND message.announced_at IS NULL
        ORDER BY message.id ASC
        LIMIT 10
        `,
        [req.socialUser.id],
      );

      return res.json({
        ok: true,
        messages: result.rows.map((row) => ({
          ...serializeMessage(row),
          sender_username: row.sender_username,
          sender_voice_name: row.sender_voice_alias || row.sender_username,
        })),
      });
    } catch (error) {
      console.error("social announcements error:", error);
      return res.status(500).json({ ok: false, error: "Не удалось проверить новые сообщения" });
    }
  });

  router.post("/messages/:id/announced", async (req, res) => {
    const messageId = parsePositiveInt(req.params.id);

    if (!messageId) {
      return res.status(400).json({ ok: false, error: "Некорректное сообщение" });
    }

    try {
      const result = await pool.query(
        `
        UPDATE direct_messages
        SET announced_at = COALESCE(announced_at, CURRENT_TIMESTAMP)
        WHERE id = $1 AND recipient_id = $2
        RETURNING id
        `,
        [messageId, req.socialUser.id],
      );

      if (!result.rows.length) {
        return res.status(404).json({ ok: false, error: "Сообщение не найдено" });
      }

      return res.json({ ok: true });
    } catch (error) {
      console.error("social announcement ack error:", error);
      return res.status(500).json({ ok: false, error: "Не удалось подтвердить озвучивание" });
    }
  });

  router.get("/messages/:id/attachment", async (req, res) => {
    const messageId = parsePositiveInt(req.params.id);

    if (!messageId) {
      return res.status(404).send("Attachment not found");
    }

    try {
      const result = await pool.query(
        `
        SELECT id, sender_id, recipient_id, attachment_public_id,
               attachment_format
        FROM direct_messages
        WHERE id = $1
          AND attachment_public_id IS NOT NULL
          AND (sender_id = $2 OR recipient_id = $2)
        LIMIT 1
        `,
        [messageId, req.socialUser.id],
      );
      const attachment = result.rows[0];

      if (!attachment) {
        return res.status(404).send("Attachment not found");
      }

      const expiresAt = Math.floor(Date.now() / 1000) + 5 * 60;
      let downloadUrl = "";

      if (typeof cloudinary.utils.private_download_url === "function") {
        downloadUrl = cloudinary.utils.private_download_url(
          attachment.attachment_public_id,
          attachment.attachment_format || "jpg",
          {
            resource_type: "image",
            type: "authenticated",
            expires_at: expiresAt,
          },
        );
      } else {
        downloadUrl = cloudinary.url(attachment.attachment_public_id, {
          secure: true,
          resource_type: "image",
          type: "authenticated",
          format: attachment.attachment_format || "jpg",
          sign_url: true,
        });
      }

      res.set("Cache-Control", "private, no-store");
      return res.redirect(downloadUrl);
    } catch (error) {
      console.error("social attachment error:", error);
      return res.status(500).send("Attachment unavailable");
    }
  });

  return router;
}


module.exports = {
  createSocialRouter,
  initSocialSchema,
  listFriends,
  normalizeMessageBody,
  normalizeVoiceAlias,
};
