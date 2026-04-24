const express = require("express");
const path = require("path");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const bcrypt = require("bcrypt");
const { Pool } = require("pg");
require("dotenv").config();
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);

// Railway usually provides DATABASE_URL automatically from Postgres
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    name: "ziren.sid",
    store: new pgSession({
      pool: pool,
      tableName: "user_sessions",
      createTableIfMissing: true
    }),
    secret: process.env.SESSION_SECRET || "super-secret-key-change-me",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: true,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 1000 * 60 * 60 * 24 * 30,
      path: "/"
    }
  })
);

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

function requireAuthApi(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
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

app.get("/api/assistant/messages", requireAuthApi, async (req, res) => {
  try {
    const response = await fetch(
      `${process.env.AI_SERVICE_URL}/messages/${req.session.user.id}`
    );

    const data = await response.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: "failed" });
  }
});


app.get("/api/assistant/messages", requireAuthApi, async (req, res) => {
  try {
    const response = await fetch(
      `${process.env.AI_SERVICE_URL}/messages/${req.session.user.id}`
    );

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    console.error("assistant/messages error:", error);
    res.status(500).json({ error: "Assistant service unavailable" });
  }
});


app.get("/api/assistant/me", requireAuthApi, async (req, res) => {
  try {
    res.json({
      ok: true,
      user: {
        id: req.session.user.id,
        username: req.session.user.username,
        email: req.session.user.email,
      },
    });
  } catch (error) {
    console.error("assistant/me error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/assistant/chat", requireAuthApi, async (req, res) => {
  try {
    const { message, session_id = 0 } = req.body;

    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: "Message is required" });
    }

    const response = await fetch(`${process.env.AI_SERVICE_URL}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: req.session.user.id,
        message,
        session_id,
      }),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    console.error("assistant/chat error:", error);
    res.status(500).json({ error: "Assistant service unavailable" });
  }
});

app.get("/api/assistant/persona", requireAuthApi, async (req, res) => {
  try {
    const response = await fetch(
      `${process.env.AI_SERVICE_URL}/persona/${req.session.user.id}`
    );
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    console.error("assistant/persona error:", error);
    res.status(500).json({ error: "Assistant service unavailable" });
  }
});

app.post("/api/assistant/preset", requireAuthApi, async (req, res) => {
  try {
    const { preset_name } = req.body;

    const response = await fetch(
      `${process.env.AI_SERVICE_URL}/persona/${req.session.user.id}/preset`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ preset_name }),
      }
    );

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    console.error("assistant/preset error:", error);
    res.status(500).json({ error: "Assistant service unavailable" });
  }
});

app.get("/api/assistant/memory", requireAuthApi, async (req, res) => {
  try {
    const response = await fetch(
      `${process.env.AI_SERVICE_URL}/memory/${req.session.user.id}`
    );
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    console.error("assistant/memory error:", error);
    res.status(500).json({ error: "Assistant service unavailable" });
  }
});

app.post("/register", async (req, res) => {
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

app.post("/login", async (req, res) => {
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
    const avatarUrl = user.avatar_url || "/images/Ziren.png";

    const frequentCommandsHtml = frequentCommands.length
      ? frequentCommands.map((cmd) => `
          <div class="stat-list-item">
            <span>${cmd.command_text}</span>
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
                  <h1>${user.username}</h1>
                  <p>${user.email}</p>
                  <div class="profile-meta">
                    <span>Регистрация: ${new Date(user.created_at).toLocaleDateString("ru-RU")}</span>
                    <span>Последний вход: ${user.last_login_at ? new Date(user.last_login_at).toLocaleString("ru-RU") : "нет данных"}</span>
                  </div>
                </div>
              </div>

              <div class="profile-actions">
                <form action="/upload-avatar" method="POST" class="avatar-form">
                  <input type="text" name="avatar_url" placeholder="Ссылка на аватарку" required />
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

app.post("/upload-avatar", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { avatar_url } = req.body;

    if (!avatar_url) {
      return res.redirect("/profile");
    }

    await pool.query(
      "UPDATE users SET avatar_url = $1 WHERE id = $2",
      [avatar_url, userId]
    );

    res.redirect("/profile");
  } catch (error) {
    console.error(error);
    res.status(500).send("Ошибка");
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
      secure: true,
      sameSite: "none"
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

app.use((req, res, next) => {
  if (req.hostname.includes("railway.app")) {
    res.set("X-Robots-Tag", "noindex");
  }
  next();
});

