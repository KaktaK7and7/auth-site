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

if (IS_PRODUCTION && !SESSION_SECRET) {
  throw new Error("SESSION_SECRET is required in production");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login.html");
  }
  next();
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
           users.created_at, users.last_login_at
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


async function requireAssistantAuth(req, res, next) {
  try {
    if (req.session?.user) {
      req.assistantUser = req.session.user;
      return next();
    }

    const desktopUser = await getDesktopUserByToken(req);

    if (!desktopUser) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    req.assistantUser = desktopUser;
    return next();
  } catch (error) {
    console.error("assistant auth error:", error);
    return res.status(500).json({ error: "Authentication service unavailable" });
  }
}


async function assistantFetch(servicePath, options = {}) {
  if (!AI_SERVICE_URL || !AI_INTERNAL_TOKEN) {
    const error = new Error("AI service gateway is not configured");
    error.code = "AI_SERVICE_MISCONFIGURED";
    throw error;
  }

  const baseUrl = AI_SERVICE_URL.replace(/\/+$/, "");
  const normalizedPath = String(servicePath).replace(/^\/+/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

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
      email: req.session.user.email
    }
  });
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
    const response = await assistantFetch(
      `/persona/${req.assistantUser.id}/name`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: req.body.name }),
      },
    );
    const data = await readAssistantResponse(response);
    return res.status(response.status).json(data);
  } catch (error) {
    return sendAssistantError(res, error, "assistant/name error");
  }
});


app.post("/api/assistant/chat", requireAssistantAuth, async (req, res) => {
  try {
    const { message, session_id = null } = req.body;
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

    const response = await assistantFetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: req.assistantUser.id,
        message: normalizedMessage,
        session_id,
      }),
    });
    const data = await readAssistantResponse(response);
    return res.status(response.status).json(data);
  } catch (error) {
    return sendAssistantError(res, error, "assistant/chat error");
  }
});


app.get("/api/assistant/persona", requireAssistantAuth, async (req, res) => {
  try {
    const response = await assistantFetch(`/persona/${req.assistantUser.id}`);
    const data = await readAssistantResponse(response);
    return res.status(response.status).json(data);
  } catch (error) {
    return sendAssistantError(res, error, "assistant/persona error");
  }
});


app.post("/api/assistant/preset", requireAssistantAuth, async (req, res) => {
  try {
    const response = await assistantFetch(
      `/persona/${req.assistantUser.id}/preset`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset_name: req.body.preset_name }),
      },
    );
    const data = await readAssistantResponse(response);
    return res.status(response.status).json(data);
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

    if (!username || !email || !password) {
      return res.redirect("/register.html?error=Заполни%20все%20поля");
    }

    if (password.length < 6) {
      return res.redirect("/register.html?error=Пароль%20должен%20быть%20не%20короче%206%20символов");
    }

    const existing = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );

    if (existing.rows.length > 0) {
      return res.redirect("/register.html?error=Пользователь%20с%20таким%20email%20уже%20существует");
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email`,
      [username, email, passwordHash]
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
      "SELECT id, username, email, password_hash, avatar_url, created_at, last_login_at FROM users WHERE email = $1",
      [email]
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

    return res.json({
      ok: true,
      token,
      user: {
        id: String(user.id),
        username: user.username,
        email: user.email,
        avatar_url: user.avatar_url || "/images/Ziren.png",
        created_at: user.created_at,
        last_login_at: new Date().toISOString(),
      },
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

    return res.json({
      ok: true,
      user: {
        id: String(user.id),
        username: user.username,
        email: user.email,
        avatar_url: user.avatar_url || "/images/Ziren.png",
        created_at: user.created_at,
        last_login_at: user.last_login_at,
      },
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

    return res.json({
      ok: true,
      user: {
        id: String(user.id),
        username: user.username,
        email: user.email,
        avatar_url: avatarUrl,
        created_at: user.created_at,
        last_login_at: user.last_login_at,
      },
    });
  } catch (error) {
    console.error("desktop avatar upload error:", error);

    return res.status(500).json({
      ok: false,
      error: "Ошибка загрузки аватарки",
    });
  }
});


app.post("/login", webAuthLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.redirect("/login.html?error=Заполни%20email%20и%20пароль");
    }

    const result = await pool.query(
      "SELECT id, username, email, password_hash FROM users WHERE email = $1",
      [email]
    );

    if (result.rows.length === 0) {
      return res.redirect("/login.html?error=Неверный%20email%20или%20пароль");
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

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

    const userResult = await pool.query(
      `SELECT id, username, email, created_at, avatar_url, last_login_at
       FROM users
       WHERE id = $1`,
      [userId]
    );

    const statsResult = await pool.query(
      `SELECT COUNT(*)::int AS total_commands
       FROM user_commands
       WHERE user_id = $1`,
      [userId]
    );

    const frequentCommandsResult = await pool.query(
      `SELECT command_text, COUNT(*)::int AS uses
       FROM user_commands
       WHERE user_id = $1
       GROUP BY command_text
       ORDER BY uses DESC, command_text ASC
       LIMIT 5`,
      [userId]
    );

    const user = userResult.rows[0];

    if (!user) {
      req.session.destroy(() => {
        res.redirect("/login.html");
      });
      return;
    }

    const totalCommands = statsResult.rows[0]?.total_commands || 0;
    const frequentCommands = frequentCommandsResult.rows;
    const avatarUrl = escapeHtml(user.avatar_url || "/images/Ziren.png");

    const frequentCommandsHtml = frequentCommands.length
      ? frequentCommands.map((cmd) => `
          <div class="stat-list-item">
            <span>${escapeHtml(cmd.command_text)}</span>
            <strong>${cmd.uses} раз</strong>
          </div>
        `).join("")
      : `<p class="empty-text">Пока команд нет</p>`;

    res.send(`
      <!DOCTYPE html>
      <html lang="ru">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Профиль — Ziren</title>
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>
        <div class="bg-glow glow-1"></div>
        <div class="bg-glow glow-2"></div>

        <header class="header">
          <div class="container nav">
            <a href="/" class="brand">
              <img src="/images/Ziren.png" class="brand-logo" alt="Ziren logo" />
              <span>Ziren</span>
            </a>

            <nav class="nav-links">
              <a href="/">Главная</a>
              <a href="/assistant">Ассистент</a>
              <a href="/profile" class="active-link">Профиль</a>
            </nav>

            <div class="nav-actions">
              <a class="btn btn-secondary" href="/logout">Выйти</a>
            </div>
          </div>
        </header>

        <main class="profile-page">
          <section class="container profile-layout">

            <div class="profile-main-card">
              <div class="profile-top">
                <div class="profile-avatar-wrap">
                  <img src="${avatarUrl}" class="profile-avatar" alt="avatar" />
                </div>

                <div class="profile-user-info">
                  <span class="section-kicker">Личный кабинет</span>
                  <h1>${escapeHtml(user.username)}</h1>
                  <p>${escapeHtml(user.email)}</p>
                  <div class="profile-meta">
                    <span>Регистрация: ${new Date(user.created_at).toLocaleDateString("ru-RU")}</span>
                    <span>Последний вход: ${user.last_login_at ? new Date(user.last_login_at).toLocaleString("ru-RU") : "нет данных"}</span>
                  </div>
                </div>
              </div>

              <div class="profile-actions">
                <form action="/upload-avatar" method="POST" enctype="multipart/form-data" class="avatar-form">
                  <input type="file" name="avatar" accept="image/png,image/jpeg,image/webp" required />
                  <button class="btn btn-primary" type="submit">Сменить аватар</button>
                </form>
              </div>
            </div>

            <div class="profile-stats-grid">
              <div class="profile-stat-card">
                <span class="section-kicker">Статистика</span>
                <h2>${totalCommands}</h2>
                <p>Всего команд</p>
              </div>

              <div class="profile-stat-card">
                <span class="section-kicker">Активность</span>
                <h2>${frequentCommands.length}</h2>
                <p>Команд в топе</p>
              </div>
            </div>

            <div class="profile-wide-card">
              <div class="section-head">
                <span class="section-kicker">Частые команды</span>
                <h2>Топ команд</h2>
              </div>
              <div class="stat-list">
                ${frequentCommandsHtml}
              </div>
            </div>

          </section>
        </main>
      </body>
      </html>
    `);
  } catch (error) {
    console.error(error);
    res.status(500).send("Ошибка профиля");
  }
});

app.post("/upload-avatar", requireAuth, uploadAvatar.single("avatar"), async (req, res) => {
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

app.get("/logout", (req, res) => {
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
