const express = require("express");
const path = require("path");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const bcrypt = require("bcrypt");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

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
    cookie: {
      httpOnly: true,
      secure: false,
      maxAge: 1000 * 60 * 60 * 24 * 7
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
      return res.status(400).send("Заполни email и пароль");
    }

    const result = await pool.query(
      "SELECT id, username, email, password_hash FROM users WHERE email = $1",
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(400).send("Неверный email или пароль");
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(400).send("Неверный email или пароль");
    }

    req.session.user = {
      id: user.id,
      username: user.username,
      email: user.email
    };

    res.redirect("/profile");
  } catch (error) {
    console.error(error);
    res.status(500).send("Ошибка сервера при входе");
  }
});

app.get("/profile", requireAuth, (req, res) => {
  const { username, email } = req.session.user;

  res.send(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Профиль</title>
      <link rel="stylesheet" href="/style.css" />
    </head>
    <body>
      <div class="container">
        <h1>Профиль</h1>
        <p><strong>Имя:</strong> ${username}</p>
        <p><strong>Email:</strong> ${email}</p>
        <a class="btn" href="/logout">Выйти</a>
      </div>
    </body>
    </html>
  `);
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
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