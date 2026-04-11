const express = require("express");
const path = require("path");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const bcrypt = require("bcrypt");
const { Pool } = require("pg");
require("dotenv").config();

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
    store: new pgSession({
      pool: pool,
      tableName: "user_sessions"
    }),
    secret: process.env.SESSION_SECRET || "super-secret-key-change-me",
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 30
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
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login.html");
  }
  next();
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).send("Заполни все поля");
    }

    if (password.length < 6) {
      return res.status(400).send("Пароль должен быть не короче 6 символов");
    }

    const existing = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );

    if (existing.rows.length > 0) {
      return res.status(400).send("Пользователь с таким email уже существует");
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      "INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email",
      [username, email, passwordHash]
    );

    req.session.user = {
      id: result.rows[0].id,
      username: result.rows[0].username,
      email: result.rows[0].email
    };

    res.redirect("/profile");
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

    // ✅ обновляем последний вход
    await pool.query(
      "UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1",
      [user.id]
    );

    // ✅ ВАЖНО — правильная работа с сессией
    req.session.regenerate((err) => {
      if (err) {
        console.error(err);
        return res.status(500).send("Ошибка сессии");
      }

      req.session.user = {
        id: user.id,
        username: user.username,
        email: user.email
      };

      req.session.save((saveErr) => {
        if (saveErr) {
          console.error(saveErr);
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
    const totalCommands = statsResult.rows[0]?.total_commands || 0;
    const frequentCommands = frequentCommandsResult.rows;

    const avatarUrl = user.avatar_url || "/images/Ziren.png";

    const frequentCommandsHtml = frequentCommands.length
      ? frequentCommands.map(cmd => `
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
              <img src="/images/Ziren.png" class="brand-logo" />
              <span>Ziren</span>
            </a>

            <nav class="nav-links">
              <a href="/">Главная</a>
              <a href="/assistant.html">Ассистент</a>
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
                  <img src="${avatarUrl}" class="profile-avatar" />
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

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

app.post("/upload-avatar", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { avatar_url } = req.body;

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