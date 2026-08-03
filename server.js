const express = require("express");
const path = require("path");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const multer = require("multer");
const { rateLimit } = require("express-rate-limit");
const { v2: cloudinary } = require("cloudinary");
const { Pool } = require("pg");
const {
  extractBearerToken,
  hashDesktopToken,
  parseAllowedOrigins,
} = require("./lib/security");
const {
  buildProfileSummary,
  buildUserPayload,
} = require("./lib/profile");
const { renderProfilePage } = require("./lib/profile-page");
const { sendApiNotFound } = require("./lib/api-response");
const {
  applyStoryChoice,
  buildPublicStoryState,
  buildStoryContext,
  createInitialStoryState,
  inferStorySignalFromMessage,
  normalizeCompanionName,
  normalizeStorySignal,
  normalizeStoryState,
  recordStoryTurn,
  setStoryMode,
} = require("./lib/melissa-story");
const {
  buildActivityContext,
  buildCapabilityContext,
} = require("./lib/activity-context");
const { validateScreenshotDataUrl } = require("./lib/screenshot");
const { normalizeDrawingRequest } = require("./lib/drawing-request");
const {
  normalizeScreenAnalysisResponse,
} = require("./lib/screen-analysis");
require("dotenv").config();
const app = express();

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SESSION_SECRET = String(process.env.SESSION_SECRET || "").trim();
const AI_SERVICE_URL = String(process.env.AI_SERVICE_URL || "").trim();
const AI_INTERNAL_TOKEN = String(process.env.AI_INTERNAL_TOKEN || "").trim();
const CORS_ALLOWED_ORIGINS = parseAllowedOrigins(
  process.env.CORS_ALLOWED_ORIGINS,
);
const ASSISTANT_MAX_MESSAGE_LENGTH = 10_000;
const ASSISTANT_MAX_SCREEN_MESSAGE_LENGTH = 2_000;
const PERSONA_PRESET_OPTIONS = [
  {
    id: "cute",
    title: "Заботливая",
    description: "Тёплая, мягкая и внимательная манера общения.",
  },
  {
    id: "calm",
    title: "Спокойная",
    description: "Уравновешенные и чёткие ответы без лишних эмоций.",
  },
  {
    id: "spicy",
    title: "Дерзкая",
    description: "Игривый характер, острый юмор и уверенный тон.",
  },
  {
    id: "friend",
    title: "Подруга",
    description: "Живое дружеское общение, шутки и прямые ответы.",
  },
  {
    id: "shy_love",
    title: "Застенчивая",
    description: "Мягкая, немного неловкая и сдержанная в эмоциях.",
  },
  {
    id: "aggressive",
    title: "Резкая",
    description: "Коротко, жёстко и без стремления всегда соглашаться.",
  },
];
const PERSONA_PRESET_IDS = new Set(
  PERSONA_PRESET_OPTIONS.map((preset) => preset.id),
);
const ALLOWED_ACTIVITY_EVENT_TYPES = new Set([
  "assistant.started",
  "command.completed",
  "app.launched",
  "media.started",
  "media.paused",
  "session.ended",
]);
const FEATURE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/;

const desktopLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({
    ok: false,
    error: "Слишком много попыток входа. Попробуйте позже.",
  }),
});

const webAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => res
    .status(429)
    .send("Слишком много попыток. Попробуйте снова через 15 минут."),
});

const assistantApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({
    error: "Слишком много запросов к ассистенту. Попробуйте немного позже.",
  }),
});

const communityApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 90,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

const activityApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 180,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({
    ok: false,
    error: "Слишком много событий активности",
  }),
});

const visionApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 12,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({
    error: "Слишком много запросов анализа экрана. Попробуйте немного позже.",
  }),
});

const drawingApiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({
    error: "Лимит рисунков на этот час исчерпан. Попробуйте позже.",
  }),
});

if (IS_PRODUCTION && !SESSION_SECRET) {
  throw new Error("SESSION_SECRET is required in production");
}


cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const uploadAvatar = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 1024 * 1024 * 5,
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Можно загружать только изображения"));
    }

    cb(null, true);
  },
});

function uploadBufferToCloudinary(fileBuffer, userId) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "ziren/avatars",
        public_id: `user_${userId}_${Date.now()}`,
        overwrite: true,
        resource_type: "image",
        transformation: [
          {
            width: 512,
            height: 512,
            crop: "fill",
            gravity: "face",
            quality: "auto",
            fetch_format: "auto",
          },
        ],
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(result);
      }
    );

    stream.end(fileBuffer);
  });
}


app.use((req, res, next) => {
  const origin = String(req.headers.origin || "");

  if (origin && CORS_ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    if (origin && !CORS_ALLOWED_ORIGINS.has(origin)) {
      return res.status(403).json({ error: "Origin is not allowed" });
    }

    return res.sendStatus(204);
  }

  next();
});
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);

// Railway usually provides DATABASE_URL automatically from Postgres
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

app.use("/api/assistant/vision", express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.use((req, res, next) => {
  if (req.hostname.includes("railway.app")) {
    res.set("X-Robots-Tag", "noindex");
  }
  next();
});

app.use(
  session({
    name: "ziren.sid",
    store: new pgSession({
      pool: pool,
      tableName: "user_sessions",
      createTableIfMissing: true
    }),
    secret: SESSION_SECRET || "ziren-development-only-secret",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: true,
    cookie: {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 30,
      path: "/"
    }
  })
);

app.use("/api/assistant", assistantApiLimiter);

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) NOT NULL,
      email VARCHAR(150) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS avatar_url TEXT;
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS bio VARCHAR(280) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS status_text VARCHAR(80) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS public_profile_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS show_in_community BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS activity_tracking_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS ai_context_enabled BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      sid varchar NOT NULL COLLATE "default",
      sess json NOT NULL,
      expire timestamp(6) NOT NULL
    )
    WITH (OIDS=FALSE);
  `);

  await pool.query(`
    ALTER TABLE user_sessions
    DROP CONSTRAINT IF EXISTS session_pkey;
  `);

  await pool.query(`
    ALTER TABLE user_sessions
    ADD CONSTRAINT session_pkey PRIMARY KEY (sid);
  `).catch(() => {});

  await pool.query(`
    CREATE INDEX IF NOT EXISTS IDX_user_sessions_expire
    ON user_sessions (expire);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS desktop_sessions (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash VARCHAR(255) NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP NOT NULL
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_desktop_sessions_user_id
    ON desktop_sessions(user_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_desktop_sessions_expires_at
    ON desktop_sessions(expires_at);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_commands (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      command_text VARCHAR(255) NOT NULL,
      used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_commands_user_used_at
    ON user_commands(user_id, used_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_activity_events (
      id BIGSERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_type VARCHAR(64) NOT NULL,
      feature_id VARCHAR(100) NOT NULL,
      subject_label VARCHAR(120),
      ai_context_allowed BOOLEAN NOT NULL DEFAULT FALSE,
      occurred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_activity_events_user_occurred
    ON user_activity_events(user_id, occurred_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS melissa_story_states (
      user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      state JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS melissa_story_events (
      id BIGSERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      choice_id VARCHAR(64) NOT NULL,
      option_id VARCHAR(64) NOT NULL,
      event_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, choice_id)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_melissa_story_events_user_created
    ON melissa_story_events(user_id, created_at DESC);
  `);
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login.html");
  }
  next();
}

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }

  return req.session.csrfToken;
}

function requireCsrf(req, res, next) {
  const expected = String(req.session.csrfToken || "");
  const submitted = String(req.body?.csrf_token || "");

  if (!expected || !submitted || expected.length !== submitted.length) {
    return res.status(403).send("Недействительный защитный токен формы");
  }

  const isValid = crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(submitted),
  );

  if (!isValid) {
    return res.status(403).send("Недействительный защитный токен формы");
  }

  return next();
}

async function readAssistantResponse(response) {
  const text = await response.text();

  if (!text) {
    if (response.ok) {
      return { ok: true };
    }

    const error = new Error("AI service returned an empty error response");
    error.code = "AI_SERVICE_INVALID_RESPONSE";
    throw error;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    const invalidResponseError = new Error(
      "AI service returned a non-JSON response",
    );
    invalidResponseError.code = "AI_SERVICE_INVALID_RESPONSE";
    throw invalidResponseError;
  }
}


function createDesktopToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function getDesktopUserByToken(req) {
  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    return null;
  }

  const tokenHash = hashDesktopToken(token);

  const result = await pool.query(
    `
    SELECT users.id, users.username, users.email, users.avatar_url,
           users.created_at, users.last_login_at, users.bio,
           users.status_text, users.public_profile_enabled,
           users.show_in_community, users.activity_tracking_enabled,
           users.ai_context_enabled
    FROM desktop_sessions
    JOIN users ON users.id = desktop_sessions.user_id
    WHERE desktop_sessions.token_hash = $1
    AND desktop_sessions.expires_at > CURRENT_TIMESTAMP
    LIMIT 1
    `,
    [tokenHash]
  );

  return result.rows[0] || null;
}

async function getUserById(userId) {
  const result = await pool.query(
    `
    SELECT id, username, email, avatar_url, created_at, last_login_at,
           bio, status_text, public_profile_enabled, show_in_community,
           activity_tracking_enabled, ai_context_enabled
    FROM users
    WHERE id = $1
    LIMIT 1
    `,
    [userId],
  );

  return result.rows[0] || null;
}

async function getUserStats(userId) {
  const result = await pool.query(
    `
    SELECT
      COUNT(*)::int AS total_commands,
      COUNT(DISTINCT command_text)::int AS distinct_commands
    FROM user_commands
    WHERE user_id = $1
    `,
    [userId],
  );

  return result.rows[0] || {
    total_commands: 0,
    distinct_commands: 0,
  };
}

async function getUserPayload(user) {
  const stats = await getUserStats(user.id);
  return buildUserPayload(user, stats);
}

async function getTopCommands(userId) {
  const result = await pool.query(
    `
    SELECT command_text, COUNT(*)::int AS uses
    FROM user_commands
    WHERE user_id = $1
    GROUP BY command_text
    ORDER BY uses DESC, command_text ASC
    LIMIT 5
    `,
    [userId],
  );

  return result.rows;
}

async function getRecentAiActivity(userId) {
  const user = await getUserById(userId);

  if (!user?.activity_tracking_enabled || !user.ai_context_enabled) {
    return [];
  }

  const result = await pool.query(
    `
    SELECT event_type, feature_id, subject_label, occurred_at
    FROM user_activity_events
    WHERE user_id = $1
      AND ai_context_allowed = TRUE
    ORDER BY occurred_at DESC, id DESC
    LIMIT 8
    `,
    [userId],
  );

  return result.rows;
}

async function ensureMelissaStoryState(userId, queryable = pool) {
  const initialState = createInitialStoryState();

  await queryable.query(
    `
    INSERT INTO melissa_story_states (user_id, state)
    VALUES ($1, $2::jsonb)
    ON CONFLICT (user_id) DO NOTHING
    `,
    [userId, JSON.stringify(initialState)],
  );

  const result = await queryable.query(
    `
    SELECT state
    FROM melissa_story_states
    WHERE user_id = $1
    LIMIT 1
    `,
    [userId],
  );

  return normalizeStoryState(result.rows[0]?.state || initialState);
}

async function recordMelissaStoryChoice(
  userId,
  choiceId,
  optionId,
  customName,
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await ensureMelissaStoryState(userId, client);

    const lockedResult = await client.query(
      `
      SELECT state
      FROM melissa_story_states
      WHERE user_id = $1
      FOR UPDATE
      `,
      [userId],
    );
    const currentState = normalizeStoryState(lockedResult.rows[0]?.state);
    const transition = applyStoryChoice(
      currentState,
      choiceId,
      optionId,
      customName,
    );

    await client.query(
      `
      UPDATE melissa_story_states
      SET state = $2::jsonb, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
      `,
      [userId, JSON.stringify(transition.state)],
    );

    await client.query(
      `
      INSERT INTO melissa_story_events (
        user_id,
        choice_id,
        option_id,
        event_data
      )
      VALUES ($1, $2, $3, $4::jsonb)
      `,
      [
        userId,
        transition.event.choice_id,
        transition.event.option_id,
        JSON.stringify(transition.event),
      ],
    );

    await client.query("COMMIT");
    return transition.state;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function applyStorySignalSafely(userId, rawSignal) {
  const signal = normalizeStorySignal(rawSignal);

  if (!signal) {
    return null;
  }

  try {
    return await recordMelissaStoryChoice(
      userId,
      signal.choice_id,
      signal.option_id,
      signal.custom_name,
    );
  } catch (error) {
    if (
      error.code === "23505"
      || /уже сделан|сейчас недоступен|неизвестн|имя должно/i.test(
        String(error.message || ""),
      )
    ) {
      console.warn("Ignored stale Melissa story signal:", error.message);
      return null;
    }

    throw error;
  }
}

async function recordMelissaStoryConversationTurn(userId) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await ensureMelissaStoryState(userId, client);
    const lockedResult = await client.query(
      `
      SELECT state
      FROM melissa_story_states
      WHERE user_id = $1
      FOR UPDATE
      `,
      [userId],
    );
    const currentState = normalizeStoryState(lockedResult.rows[0]?.state);
    const updatedState = recordStoryTurn(currentState);

    await client.query(
      `
      UPDATE melissa_story_states
      SET state = $2::jsonb, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
      `,
      [userId, JSON.stringify(updatedState)],
    );
    await client.query("COMMIT");
    return updatedState;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateMelissaStoryCompanionName(userId, name) {
  const state = await ensureMelissaStoryState(userId);
  const updatedState = {
    ...state,
    companion_name: normalizeCompanionName(name),
    updated_at: new Date().toISOString(),
  };

  await pool.query(
    `
    UPDATE melissa_story_states
    SET state = $2::jsonb, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = $1
    `,
    [userId, JSON.stringify(updatedState)],
  );

  return updatedState;
}

async function updateMelissaStoryMode(userId, enabled) {
  const state = await ensureMelissaStoryState(userId);
  const updatedState = setStoryMode(state, enabled);

  await pool.query(
    `
    UPDATE melissa_story_states
    SET state = $2::jsonb, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = $1
    `,
    [userId, JSON.stringify(updatedState)],
  );

  return updatedState;
}

async function resetMelissaStoryState(userId) {
  const client = await pool.connect();
  const initialState = createInitialStoryState();

  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM melissa_story_events WHERE user_id = $1",
      [userId],
    );
    await client.query(
      `
      INSERT INTO melissa_story_states (user_id, state)
      VALUES ($1, $2::jsonb)
      ON CONFLICT (user_id) DO UPDATE SET
        state = EXCLUDED.state,
        updated_at = CURRENT_TIMESTAMP
      `,
      [userId, JSON.stringify(initialState)],
    );
    await client.query("COMMIT");
    return initialState;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function requireAssistantAuth(req, res, next) {
  try {
    if (req.session?.user) {
      req.assistantUser = req.session.user;
      req.assistantClientType = "web";
      return next();
    }

    const desktopUser = await getDesktopUserByToken(req);

    if (!desktopUser) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    req.assistantUser = desktopUser;
    req.assistantClientType = "desktop";
    return next();
  } catch (error) {
    console.error("assistant auth error:", error);
    return res.status(500).json({ error: "Authentication service unavailable" });
  }
}


async function assistantFetch(servicePath, options = {}, timeoutMs = 60_000) {
  if (!AI_SERVICE_URL || !AI_INTERNAL_TOKEN) {
    const error = new Error("AI service gateway is not configured");
    error.code = "AI_SERVICE_MISCONFIGURED";
    throw error;
  }

  const baseUrl = AI_SERVICE_URL.replace(/\/+$/, "");
  const normalizedPath = String(servicePath).replace(/^\/+/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(`${baseUrl}/${normalizedPath}`, {
      ...options,
      headers: {
        ...(options.headers || {}),
        "X-Ziren-Internal-Token": AI_INTERNAL_TOKEN,
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}


function sendAssistantError(res, error, context) {
  console.error(`${context}:`, error);

  if (error.code === "AI_SERVICE_MISCONFIGURED") {
    return res.status(503).json({ error: "Assistant service is not configured" });
  }

  if (error.name === "AbortError") {
    return res.status(504).json({ error: "Assistant service timeout" });
  }

  if (error.code === "AI_SERVICE_INVALID_RESPONSE") {
    return res.status(502).json({ error: "Assistant service returned an invalid response" });
  }

  return res.status(502).json({ error: "Assistant service unavailable" });
}


app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/assistant", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "assistant.html"));
});

app.get("/assistant/chat", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "assistant-chat.html"));
});

app.get("/api/me", (req, res) => {
  if (!req.session.user) {
    return res.json({ loggedIn: false });
  }

  return res.json({
    loggedIn: true,
    user: {
      id: req.session.user.id,
      username: req.session.user.username,
      email: req.session.user.email,
    }
  });
});

app.get("/api/community/members", communityApiLimiter, async (_req, res) => {
  try {
    const [membersResult, countResult] = await Promise.all([
      pool.query(`
        SELECT id, username, avatar_url, public_profile_enabled
        FROM users
        WHERE show_in_community = TRUE
        ORDER BY RANDOM()
        LIMIT 24
      `),
      pool.query(`
        SELECT COUNT(*)::int AS total
        FROM users
        WHERE show_in_community = TRUE
      `),
    ]);

    res.set("Cache-Control", "no-store");

    return res.json({
      ok: true,
      total: countResult.rows[0]?.total || 0,
      members: membersResult.rows.map((member) => ({
        username: member.username,
        avatar_url: member.avatar_url || "/images/Ziren.png",
        profile_url: member.public_profile_enabled
          ? `/community/${member.id}`
          : null,
      })),
    });
  } catch (error) {
    console.error("community members error:", error);
    return res.status(503).json({
      ok: false,
      error: "Community service unavailable",
    });
  }
});



app.get("/api/assistant/messages", requireAssistantAuth, async (req, res) => {
  try {
    const response = await assistantFetch(`/messages/${req.assistantUser.id}`);
    const data = await readAssistantResponse(response);
    return res.status(response.status).json(data);
  } catch (error) {
    return sendAssistantError(res, error, "assistant/messages error");
  }
});


app.get("/api/assistant/me", requireAssistantAuth, (req, res) => {
  return res.json({
    ok: true,
    user: {
      id: String(req.assistantUser.id),
      username: req.assistantUser.username,
      email: req.assistantUser.email,
    },
  });
});


app.post("/api/assistant/name", requireAssistantAuth, async (req, res) => {
  try {
    const normalizedName = normalizeCompanionName(req.body.name);
    const response = await assistantFetch(
      `/persona/${req.assistantUser.id}/name`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: normalizedName }),
      },
    );
    const data = await readAssistantResponse(response);

    if (response.ok) {
      await updateMelissaStoryCompanionName(
        req.assistantUser.id,
        normalizedName,
      );
    }

    return res.status(response.status).json(data);
  } catch (error) {
    if (/Имя должно/i.test(String(error.message || ""))) {
      return res.status(400).json({ error: error.message });
    }

    return sendAssistantError(res, error, "assistant/name error");
  }
});

app.get("/api/assistant/story", requireAssistantAuth, async (req, res) => {
  try {
    const state = await ensureMelissaStoryState(req.assistantUser.id);

    res.set("Cache-Control", "no-store");
    return res.json({
      ok: true,
      story: buildPublicStoryState(state),
    });
  } catch (error) {
    console.error("assistant/story error:", error);
    return res.status(500).json({
      ok: false,
      error: "Не удалось загрузить Хронику связи",
    });
  }
});

app.patch(
  "/api/assistant/story/mode",
  requireAssistantAuth,
  async (req, res) => {
    try {
      if (typeof req.body?.enabled !== "boolean") {
        return res.status(400).json({
          ok: false,
          error: "Не выбран режим компаньона",
        });
      }

      const state = await updateMelissaStoryMode(
        req.assistantUser.id,
        req.body.enabled,
      );

      return res.json({
        ok: true,
        story: buildPublicStoryState(state),
      });
    } catch (error) {
      console.error("assistant/story mode error:", error);
      return res.status(500).json({
        ok: false,
        error: "Не удалось переключить режим компаньона",
      });
    }
  },
);

app.post(
  "/api/assistant/story/choices",
  requireAssistantAuth,
  async (req, res) => {
    try {
      const choiceId = String(req.body?.choice_id || "").trim();
      const optionId = String(req.body?.option_id || "").trim();
      const customName = String(req.body?.custom_name || "").trim();

      if (!choiceId || !optionId) {
        return res.status(400).json({
          ok: false,
          error: "Не выбран вариант продолжения",
        });
      }

      const state = await recordMelissaStoryChoice(
        req.assistantUser.id,
        choiceId,
        optionId,
        customName,
      );

      return res.status(201).json({
        ok: true,
        story: buildPublicStoryState(state),
      });
    } catch (error) {
      if (
        error.code === "23505"
        || /уже сделан|сейчас недоступен|неизвестн|имя должно/i.test(
          String(error.message || ""),
        )
      ) {
        return res.status(409).json({
          ok: false,
          error: error.message,
        });
      }

      console.error("assistant/story choice error:", error);
      return res.status(500).json({
        ok: false,
        error: "Не удалось сохранить сюжетный выбор",
      });
    }
  },
);


app.post("/api/assistant/chat", requireAssistantAuth, async (req, res) => {
  try {
    const {
      message,
      session_id = null,
      capabilities = [],
      preceding_assistant_lines = [],
    } = req.body;
    const normalizedMessage = String(message || "").trim();

    if (!normalizedMessage) {
      return res.status(400).json({ error: "Message is required" });
    }

    if (normalizedMessage.length > ASSISTANT_MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: "Message is too long" });
    }

    if (session_id !== null && (!Number.isInteger(session_id) || session_id < 0)) {
      return res.status(400).json({ error: "Invalid session_id" });
    }

    if (
      !Array.isArray(preceding_assistant_lines)
      || preceding_assistant_lines.length > 2
      || preceding_assistant_lines.some(
        (line) =>
          typeof line !== "string"
          || !line.trim()
          || line.trim().length > 600
          || /[\u0000-\u001f\u007f]/.test(line),
      )
    ) {
      return res.status(400).json({
        error: "Invalid preceding assistant context",
      });
    }

    const [storyState, activityEvents] = await Promise.all([
      ensureMelissaStoryState(req.assistantUser.id),
      getRecentAiActivity(req.assistantUser.id),
    ]);
    const response = await assistantFetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: req.assistantUser.id,
        message: normalizedMessage,
        session_id,
        preceding_assistant_lines: preceding_assistant_lines.map(
          (line) => line.trim(),
        ),
        story_mode_enabled: storyState.story_mode_enabled,
        companion_name: storyState.companion_name,
        story_context: storyState.story_mode_enabled
          ? buildStoryContext(storyState)
          : null,
        activity_context: buildActivityContext(activityEvents),
        capability_context: buildCapabilityContext(capabilities),
        drawing_enabled: req.assistantClientType === "desktop",
      }),
    });
    const data = await readAssistantResponse(response);

    if (response.ok && storyState.story_mode_enabled && data) {
      let updatedState = data.story_signal
        ? await applyStorySignalSafely(
            req.assistantUser.id,
            data.story_signal,
          )
        : null;

      if (!updatedState) {
        const inferredSignal = inferStorySignalFromMessage(
          storyState,
          normalizedMessage,
        );

        if (inferredSignal) {
          updatedState = await applyStorySignalSafely(
            req.assistantUser.id,
            inferredSignal,
          );
        }
      }

      if (updatedState) {
        data.story_updated = true;
        data.story = buildPublicStoryState(updatedState);
      } else {
        const momentumState = await recordMelissaStoryConversationTurn(
          req.assistantUser.id,
        );
        data.story_momentum_updated = true;
        data.story = buildPublicStoryState(momentumState);
      }
    }

    if (data && typeof data === "object") {
      delete data.story_signal;
    }

    return res.status(response.status).json(data);
  } catch (error) {
    return sendAssistantError(res, error, "assistant/chat error");
  }
});

app.post(
  "/api/assistant/drawings/generate",
  requireAssistantAuth,
  drawingApiLimiter,
  async (req, res) => {
    try {
      const drawingRequest = normalizeDrawingRequest(req.body);

      if (!drawingRequest) {
        return res.status(400).json({
          error: "Некорректное задание на рисунок",
        });
      }

      const response = await assistantFetch(
        "/drawings/generate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: req.assistantUser.id,
            ...drawingRequest,
          }),
        },
        120_000,
      );
      const data = await readAssistantResponse(response);
      return res.status(response.status).json(data);
    } catch (error) {
      return sendAssistantError(
        res,
        error,
        "assistant/drawings/generate error",
      );
    }
  },
);

app.post(
  "/api/assistant/vision",
  visionApiLimiter,
  requireAssistantAuth,
  async (req, res) => {
    try {
      const message = String(req.body?.message || "").trim();
      const imageDataUrl = validateScreenshotDataUrl(
        req.body?.image_data_url,
      );
      const capabilities = req.body?.capabilities || [];
      const precedingAssistantLines = req.body?.preceding_assistant_lines || [];
      const sessionId = req.body?.session_id ?? null;

      if (
        !message
        || message.length > ASSISTANT_MAX_SCREEN_MESSAGE_LENGTH
        || !imageDataUrl
        || (
          sessionId !== null
          && (!Number.isInteger(sessionId) || sessionId < 0)
        )
        || !Array.isArray(precedingAssistantLines)
        || precedingAssistantLines.length > 2
        || precedingAssistantLines.some(
          (line) =>
            typeof line !== "string"
            || !line.trim()
            || line.trim().length > 600
            || /[\u0000-\u001f\u007f]/.test(line),
        )
      ) {
        return res.status(400).json({
          error: "Некорректный запрос анализа экрана",
        });
      }

      const [storyState, activityEvents] = await Promise.all([
        ensureMelissaStoryState(req.assistantUser.id),
        getRecentAiActivity(req.assistantUser.id),
      ]);
      const response = await assistantFetch("/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: req.assistantUser.id,
          message,
          image_data_url: imageDataUrl,
          session_id: sessionId,
          preceding_assistant_lines: precedingAssistantLines.map(
            (line) => line.trim(),
          ),
          story_mode_enabled: storyState.story_mode_enabled,
          companion_name: storyState.companion_name,
          story_context: storyState.story_mode_enabled
            ? buildStoryContext(storyState)
            : null,
          activity_context: buildActivityContext(activityEvents),
          capability_context: buildCapabilityContext(capabilities),
        }),
      });
      const data = await readAssistantResponse(response);

      if (response.ok) {
        const normalized = normalizeScreenAnalysisResponse(data);
        if (!normalized) {
          return res.status(502).json({
            error: "Некорректный ответ анализа экрана",
          });
        }
        return res.status(response.status).json(normalized);
      }

      return res.status(response.status).json(data);
    } catch (error) {
      return sendAssistantError(res, error, "assistant/vision error");
    }
  },
);

app.post("/api/assistant/reaction", requireAssistantAuth, async (req, res) => {
  try {
    const featureId = String(req.body?.feature_id || "").trim().toLowerCase();
    const subjectLabel = String(req.body?.subject_label || "").trim();
    const resultText = String(req.body?.result_text || "").trim();
    const capabilities = req.body?.capabilities || [];
    const sessionId = req.body?.session_id ?? null;

    if (
      !FEATURE_ID_PATTERN.test(featureId)
      || subjectLabel.length > 120
      || resultText.length > 240
      || /[\u0000-\u001f\u007f]/.test(subjectLabel)
      || /[\u0000-\u001f\u007f]/.test(resultText)
      || (
        sessionId !== null
        && (!Number.isInteger(sessionId) || sessionId < 0)
      )
    ) {
      return res.status(400).json({ error: "Invalid command context" });
    }

    const [user, storyState, activityEvents] = await Promise.all([
      getUserById(req.assistantUser.id),
      ensureMelissaStoryState(req.assistantUser.id),
      getRecentAiActivity(req.assistantUser.id),
    ]);

    if (!user?.activity_tracking_enabled || !user.ai_context_enabled) {
      return res.status(403).json({
        error: "Command reactions require activity context consent",
      });
    }

    const response = await assistantFetch("/reaction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: req.assistantUser.id,
        feature_id: featureId,
        subject_label: subjectLabel,
        result_text: resultText,
        session_id: sessionId,
        story_mode_enabled: storyState.story_mode_enabled,
        companion_name: storyState.companion_name,
        story_context: storyState.story_mode_enabled
          ? buildStoryContext(storyState)
          : null,
        activity_context: buildActivityContext(activityEvents),
        capability_context: buildCapabilityContext(capabilities),
      }),
    });
    const data = await readAssistantResponse(response);
    return res.status(response.status).json(data);
  } catch (error) {
    return sendAssistantError(res, error, "assistant/reaction error");
  }
});

app.post("/api/assistant/proactive", requireAssistantAuth, async (req, res) => {
  try {
    const idleMinutes = Number(req.body?.idle_minutes);
    const capabilities = req.body?.capabilities || [];
    const sessionId = req.body?.session_id ?? null;

    if (
      !Number.isFinite(idleMinutes)
      || idleMinutes < 1
      || idleMinutes > 24 * 60
      || (
        sessionId !== null
        && (!Number.isInteger(sessionId) || sessionId < 0)
      )
    ) {
      return res.status(400).json({ error: "Invalid idle time" });
    }

    const [storyState, activityEvents] = await Promise.all([
      ensureMelissaStoryState(req.assistantUser.id),
      getRecentAiActivity(req.assistantUser.id),
    ]);
    const response = await assistantFetch("/proactive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: req.assistantUser.id,
        idle_minutes: Math.round(idleMinutes),
        session_id: sessionId,
        story_mode_enabled: storyState.story_mode_enabled,
        companion_name: storyState.companion_name,
        story_context: storyState.story_mode_enabled
          ? buildStoryContext(storyState)
          : null,
        activity_context: buildActivityContext(activityEvents),
        capability_context: buildCapabilityContext(capabilities),
      }),
    });
    const data = await readAssistantResponse(response);
    return res.status(response.status).json(data);
  } catch (error) {
    return sendAssistantError(res, error, "assistant/proactive error");
  }
});


app.get("/api/assistant/persona", requireAssistantAuth, async (req, res) => {
  try {
    const [response, storyState] = await Promise.all([
      assistantFetch(`/persona/${req.assistantUser.id}`),
      ensureMelissaStoryState(req.assistantUser.id),
    ]);
    const data = await readAssistantResponse(response);

    if (response.ok && data) {
      if (storyState.story_mode_enabled) {
        data.name = storyState.companion_name;
        data.preset_name = "living_story";
        data.identity = "Живая история · характер развивается в общении";
      }

      data.story_mode = buildPublicStoryState(storyState).story_mode;
    }

    return res.status(response.status).json(data);
  } catch (error) {
    return sendAssistantError(res, error, "assistant/persona error");
  }
});

app.get(
  "/api/assistant/persona/presets",
  requireAssistantAuth,
  async (req, res) => {
    try {
      const [response, storyState] = await Promise.all([
        assistantFetch(`/persona/${req.assistantUser.id}`),
        ensureMelissaStoryState(req.assistantUser.id),
      ]);
      const persona = await readAssistantResponse(response);

      return res.status(response.status).json({
        ok: response.ok,
        selected: storyState.story_mode_enabled
          ? null
          : (persona?.preset_name || "default"),
        presets: PERSONA_PRESET_OPTIONS,
        story_mode: buildPublicStoryState(storyState).story_mode,
      });
    } catch (error) {
      return sendAssistantError(
        res,
        error,
        "assistant/persona presets error",
      );
    }
  },
);


app.post("/api/assistant/preset", requireAssistantAuth, async (req, res) => {
  try {
    const storyState = await ensureMelissaStoryState(req.assistantUser.id);
    const publicStory = buildPublicStoryState(storyState);

    if (storyState.story_mode_enabled) {
      return res.status(409).json({
        ok: false,
        error:
          "В живой истории характер Мелиссы меняется через ваши отношения, а не через пресет.",
        story_mode: publicStory.story_mode,
      });
    }

    const presetName = String(req.body?.preset_name || "").trim();

    if (!PERSONA_PRESET_IDS.has(presetName)) {
      return res.status(400).json({
        ok: false,
        error: "Неизвестный характер компаньона",
      });
    }

    const response = await assistantFetch(
      `/persona/${req.assistantUser.id}/preset`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset_name: presetName }),
      },
    );
    const data = await readAssistantResponse(response);
    return res.status(response.status).json({
      ...data,
      story_mode: publicStory.story_mode,
    });
  } catch (error) {
    return sendAssistantError(res, error, "assistant/preset error");
  }
});


app.get("/api/assistant/memory", requireAssistantAuth, async (req, res) => {
  try {
    const response = await assistantFetch(`/memory/${req.assistantUser.id}`);
    const data = await readAssistantResponse(response);
    return res.status(response.status).json(data);
  } catch (error) {
    return sendAssistantError(res, error, "assistant/memory error");
  }
});


app.post("/api/assistant/memory/clear", requireAssistantAuth, async (req, res) => {
  try {
    const response = await assistantFetch(
      `/memory/${req.assistantUser.id}/clear`,
      { method: "POST" },
    );
    const data = await readAssistantResponse(response);
    return res.status(response.status).json(data);
  } catch (error) {
    return sendAssistantError(res, error, "assistant/memory clear error");
  }
});

app.post("/api/assistant/reset", requireAssistantAuth, async (req, res) => {
  try {
    const response = await assistantFetch(
      `/reset/${req.assistantUser.id}`,
      { method: "POST" },
    );
    const data = await readAssistantResponse(response);

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    const storyState = await resetMelissaStoryState(req.assistantUser.id);

    return res.json({
      ok: true,
      story: buildPublicStoryState(storyState),
      reset: {
        memory: true,
        chats: true,
        chronicle: true,
        persona: true,
        account_stats_preserved: true,
      },
    });
  } catch (error) {
    return sendAssistantError(res, error, "assistant/reset error");
  }
});


app.get("/api/assistant/memory-items", requireAssistantAuth, async (req, res) => {
  try {
    const response = await assistantFetch(`/memory-items/${req.assistantUser.id}`);
    const data = await readAssistantResponse(response);
    return res.status(response.status).json(data);
  } catch (error) {
    return sendAssistantError(res, error, "assistant/memory-items error");
  }
});


app.post("/api/assistant/memory-items", requireAssistantAuth, async (req, res) => {
  try {
    const response = await assistantFetch(
      `/memory-items/${req.assistantUser.id}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body || {}),
      },
    );
    const data = await readAssistantResponse(response);
    return res.status(response.status).json(data);
  } catch (error) {
    return sendAssistantError(res, error, "assistant/memory-items create error");
  }
});


app.patch("/api/assistant/memory-items/:id", requireAssistantAuth, async (req, res) => {
  try {
    const itemId = encodeURIComponent(req.params.id);
    const response = await assistantFetch(
      `/memory-items/${req.assistantUser.id}/${itemId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body || {}),
      },
    );
    const data = await readAssistantResponse(response);
    return res.status(response.status).json(data);
  } catch (error) {
    return sendAssistantError(res, error, "assistant/memory-items update error");
  }
});


app.delete("/api/assistant/memory-items/:id", requireAssistantAuth, async (req, res) => {
  try {
    const itemId = encodeURIComponent(req.params.id);
    const response = await assistantFetch(
      `/memory-items/${req.assistantUser.id}/${itemId}`,
      { method: "DELETE" },
    );
    const data = await readAssistantResponse(response);
    return res.status(response.status).json(data);
  } catch (error) {
    return sendAssistantError(res, error, "assistant/memory-items delete error");
  }
});


app.post("/api/assistant/app-launcher/resolve", requireAssistantAuth, async (req, res) => {
  try {
    const response = await assistantFetch("/app-launcher/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {}),
    });
    const data = await readAssistantResponse(response);
    return res.status(response.status).json(data);
  } catch (error) {
    return sendAssistantError(res, error, "assistant/app-launcher error");
  }
});

app.post("/register", webAuthLimiter, async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const normalizedUsername = String(username || "").trim();
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedPassword = String(password || "");

    if (!normalizedUsername || !normalizedEmail || !normalizedPassword) {
      return res.redirect(
        `/register.html?error=${encodeURIComponent("Заполни все поля")}`,
      );
    }

    if (
      normalizedUsername.length < 2
      || normalizedUsername.length > 32
      || /[\u0000-\u001f\u007f]/.test(normalizedUsername)
    ) {
      return res.redirect(
        `/register.html?error=${encodeURIComponent("Ник должен содержать от 2 до 32 обычных символов")}`,
      );
    }

    if (normalizedEmail.length > 150) {
      return res.redirect(
        `/register.html?error=${encodeURIComponent("Email слишком длинный")}`,
      );
    }

    if (normalizedPassword.length < 8 || normalizedPassword.length > 128) {
      return res.redirect(
        `/register.html?error=${encodeURIComponent("Пароль должен содержать от 8 до 128 символов")}`,
      );
    }

    const existing = await pool.query(
      "SELECT id FROM users WHERE LOWER(email) = $1",
      [normalizedEmail]
    );

    if (existing.rows.length > 0) {
      return res.redirect(
        `/register.html?error=${encodeURIComponent("Пользователь с таким email уже существует")}`,
      );
    }

    const passwordHash = await bcrypt.hash(normalizedPassword, 10);

    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email`,
      [normalizedUsername, normalizedEmail, passwordHash]
    );

    const newUser = result.rows[0];

    req.session.regenerate((err) => {
      if (err) {
        console.error("Session regenerate error:", err);
        return res.status(500).send("Ошибка сессии");
      }

      req.session.user = {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email
      };

      req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30;

      req.session.save((saveErr) => {
        if (saveErr) {
          console.error("Session save error:", saveErr);
          return res.status(500).send("Ошибка сохранения сессии");
        }

        res.redirect("/profile");
      });
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Ошибка сервера при регистрации");
  }
});



app.post("/api/desktop/login", desktopLoginLimiter, async (req, res) => {
  try {
    const { email, password, remember } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        ok: false,
        error: "Введите email и пароль",
      });
    }

    const result = await pool.query(
      `
      SELECT id, username, email, password_hash, avatar_url, created_at,
             last_login_at, bio, status_text, public_profile_enabled,
             show_in_community, activity_tracking_enabled, ai_context_enabled
      FROM users
      WHERE LOWER(email) = $1
      `,
      [String(email).trim().toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        ok: false,
        error: "Неверный email или пароль",
      });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({
        ok: false,
        error: "Неверный email или пароль",
      });
    }

    await pool.query(
      "UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1",
      [user.id]
    );
    user.last_login_at = new Date().toISOString();

    await pool.query(
      "DELETE FROM desktop_sessions WHERE expires_at <= CURRENT_TIMESTAMP"
    );

    const token = createDesktopToken();
    const tokenHash = hashDesktopToken(token);

    const expiresAt = remember
      ? new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)
      : new Date(Date.now() + 1000 * 60 * 60 * 12);

    await pool.query(
      `
      INSERT INTO desktop_sessions (user_id, token_hash, expires_at)
      VALUES ($1, $2, $3)
      `,
      [user.id, tokenHash, expiresAt]
    );

    const userPayload = await getUserPayload(user);

    return res.json({
      ok: true,
      token,
      user: userPayload,
    });
  } catch (error) {
    console.error("desktop login error:", error);

    return res.status(500).json({
      ok: false,
      error: "Ошибка сервера при входе",
    });
  }
});




app.get("/api/desktop/me", async (req, res) => {
  try {
    const user = await getDesktopUserByToken(req);

    if (!user) {
      return res.status(401).json({
        ok: false,
        error: "Invalid session",
      });
    }

    const userPayload = await getUserPayload(user);

    return res.json({
      ok: true,
      user: userPayload,
    });
  } catch (error) {
    console.error("desktop me error:", error);

    return res.status(500).json({
      ok: false,
      error: "Ошибка сервера",
    });
  }
});


app.post("/api/desktop/logout", async (req, res) => {
  try {
    const token = extractBearerToken(req.headers.authorization);

    if (!token) {
      return res.status(401).json({
        ok: false,
        error: "Invalid session",
      });
    }

    await pool.query(
      "DELETE FROM desktop_sessions WHERE token_hash = $1",
      [hashDesktopToken(token)],
    );

    return res.json({ ok: true });
  } catch (error) {
    console.error("desktop logout error:", error);
    return res.status(500).json({
      ok: false,
      error: "Ошибка сервера при выходе",
    });
  }
});


app.post("/api/desktop/avatar", uploadAvatar.single("avatar"), async (req, res) => {
  try {
    const user = await getDesktopUserByToken(req);

    if (!user) {
      return res.status(401).json({
        ok: false,
        error: "Invalid session",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        ok: false,
        error: "Файл не загружен",
      });
    }

    const uploadResult = await uploadBufferToCloudinary(req.file.buffer, user.id);
    const avatarUrl = uploadResult.secure_url;

    await pool.query(
      "UPDATE users SET avatar_url = $1 WHERE id = $2",
      [avatarUrl, user.id]
    );
    user.avatar_url = avatarUrl;
    const userPayload = await getUserPayload(user);

    return res.json({
      ok: true,
      user: userPayload,
    });
  } catch (error) {
    console.error("desktop avatar upload error:", error);

    return res.status(500).json({
      ok: false,
      error: "Ошибка загрузки аватарки",
    });
  }
});

app.post("/api/desktop/activity", activityApiLimiter, async (req, res) => {
  try {
    const user = await getDesktopUserByToken(req);

    if (!user) {
      return res.status(401).json({
        ok: false,
        error: "Invalid session",
      });
    }

    if (!user.activity_tracking_enabled) {
      return res.json({
        ok: true,
        stored: false,
        reason: "activity_tracking_disabled",
      });
    }

    const eventType = String(req.body?.event_type || "").trim();
    const featureId = String(req.body?.feature_id || "").trim().toLowerCase();
    const subjectLabel = String(req.body?.subject_label || "").trim();

    if (!ALLOWED_ACTIVITY_EVENT_TYPES.has(eventType)) {
      return res.status(400).json({
        ok: false,
        error: "Unsupported activity event",
      });
    }

    if (!FEATURE_ID_PATTERN.test(featureId)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid feature_id",
      });
    }

    if (
      subjectLabel.length > 120
      || /[\u0000-\u001f\u007f]/.test(subjectLabel)
    ) {
      return res.status(400).json({
        ok: false,
        error: "Invalid subject_label",
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        `
        INSERT INTO user_activity_events (
          user_id,
          event_type,
          feature_id,
          subject_label,
          ai_context_allowed
        )
        VALUES ($1, $2, $3, $4, $5)
        `,
        [
          user.id,
          eventType,
          featureId,
          user.ai_context_enabled ? (subjectLabel || null) : null,
          Boolean(user.ai_context_enabled),
        ],
      );

      if (eventType === "command.completed") {
        await client.query(
          `
          INSERT INTO user_commands (user_id, command_text)
          VALUES ($1, $2)
          `,
          [user.id, featureId],
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return res.status(201).json({
      ok: true,
      stored: true,
      ai_context_allowed: Boolean(user.ai_context_enabled),
    });
  } catch (error) {
    console.error("desktop activity error:", error);
    return res.status(500).json({
      ok: false,
      error: "Не удалось сохранить событие активности",
    });
  }
});

app.patch("/api/desktop/preferences", activityApiLimiter, async (req, res) => {
  try {
    const user = await getDesktopUserByToken(req);

    if (!user) {
      return res.status(401).json({
        ok: false,
        error: "Invalid session",
      });
    }

    const activityTrackingEnabled = req.body?.activity_tracking_enabled;
    const requestedAiContextEnabled = req.body?.ai_context_enabled;

    if (
      typeof activityTrackingEnabled !== "boolean"
      || typeof requestedAiContextEnabled !== "boolean"
    ) {
      return res.status(400).json({
        ok: false,
        error: "Invalid preferences",
      });
    }

    const aiContextEnabled =
      activityTrackingEnabled && requestedAiContextEnabled;

    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        `
        UPDATE users
        SET activity_tracking_enabled = $1,
            ai_context_enabled = $2
        WHERE id = $3
        `,
        [activityTrackingEnabled, aiContextEnabled, user.id],
      );

      if (!aiContextEnabled) {
        await client.query(
          `
          UPDATE user_activity_events
          SET ai_context_allowed = FALSE
          WHERE user_id = $1
          `,
          [user.id],
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    user.activity_tracking_enabled = activityTrackingEnabled;
    user.ai_context_enabled = aiContextEnabled;

    return res.json({
      ok: true,
      user: await getUserPayload(user),
    });
  } catch (error) {
    console.error("desktop preferences error:", error);
    return res.status(500).json({
      ok: false,
      error: "Не удалось сохранить настройки приватности",
    });
  }
});


app.post("/login", webAuthLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedPassword = String(password || "");

    if (!normalizedEmail || !normalizedPassword) {
      return res.redirect("/login.html?error=Заполни%20email%20и%20пароль");
    }

    const result = await pool.query(
      "SELECT id, username, email, password_hash FROM users WHERE LOWER(email) = $1",
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      return res.redirect("/login.html?error=Неверный%20email%20или%20пароль");
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(
      normalizedPassword,
      user.password_hash,
    );

    if (!isMatch) {
      return res.redirect("/login.html?error=Неверный%20email%20или%20пароль");
    }

    await pool.query(
      "UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1",
      [user.id]
    );

    req.session.regenerate((err) => {
      if (err) {
        console.error("Session regenerate error:", err);
        return res.status(500).send("Ошибка сессии");
      }

      req.session.user = {
        id: user.id,
        username: user.username,
        email: user.email
      };

      req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30;

      req.session.save((saveErr) => {
        if (saveErr) {
          console.error("Session save error:", saveErr);
          return res.status(500).send("Ошибка сохранения сессии");
        }

        res.redirect("/profile");
      });
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Ошибка сервера при входе");
  }
});

app.get("/profile", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const [user, stats, topCommands] = await Promise.all([
      getUserById(userId),
      getUserStats(userId),
      getTopCommands(userId),
    ]);

    if (!user) {
      req.session.destroy(() => {
        res.redirect("/login.html");
      });
      return;
    }

    const summary = buildProfileSummary(user, stats);
    const csrfToken = ensureCsrfToken(req);

    return res.send(
      renderProfilePage({
        user,
        summary,
        topCommands,
        csrfToken,
      }),
    );
  } catch (error) {
    console.error(error);
    res.status(500).send("Ошибка профиля");
  }
});

app.get("/community/:id", async (req, res) => {
  try {
    const userId = Number.parseInt(req.params.id, 10);

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(404).send("Профиль не найден");
    }

    const [user, stats] = await Promise.all([
      getUserById(userId),
      getUserStats(userId),
    ]);

    if (!user || !user.public_profile_enabled) {
      return res.status(404).send("Профиль не найден или закрыт");
    }

    const summary = buildProfileSummary(user, stats);

    res.set("Cache-Control", "private, no-store");
    return res.send(
      renderProfilePage({
        user,
        summary,
        publicView: true,
      }),
    );
  } catch (error) {
    console.error("public profile error:", error);
    return res.status(500).send("Ошибка загрузки профиля");
  }
});

app.post(
  "/profile/settings",
  webAuthLimiter,
  requireAuth,
  requireCsrf,
  async (req, res) => {
    try {
      const statusText = String(req.body.status_text || "").trim();
      const bio = String(req.body.bio || "").trim();

      if (
        statusText.length > 80
        || bio.length > 280
        || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(
          `${statusText}${bio}`,
        )
      ) {
        return res.status(400).send("Некорректные данные профиля");
      }

      const publicProfileEnabled =
        req.body.public_profile_enabled === "true";
      const showInCommunity = req.body.show_in_community === "true";
      const activityTrackingEnabled =
        req.body.activity_tracking_enabled === "true";
      const aiContextEnabled =
        activityTrackingEnabled && req.body.ai_context_enabled === "true";

      await pool.query(
        `
        UPDATE users
        SET bio = $1,
            status_text = $2,
            public_profile_enabled = $3,
            show_in_community = $4,
            activity_tracking_enabled = $5,
            ai_context_enabled = $6
        WHERE id = $7
        `,
        [
          bio,
          statusText,
          publicProfileEnabled,
          showInCommunity,
          activityTrackingEnabled,
          aiContextEnabled,
          req.session.user.id,
        ],
      );

      return res.redirect("/profile");
    } catch (error) {
      console.error("profile settings error:", error);
      return res.status(500).send("Не удалось сохранить настройки профиля");
    }
  },
);

app.post("/upload-avatar", requireAuth, uploadAvatar.single("avatar"), requireCsrf, async (req, res) => {
  try {
    const userId = req.session.user.id;

    if (!req.file) {
      return res.redirect("/profile");
    }

    const uploadResult = await uploadBufferToCloudinary(req.file.buffer, userId);
    const avatarUrl = uploadResult.secure_url;

    await pool.query(
      "UPDATE users SET avatar_url = $1 WHERE id = $2",
      [avatarUrl, userId]
    );

    res.redirect("/profile");
  } catch (error) {
    console.error("avatar upload error:", error);
    res.status(500).send("Ошибка загрузки аватарки");
  }
});

app.get("/logout", (_req, res) => {
  return res.redirect("/profile");
});

app.post("/logout", requireAuth, requireCsrf, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Logout error:", err);
    }

    res.clearCookie("ziren.sid", {
      path: "/",
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: "lax"
    });

    res.redirect("/");
  });
});

app.use("/api", sendApiNotFound);

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("DB init error:", err);
    process.exit(1);
  });
