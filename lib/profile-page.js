const { escapeHtml } = require("./security");


function formatDate(value, includeTime = false) {
  if (!value) {
    return "нет данных";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "нет данных";
  }

  return new Intl.DateTimeFormat(
    "ru-RU",
    includeTime
      ? {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "UTC",
        }
      : {
          dateStyle: "medium",
          timeZone: "UTC",
        },
  ).format(date);
}


function renderAchievements(achievements) {
  return achievements
    .map(
      (achievement) => `
        <article class="profile-achievement${achievement.unlocked ? "" : " is-locked"}">
          <div class="profile-achievement__icon" aria-hidden="true">
            ${escapeHtml(achievement.icon)}
          </div>
          <h4>${escapeHtml(achievement.title)}</h4>
          <p>${escapeHtml(achievement.description)}</p>
        </article>
      `,
    )
    .join("");
}


function renderTopCommands(topCommands) {
  if (!topCommands.length) {
    return `
      <p class="profile-empty">
        Учтённых команд пока нет. Сбор активности выключен по умолчанию и
        начнётся только после твоего разрешения и подключения desktop-событий.
      </p>
    `;
  }

  return topCommands
    .map(
      (command) => `
        <div>
          <span>${escapeHtml(command.command_text)}</span>
          <strong>${Number(command.uses) || 0} раз</strong>
        </div>
      `,
    )
    .join("");
}


function renderPrivateSettings(user, csrfToken) {
  const checked = (value) => (value ? " checked" : "");

  return `
    <section class="profile-panel profile-panel--wide">
      <div class="profile-panel__head">
        <div>
          <span>CONTROL CENTER</span>
          <h3>Профиль и приватность</h3>
        </div>
        <span class="profile-panel__state">СИНХРОНИЗИРУЕТСЯ С ПРИЛОЖЕНИЕМ</span>
      </div>

      <form class="profile-form" method="post" action="/profile/settings">
        <input type="hidden" name="csrf_token" value="${escapeHtml(csrfToken)}" />

        <label class="profile-form__field">
          <span>Статус</span>
          <input
            type="text"
            name="status_text"
            maxlength="80"
            value="${escapeHtml(user.status_text || "")}"
            placeholder="Например: строю свой цифровой мир"
          />
        </label>

        <label class="profile-form__field">
          <span>О себе</span>
          <textarea
            name="bio"
            maxlength="280"
            placeholder="Расскажи немного о себе"
          >${escapeHtml(user.bio || "")}</textarea>
        </label>

        <label class="profile-switch">
          <input
            type="checkbox"
            name="public_profile_enabled"
            value="true"${checked(user.public_profile_enabled)}
          />
          <span>
            <strong>Публичный профиль</strong>
            <span>Разрешает открывать безопасную публичную версию без email и приватных настроек.</span>
          </span>
        </label>

        <label class="profile-switch">
          <input
            type="checkbox"
            name="show_in_community"
            value="true"${checked(user.show_in_community)}
          />
          <span>
            <strong>Показывать меня в ленте сообщества</strong>
            <span>В бегущей строке появятся только ник и аватар. Настройка независима от публичного профиля.</span>
          </span>
        </label>

        <label class="profile-switch">
          <input
            type="checkbox"
            name="activity_tracking_enabled"
            value="true"${checked(user.activity_tracking_enabled)}
          />
          <span>
            <strong>Учитывать использование функций</strong>
            <span>После подключения desktop-событий будут сохраняться идентификаторы выполненных функций, а не полный текст речи.</span>
          </span>
        </label>

        <label class="profile-switch">
          <input
            type="checkbox"
            name="ai_context_enabled"
            value="true"${checked(user.ai_context_enabled)}
          />
          <span>
            <strong>Разрешить Мелиссе использовать безопасный контекст</strong>
            <span>Настройка подготовлена для следующего этапа. События не передаются нейросети, пока связка не реализована.</span>
          </span>
        </label>

        <div class="profile-form__actions">
          <button class="site-button site-button--primary" type="submit">
            Сохранить и синхронизировать
          </button>
          ${
            user.public_profile_enabled
              ? `
                <button
                  class="site-button site-button--ghost"
                  type="button"
                  data-copy-value="/community/${escapeHtml(user.id)}"
                >
                  Скопировать публичную ссылку
                </button>
              `
              : ""
          }
        </div>
      </form>
    </section>
  `;
}


function renderProfilePage({
  user,
  summary,
  topCommands = [],
  csrfToken = "",
  publicView = false,
}) {
  const email = publicView ? "" : user.email;
  const statusText = user.status_text || "Участник экосистемы Ziren";
  const bio = user.bio || (
    publicView
      ? "Пользователь пока ничего о себе не рассказал."
      : "Добавь описание профиля — оно синхронизируется с приложением."
  );

  return `
    <!doctype html>
    <html lang="ru">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${escapeHtml(user.username)} — профиль Ziren</title>
        <meta
          name="description"
          content="Профиль участника экосистемы Ziren."
        />
        <link rel="icon" type="image/png" href="/images/Ziren.png" />
        <link rel="stylesheet" href="/site.css" />
      </head>
      <body>
        <header class="site-header">
          <div class="site-container site-nav">
            <a class="site-brand" href="/">
              <img src="/images/Ziren.png" alt="" />
              <span>ZIREN <small>NETWORK PROFILE</small></span>
            </a>
            <button
              class="site-nav__toggle"
              type="button"
              aria-label="Открыть меню"
              aria-expanded="false"
              data-nav-toggle
            >☰</button>
            <nav class="site-nav__links" data-nav-links>
              <a href="/">Главная</a>
              <a href="/assistant.html">Ассистент</a>
              ${
                publicView
                  ? '<a href="/register.html">Присоединиться</a>'
                  : '<a href="/profile" aria-current="page">Профиль</a><a href="/assistant/chat" data-assistant-chat-label="short">Чат с Мелиссой</a>'
              }
            </nav>
            <div class="site-nav__actions">
              ${
                publicView
                  ? '<a class="site-button site-button--primary site-button--compact" href="/register.html">Создать профиль</a>'
                  : `
                    <form method="post" action="/logout">
                      <input type="hidden" name="csrf_token" value="${escapeHtml(csrfToken)}" />
                      <button class="site-button site-button--ghost" type="submit">Выйти</button>
                    </form>
                  `
              }
            </div>
          </div>
        </header>

        <main class="profile-shell">
          <div class="site-container">
            <div class="profile-toolbar">
              <div>
                <span class="site-eyebrow">${publicView ? "Public profile" : "Personal control center"}</span>
                <h1>${publicView ? "Профиль участника" : "Твой профиль Ziren"}</h1>
              </div>
              ${
                publicView
                  ? '<a class="site-button site-button--ghost" href="/">Вернуться на главную</a>'
                  : '<a class="site-button site-button--ghost" href="/assistant/chat" data-assistant-chat-label>Открыть чат с Мелиссой</a>'
              }
            </div>

            <section class="profile-hero">
              <div class="profile-hero__cover"></div>
              <div class="profile-hero__body">
                <div class="profile-avatar">
                  <img
                    src="${escapeHtml(user.avatar_url || "/images/Ziren.png")}"
                    alt="Аватар ${escapeHtml(user.username)}"
                  />
                  ${
                    publicView
                      ? ""
                      : `
                        <form
                          class="profile-avatar__edit"
                          action="/upload-avatar"
                          method="post"
                          enctype="multipart/form-data"
                        >
                          <input type="hidden" name="csrf_token" value="${escapeHtml(csrfToken)}" />
                          <label>
                            <span>Сменить аватар</span>
                            <input
                              type="file"
                              name="avatar"
                              accept="image/png,image/jpeg,image/webp"
                              data-avatar-upload
                              required
                            />
                          </label>
                        </form>
                      `
                  }
                </div>

                <div class="profile-identity">
                  <div class="profile-identity__name">
                    <h2>${escapeHtml(user.username)}</h2>
                    <span class="profile-identity__badge">ZIREN MEMBER</span>
                  </div>
                  ${email ? `<p>${escapeHtml(email)}</p>` : ""}
                  <p>${escapeHtml(statusText)}</p>
                  <div class="profile-tags">
                    <span>${summary.member_days} дн. в Ziren</span>
                    <span>${summary.achievements_unlocked}/${summary.achievements_total} достижений</span>
                    ${
                      user.show_in_community
                        ? "<span>Участник сообщества</span>"
                        : ""
                    }
                  </div>
                </div>

                <div class="profile-level" aria-label="Уровень ${summary.level}">
                  <div>
                    <span>LEVEL</span>
                    <strong>${summary.level}</strong>
                  </div>
                </div>
              </div>
            </section>

            <div class="profile-grid">
              <section class="profile-panel">
                <div class="profile-panel__head">
                  <div>
                    <span>OVERVIEW</span>
                    <h3>Информация</h3>
                  </div>
                </div>
                <div class="profile-meta-list">
                  <div>
                    <span>ID</span>
                    <strong>${escapeHtml(user.id)}</strong>
                  </div>
                  <div>
                    <span>Регистрация</span>
                    <strong>${escapeHtml(formatDate(user.created_at))}</strong>
                  </div>
                  ${
                    publicView
                      ? ""
                      : `
                        <div>
                          <span>Последний вход</span>
                          <strong>${escapeHtml(formatDate(user.last_login_at, true))}</strong>
                        </div>
                      `
                  }
                </div>
                <p class="profile-empty" style="margin-top: 15px">
                  ${escapeHtml(bio)}
                </p>
              </section>

              <section class="profile-panel">
                <div class="profile-panel__head">
                  <div>
                    <span>PROGRESS</span>
                    <h3>Реальный прогресс</h3>
                  </div>
                </div>
                <div class="profile-stats">
                  <div class="profile-stat">
                    <strong>${summary.total_commands}</strong>
                    <span>учтённых команд</span>
                  </div>
                  <div class="profile-stat">
                    <strong>${summary.distinct_commands}</strong>
                    <span>разных функций</span>
                  </div>
                  <div class="profile-stat">
                    <strong>${summary.achievements_unlocked}</strong>
                    <span>достижений</span>
                  </div>
                </div>
                <div class="profile-progress" aria-label="Прогресс уровня ${summary.level}">
                  <div style="width: ${summary.level_progress_percent}%"></div>
                </div>
                <p class="profile-empty" style="margin-top: 13px">
                  До следующего уровня: ${summary.commands_to_next_level}
                  учтённых команд.
                </p>
              </section>

              <section class="profile-panel profile-panel--wide">
                <div class="profile-panel__head">
                  <div>
                    <span>ACHIEVEMENTS</span>
                    <h3>Достижения</h3>
                  </div>
                  <span class="profile-panel__state">ТОЛЬКО РЕАЛЬНЫЕ ДАННЫЕ</span>
                </div>
                <div class="profile-achievements">
                  ${renderAchievements(summary.achievements)}
                </div>
              </section>

              ${
                publicView
                  ? ""
                  : `
                    <section class="profile-panel">
                      <div class="profile-panel__head">
                        <div>
                          <span>ACTIVITY</span>
                          <h3>Частые функции</h3>
                        </div>
                      </div>
                      <div class="profile-command-list">
                        ${renderTopCommands(topCommands)}
                      </div>
                    </section>

                    <section class="profile-panel">
                      <div class="profile-panel__head">
                        <div>
                          <span>ZIREN NETWORK</span>
                          <h3>Друзья и чаты</h3>
                        </div>
                        <span class="profile-panel__state">СЛЕДУЮЩИЙ МОДУЛЬ</span>
                      </div>
                      <div class="profile-social-grid">
                        <article class="profile-social-card">
                          <h4>Друзья и псевдонимы</h4>
                          <p>
                            Добавление пользователей, короткие голосовые имена,
                            заявки, блокировки и настройки приватности.
                          </p>
                          <span>ПРОЕКТИРУЕТСЯ</span>
                        </article>
                        <article class="profile-social-card">
                          <h4>Личные сообщения</h4>
                          <p>
                            Переписка на сайте и в приложении, голосовая отправка
                            и добровольное автоматическое озвучивание.
                          </p>
                          <span>ПРОЕКТИРУЕТСЯ</span>
                        </article>
                      </div>
                    </section>

                    ${renderPrivateSettings(user, csrfToken)}
                  `
              }
            </div>
          </div>
        </main>

        <script src="/site.js" defer></script>
      </body>
    </html>
  `;
}


module.exports = {
  renderProfilePage,
};
