const express = require("express");

const GROUP_ROLES = new Set(["owner", "admin", "member"]);
const MAX_GROUP_NAME_LENGTH = 80;
const MAX_GROUP_DESCRIPTION_LENGTH = 280;
const MAX_GROUP_MEMBERS = 50;
const MAX_MESSAGE_LENGTH = 4_000;
const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 100;

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parsePositiveInt(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeGroupName(value) {
  const name = normalizeWhitespace(value);
  if (name.length < 2 || name.length > MAX_GROUP_NAME_LENGTH) {
    const error = new Error("Название группы должно содержать от 2 до 80 символов");
    error.statusCode = 400;
    throw error;
  }
  return name;
}

function normalizeDescription(value) {
  const description = String(value || "").trim();
  if (description.length > MAX_GROUP_DESCRIPTION_LENGTH) {
    const error = new Error("Описание группы слишком длинное");
    error.statusCode = 400;
    throw error;
  }
  return description;
}

function normalizeMessageBody(value) {
  const body = String(value || "").trim();
  if (!body || body.length > MAX_MESSAGE_LENGTH) {
    const error = new Error(
      body ? "Сообщение слишком длинное" : "Сообщение не может быть пустым",
    );
    error.statusCode = 400;
    throw error;
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body)) {
    const error = new Error("Сообщение содержит недопустимые символы");
    error.statusCode = 400;
    throw error;
  }
  return body;
}

function normalizeMemberIds(value, currentUserId) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    const error = new Error("Некорректный список участников");
    error.statusCode = 400;
    throw error;
  }

  const ids = [...new Set(
    value
      .map(parsePositiveInt)
      .filter((id) => id && id !== Number(currentUserId)),
  )];

  if (ids.length > MAX_GROUP_MEMBERS - 1) {
    const error = new Error(`В группе может быть не больше ${MAX_GROUP_MEMBERS} участников`);
    error.statusCode = 400;
    throw error;
  }

  return ids;
}

async function initGroupSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS social_groups (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(${MAX_GROUP_NAME_LENGTH}) NOT NULL,
      description VARCHAR(${MAX_GROUP_DESCRIPTION_LENGTH}) NOT NULL DEFAULT '',
      owner_user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS social_group_members (
      group_id BIGINT NOT NULL REFERENCES social_groups(id) ON DELETE CASCADE,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(16) NOT NULL DEFAULT 'member',
      joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_read_message_id BIGINT,
      PRIMARY KEY(group_id, user_id),
      CHECK (role IN ('owner', 'admin', 'member'))
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_social_group_members_user
    ON social_group_members(user_id, group_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS social_group_messages (
      id BIGSERIAL PRIMARY KEY,
      group_id BIGINT NOT NULL REFERENCES social_groups(id) ON DELETE CASCADE,
      sender_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_social_group_messages_group
    ON social_group_messages(group_id, id DESC);
  `);
}

async function areAcceptedFriends(queryable, userId, targetIds) {
  if (!targetIds.length) return true;

  const result = await queryable.query(
    `
    SELECT COUNT(*)::int AS total
    FROM friendships
    WHERE status = 'accepted'
      AND (
        (user_low_id = $1 AND user_high_id = ANY($2::int[]))
        OR
        (user_high_id = $1 AND user_low_id = ANY($2::int[]))
      )
    `,
    [userId, targetIds],
  );

  return Number(result.rows[0]?.total) === targetIds.length;
}

async function requireMembership(pool, groupId, userId, queryable = pool) {
  const result = await queryable.query(
    `
    SELECT
      group_data.id,
      group_data.name,
      group_data.description,
      group_data.owner_user_id,
      group_data.created_at,
      group_data.updated_at,
      membership.role,
      membership.last_read_message_id
    FROM social_groups group_data
    JOIN social_group_members membership
      ON membership.group_id = group_data.id
    WHERE group_data.id = $1
      AND membership.user_id = $2
    LIMIT 1
    `,
    [groupId, userId],
  );

  const membership = result.rows[0];
  if (!membership) {
    const error = new Error("Группа не найдена или ты больше не являешься участником");
    error.statusCode = 404;
    throw error;
  }
  return membership;
}

async function listGroups(pool, userId) {
  const result = await pool.query(
    `
    SELECT
      group_data.id,
      group_data.name,
      group_data.description,
      group_data.owner_user_id,
      group_data.created_at,
      membership.role,
      membership.last_read_message_id,
      (
        SELECT COUNT(*)::int
        FROM social_group_members member_count
        WHERE member_count.group_id = group_data.id
      ) AS member_count,
      (
        SELECT MAX(message.created_at)
        FROM social_group_messages message
        WHERE message.group_id = group_data.id
      ) AS last_message_at,
      (
        SELECT message.body
        FROM social_group_messages message
        WHERE message.group_id = group_data.id
        ORDER BY message.id DESC
        LIMIT 1
      ) AS last_message_body,
      (
        SELECT COUNT(*)::int
        FROM social_group_messages message
        WHERE message.group_id = group_data.id
          AND message.id > COALESCE(membership.last_read_message_id, 0)
          AND message.sender_id <> $1
      ) AS unread_count
    FROM social_group_members membership
    JOIN social_groups group_data
      ON group_data.id = membership.group_id
    WHERE membership.user_id = $1
    ORDER BY last_message_at DESC NULLS LAST, group_data.updated_at DESC, group_data.id DESC
    `,
    [userId],
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    description: row.description || "",
    owner_user_id: Number(row.owner_user_id),
    role: row.role,
    member_count: Number(row.member_count) || 0,
    unread_count: Number(row.unread_count) || 0,
    last_message_at: row.last_message_at || null,
    last_message_body: row.last_message_body || "",
    created_at: row.created_at,
  }));
}

function serializeGroupMessage(row) {
  return {
    id: Number(row.id),
    group_id: Number(row.group_id),
    sender_id: Number(row.sender_id),
    sender_username: row.sender_username,
    sender_avatar_url: row.sender_avatar_url || "/images/Ziren.png",
    body: row.body || "",
    created_at: row.created_at,
  };
}

function createGroupRouter({ pool, resolveUser }) {
  if (!pool || typeof resolveUser !== "function") {
    throw new Error("Group router dependencies are not configured");
  }

  const router = express.Router();

  router.use(async (req, res, next) => {
    try {
      const user = await resolveUser(req);
      if (!user) {
        return res.status(401).json({ ok: false, error: "Not authenticated" });
      }
      req.socialUser = user;
      return next();
    } catch (error) {
      console.error("group auth error:", error);
      return res.status(503).json({ ok: false, error: "Group service authentication unavailable" });
    }
  });

  router.get("/", async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      return res.json({
        ok: true,
        groups: await listGroups(pool, req.socialUser.id),
      });
    } catch (error) {
      console.error("group list error:", error);
      return res.status(500).json({ ok: false, error: "Не удалось загрузить группы" });
    }
  });

  router.post("/", async (req, res) => {
    let name;
    let description;
    let memberIds;
    try {
      name = normalizeGroupName(req.body?.name);
      description = normalizeDescription(req.body?.description);
      memberIds = normalizeMemberIds(req.body?.member_ids, req.socialUser.id);
    } catch (error) {
      return res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (!await areAcceptedFriends(client, req.socialUser.id, memberIds)) {
        await client.query("ROLLBACK");
        return res.status(403).json({
          ok: false,
          error: "В новую группу можно добавить только пользователей из твоего списка друзей",
        });
      }

      const groupResult = await client.query(
        `
        INSERT INTO social_groups (name, description, owner_user_id)
        VALUES ($1, $2, $3)
        RETURNING id, name, description, owner_user_id, created_at
        `,
        [name, description, req.socialUser.id],
      );
      const group = groupResult.rows[0];

      await client.query(
        `
        INSERT INTO social_group_members (group_id, user_id, role)
        VALUES ($1, $2, 'owner')
        `,
        [group.id, req.socialUser.id],
      );

      for (const memberId of memberIds) {
        await client.query(
          `
          INSERT INTO social_group_members (group_id, user_id, role)
          VALUES ($1, $2, 'member')
          `,
          [group.id, memberId],
        );
      }

      await client.query("COMMIT");
      return res.status(201).json({
        ok: true,
        group: {
          id: Number(group.id),
          name: group.name,
          description: group.description || "",
          owner_user_id: Number(group.owner_user_id),
          role: "owner",
          member_count: memberIds.length + 1,
          unread_count: 0,
          last_message_at: null,
          last_message_body: "",
          created_at: group.created_at,
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("group create error:", error);
      return res.status(500).json({ ok: false, error: "Не удалось создать группу" });
    } finally {
      client.release();
    }
  });

  router.get("/:groupId", async (req, res) => {
    const groupId = parsePositiveInt(req.params.groupId);
    if (!groupId) return res.status(400).json({ ok: false, error: "Некорректная группа" });

    try {
      const group = await requireMembership(pool, groupId, req.socialUser.id);
      const membersResult = await pool.query(
        `
        SELECT
          member.user_id,
          member.role,
          member.joined_at,
          account.username,
          account.avatar_url,
          account.public_profile_enabled
        FROM social_group_members member
        JOIN users account ON account.id = member.user_id
        WHERE member.group_id = $1
        ORDER BY
          CASE member.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
          LOWER(account.username), account.id
        `,
        [groupId],
      );

      res.set("Cache-Control", "no-store");
      return res.json({
        ok: true,
        group: {
          id: Number(group.id),
          name: group.name,
          description: group.description || "",
          owner_user_id: Number(group.owner_user_id),
          role: group.role,
          created_at: group.created_at,
          members: membersResult.rows.map((member) => ({
            id: Number(member.user_id),
            username: member.username,
            avatar_url: member.avatar_url || "/images/Ziren.png",
            role: member.role,
            joined_at: member.joined_at,
            public_profile_url: member.public_profile_enabled
              ? `/community/${member.user_id}`
              : null,
          })),
        },
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        ok: false,
        error: error.statusCode ? error.message : "Не удалось загрузить группу",
      });
    }
  });

  router.patch("/:groupId", async (req, res) => {
    const groupId = parsePositiveInt(req.params.groupId);
    if (!groupId) return res.status(400).json({ ok: false, error: "Некорректная группа" });

    try {
      const group = await requireMembership(pool, groupId, req.socialUser.id);
      if (!new Set(["owner", "admin"]).has(group.role)) {
        return res.status(403).json({ ok: false, error: "Недостаточно прав для изменения группы" });
      }
      const name = normalizeGroupName(req.body?.name ?? group.name);
      const description = normalizeDescription(req.body?.description ?? group.description);
      await pool.query(
        `
        UPDATE social_groups
        SET name = $1, description = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        `,
        [name, description, groupId],
      );
      return res.json({ ok: true });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        ok: false,
        error: error.statusCode ? error.message : "Не удалось изменить группу",
      });
    }
  });

  router.delete("/:groupId", async (req, res) => {
    const groupId = parsePositiveInt(req.params.groupId);
    if (!groupId) return res.status(400).json({ ok: false, error: "Некорректная группа" });

    try {
      const group = await requireMembership(pool, groupId, req.socialUser.id);
      if (group.role !== "owner") {
        return res.status(403).json({ ok: false, error: "Удалить группу может только владелец" });
      }
      await pool.query("DELETE FROM social_groups WHERE id = $1", [groupId]);
      return res.json({ ok: true });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        ok: false,
        error: error.statusCode ? error.message : "Не удалось удалить группу",
      });
    }
  });

  router.post("/:groupId/members", async (req, res) => {
    const groupId = parsePositiveInt(req.params.groupId);
    const userId = parsePositiveInt(req.body?.user_id);
    if (!groupId || !userId) {
      return res.status(400).json({ ok: false, error: "Некорректный участник" });
    }

    try {
      const group = await requireMembership(pool, groupId, req.socialUser.id);
      if (!new Set(["owner", "admin"]).has(group.role)) {
        return res.status(403).json({ ok: false, error: "Добавлять участников могут только владелец и администраторы" });
      }
      if (!await areAcceptedFriends(pool, req.socialUser.id, [userId])) {
        return res.status(403).json({ ok: false, error: "Добавить можно только пользователя из своих друзей" });
      }
      const countResult = await pool.query(
        "SELECT COUNT(*)::int AS total FROM social_group_members WHERE group_id = $1",
        [groupId],
      );
      if (Number(countResult.rows[0]?.total) >= MAX_GROUP_MEMBERS) {
        return res.status(409).json({ ok: false, error: "Группа уже достигла лимита участников" });
      }
      await pool.query(
        `
        INSERT INTO social_group_members (group_id, user_id, role)
        VALUES ($1, $2, 'member')
        ON CONFLICT (group_id, user_id) DO NOTHING
        `,
        [groupId, userId],
      );
      return res.json({ ok: true });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        ok: false,
        error: error.statusCode ? error.message : "Не удалось добавить участника",
      });
    }
  });

  router.patch("/:groupId/members/:userId", async (req, res) => {
    const groupId = parsePositiveInt(req.params.groupId);
    const userId = parsePositiveInt(req.params.userId);
    const role = String(req.body?.role || "").trim().toLowerCase();
    if (!groupId || !userId || !GROUP_ROLES.has(role) || role === "owner") {
      return res.status(400).json({ ok: false, error: "Некорректная роль участника" });
    }

    try {
      const group = await requireMembership(pool, groupId, req.socialUser.id);
      if (group.role !== "owner") {
        return res.status(403).json({ ok: false, error: "Назначать администраторов может только владелец" });
      }
      if (userId === Number(group.owner_user_id)) {
        return res.status(400).json({ ok: false, error: "Роль владельца изменить нельзя" });
      }
      const result = await pool.query(
        `
        UPDATE social_group_members
        SET role = $1
        WHERE group_id = $2 AND user_id = $3
        RETURNING user_id
        `,
        [role, groupId, userId],
      );
      if (!result.rows.length) {
        return res.status(404).json({ ok: false, error: "Участник не найден" });
      }
      return res.json({ ok: true });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        ok: false,
        error: error.statusCode ? error.message : "Не удалось изменить роль",
      });
    }
  });

  router.delete("/:groupId/members/:userId", async (req, res) => {
    const groupId = parsePositiveInt(req.params.groupId);
    const userId = parsePositiveInt(req.params.userId);
    if (!groupId || !userId) {
      return res.status(400).json({ ok: false, error: "Некорректный участник" });
    }

    try {
      const group = await requireMembership(pool, groupId, req.socialUser.id);
      const selfLeave = userId === Number(req.socialUser.id);
      if (userId === Number(group.owner_user_id)) {
        return res.status(400).json({ ok: false, error: "Владелец не может покинуть группу. Сначала удали группу." });
      }
      if (!selfLeave && !new Set(["owner", "admin"]).has(group.role)) {
        return res.status(403).json({ ok: false, error: "Недостаточно прав для удаления участника" });
      }
      if (!selfLeave && group.role === "admin") {
        const targetResult = await pool.query(
          "SELECT role FROM social_group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1",
          [groupId, userId],
        );
        if (targetResult.rows[0]?.role !== "member") {
          return res.status(403).json({ ok: false, error: "Администратор может удалять только обычных участников" });
        }
      }
      const result = await pool.query(
        "DELETE FROM social_group_members WHERE group_id = $1 AND user_id = $2 RETURNING user_id",
        [groupId, userId],
      );
      if (!result.rows.length) {
        return res.status(404).json({ ok: false, error: "Участник не найден" });
      }
      return res.json({ ok: true });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        ok: false,
        error: error.statusCode ? error.message : "Не удалось удалить участника",
      });
    }
  });

  router.get("/:groupId/messages", async (req, res) => {
    const groupId = parsePositiveInt(req.params.groupId);
    const beforeId = parsePositiveInt(req.query.before_id);
    const requestedLimit = Number.parseInt(String(req.query.limit || DEFAULT_MESSAGE_LIMIT), 10);
    const limit = Math.max(1, Math.min(MAX_MESSAGE_LIMIT, Number.isInteger(requestedLimit) ? requestedLimit : DEFAULT_MESSAGE_LIMIT));
    if (!groupId) return res.status(400).json({ ok: false, error: "Некорректная группа" });

    try {
      await requireMembership(pool, groupId, req.socialUser.id);
      const values = [groupId, limit];
      let beforeClause = "";
      if (beforeId) {
        values.push(beforeId);
        beforeClause = `AND message.id < $${values.length}`;
      }
      const result = await pool.query(
        `
        SELECT
          message.id,
          message.group_id,
          message.sender_id,
          message.body,
          message.created_at,
          sender.username AS sender_username,
          sender.avatar_url AS sender_avatar_url
        FROM social_group_messages message
        JOIN users sender ON sender.id = message.sender_id
        WHERE message.group_id = $1
          ${beforeClause}
        ORDER BY message.id DESC
        LIMIT $2
        `,
        values,
      );
      const messages = result.rows.reverse().map(serializeGroupMessage);
      return res.json({
        ok: true,
        messages,
        next_before_id: messages.length === limit ? messages[0]?.id || null : null,
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        ok: false,
        error: error.statusCode ? error.message : "Не удалось загрузить сообщения группы",
      });
    }
  });

  router.post("/:groupId/messages", async (req, res) => {
    const groupId = parsePositiveInt(req.params.groupId);
    if (!groupId) return res.status(400).json({ ok: false, error: "Некорректная группа" });

    try {
      await requireMembership(pool, groupId, req.socialUser.id);
      const body = normalizeMessageBody(req.body?.body);
      const result = await pool.query(
        `
        INSERT INTO social_group_messages (group_id, sender_id, body)
        VALUES ($1, $2, $3)
        RETURNING id, group_id, sender_id, body, created_at
        `,
        [groupId, req.socialUser.id, body],
      );
      const row = result.rows[0];
      return res.status(201).json({
        ok: true,
        message: {
          id: Number(row.id),
          group_id: Number(row.group_id),
          sender_id: Number(row.sender_id),
          sender_username: req.socialUser.username,
          sender_avatar_url: req.socialUser.avatar_url || "/images/Ziren.png",
          body: row.body,
          created_at: row.created_at,
        },
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        ok: false,
        error: error.statusCode ? error.message : "Не удалось отправить сообщение в группу",
      });
    }
  });

  router.post("/:groupId/read", async (req, res) => {
    const groupId = parsePositiveInt(req.params.groupId);
    const upToId = parsePositiveInt(req.body?.up_to_id);
    if (!groupId) return res.status(400).json({ ok: false, error: "Некорректная группа" });

    try {
      await requireMembership(pool, groupId, req.socialUser.id);
      let resolvedId = upToId;
      if (resolvedId) {
        const exists = await pool.query(
          "SELECT id FROM social_group_messages WHERE group_id = $1 AND id = $2 LIMIT 1",
          [groupId, resolvedId],
        );
        if (!exists.rows.length) resolvedId = null;
      }
      if (!resolvedId) {
        const latest = await pool.query(
          "SELECT MAX(id)::bigint AS id FROM social_group_messages WHERE group_id = $1",
          [groupId],
        );
        resolvedId = latest.rows[0]?.id ? Number(latest.rows[0].id) : null;
      }
      if (resolvedId) {
        await pool.query(
          `
          UPDATE social_group_members
          SET last_read_message_id = GREATEST(COALESCE(last_read_message_id, 0), $1)
          WHERE group_id = $2 AND user_id = $3
          `,
          [resolvedId, groupId, req.socialUser.id],
        );
      }
      return res.json({ ok: true, up_to_id: resolvedId });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        ok: false,
        error: error.statusCode ? error.message : "Не удалось отметить группу прочитанной",
      });
    }
  });

  return router;
}

module.exports = {
  createGroupRouter,
  initGroupSchema,
  normalizeGroupName,
};
