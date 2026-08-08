function createAuthLink(label, href, className = "site-button site-button--ghost") {
  const link = document.createElement("a");
  link.className = className;
  link.href = href;
  link.textContent = label;
  return link;
}

let webSessionRequest;

function loadWebSession() {
  if (!webSessionRequest) {
    webSessionRequest = fetch("/api/me", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    }).then((response) => {
      if (!response.ok) {
        throw new Error("Session request failed");
      }

      return response.json();
    });
  }

  return webSessionRequest;
}

async function updateAuthNavigation() {
  const containers = document.querySelectorAll("[data-auth-container]");

  if (!containers.length) {
    return;
  }

  try {
    const data = await loadWebSession();

    containers.forEach((container) => {
      container.replaceChildren();

      if (data.loggedIn && data.user) {
        container.append(
          createAuthLink(
            data.user.username,
            "/profile",
            "site-button site-button--profile",
          ),
        );
        return;
      }

      container.append(
        createAuthLink("Войти", "/login.html"),
        createAuthLink(
          "Регистрация",
          "/register.html",
          "site-button site-button--primary site-button--compact",
        ),
      );
    });
  } catch (error) {
    console.error("Не удалось обновить состояние авторизации", error);
  }
}

async function updateAssistantChatLabels() {
  const labels = document.querySelectorAll("[data-assistant-chat-label]");

  if (!labels.length) {
    return;
  }

  try {
    const session = await loadWebSession();

    if (!session.loggedIn) {
      return;
    }

    const response = await fetch("/api/assistant/persona", {
      credentials: "include",
      cache: "no-store",
    });

    if (!response.ok) {
      return;
    }

    const data = await response.json();
    const assistantName = String(data.name || "").trim();

    if (
      !assistantName
      || assistantName.length > 40
      || /[\u0000-\u001f\u007f]/.test(assistantName)
    ) {
      return;
    }

    labels.forEach((label) => {
      const shortLabel = label.dataset.assistantChatLabel === "short";
      const defaultName =
        assistantName.toLocaleLowerCase("ru-RU") === "мелисса";

      if (shortLabel) {
        label.textContent = defaultName
          ? "Чат с Мелиссой"
          : `Чат — ${assistantName}`;
        return;
      }

      label.textContent = defaultName
        ? "Открыть чат с Мелиссой"
        : `Открыть чат — ${assistantName}`;
    });
  } catch {
    // Страница остаётся с понятной подписью по умолчанию.
  }
}

function shuffle(items) {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }

  return result;
}

function formatMemberCount(total) {
  const absolute = Math.abs(Number(total)) % 100;
  const lastDigit = absolute % 10;

  if (absolute > 10 && absolute < 20) {
    return `${total} участников`;
  }

  if (lastDigit === 1) {
    return `${total} участник`;
  }

  if (lastDigit >= 2 && lastDigit <= 4) {
    return `${total} участника`;
  }

  return `${total} участников`;
}

function formatFriendCount(total) {
  const absolute = Math.abs(Number(total)) % 100;
  const lastDigit = absolute % 10;

  if (absolute > 10 && absolute < 20) {
    return `${total} друзей`;
  }

  if (lastDigit === 1) {
    return `${total} друг`;
  }

  if (lastDigit >= 2 && lastDigit <= 4) {
    return `${total} друга`;
  }

  return `${total} друзей`;
}

function buildTickerGroup(members) {
  const group = document.createElement("div");
  group.className = "community-ticker__group";
  group.setAttribute("aria-hidden", "true");

  members.forEach((member) => {
    const item = member.profile_url
      ? document.createElement("a")
      : document.createElement("span");

    item.className = "community-ticker__member";

    if (member.profile_url) {
      item.href = member.profile_url;
    }

    const avatar = document.createElement("img");
    avatar.src = member.avatar_url || "/images/Ziren.png";
    avatar.alt = "";
    avatar.loading = "lazy";

    const name = document.createElement("strong");
    name.textContent = member.username;

    const marker = document.createElement("i");
    marker.textContent = "◆";
    marker.setAttribute("aria-hidden", "true");

    item.append(avatar, name);
    group.append(item, marker);
  });

  return group;
}

async function loadCommunityTicker() {
  const track = document.querySelector("[data-community-ticker]");
  const status = document.querySelector("[data-community-status]");

  if (!track) {
    return;
  }

  try {
    const response = await fetch("/api/community/members", {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Community request failed");
    }

    const data = await response.json();
    const realMembers = Array.isArray(data.members) ? data.members : [];

    if (!realMembers.length) {
      track.classList.add("community-ticker--empty");
      track.textContent =
        "Стань первым участником, который появится в ленте сообщества";

      if (status) {
        status.textContent = "Только реальные профили с разрешением владельца";
      }

      return;
    }

    const shuffled = shuffle(realMembers);
    const members = [];

    while (members.length < Math.max(8, shuffled.length)) {
      members.push(...shuffle(shuffled));
    }

    const visibleMembers = members.slice(0, Math.max(8, shuffled.length));
    const firstGroup = buildTickerGroup(visibleMembers);
    const secondGroup = firstGroup.cloneNode(true);

    track.replaceChildren(firstGroup, secondGroup);
    track.style.setProperty(
      "--ticker-duration",
      `${Math.max(28, visibleMembers.length * 4)}s`,
    );

    if (status) {
      status.textContent = `${formatMemberCount(data.total)} разрешили показ профиля`;
    }
  } catch (error) {
    track.classList.add("community-ticker--empty");
    track.textContent = "Лента сообщества временно недоступна";
    console.error("Не удалось загрузить участников", error);
  }
}

function createProfileFriendNode(friend) {
  const node = friend.public_profile_url
    ? document.createElement("a")
    : document.createElement("span");
  node.className = "profile-social-member";

  if (friend.public_profile_url) {
    node.href = friend.public_profile_url;
  }

  const avatar = document.createElement("img");
  avatar.src = friend.avatar_url || "/images/Ziren.png";
  avatar.alt = "";
  avatar.loading = "lazy";

  const copy = document.createElement("span");
  const name = document.createElement("strong");
  name.textContent = friend.username;
  copy.append(name);

  if (friend.voice_alias) {
    const alias = document.createElement("small");
    alias.textContent = `У тебя: ${friend.voice_alias}`;
    copy.append(alias);
  }

  node.append(avatar, copy);
  return node;
}

function buildFriendList(friends, emptyText) {
  const list = document.createElement("div");
  list.className = "profile-social-members";

  if (!friends.length) {
    const empty = document.createElement("p");
    empty.className = "profile-empty";
    empty.textContent = emptyText;
    list.append(empty);
    return list;
  }

  friends.forEach((friend) => list.append(createProfileFriendNode(friend)));
  return list;
}

async function loadPrivateProfileFriends() {
  const grid = document.querySelector(".profile-social-grid");

  if (!grid || window.location.pathname !== "/profile") {
    return false;
  }

  try {
    const response = await fetch("/api/social/friends", {
      credentials: "include",
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Friends request failed");
    }

    const data = await response.json();
    const friends = Array.isArray(data.friends) ? data.friends : [];
    const requests = Array.isArray(data.requests) ? data.requests : [];
    const incoming = requests.filter((request) => request.direction === "incoming");
    const panel = grid.closest(".profile-panel");
    const state = panel?.querySelector(".profile-panel__state");

    if (state) {
      state.textContent = `${formatFriendCount(friends.length)} · ${incoming.length} входящих`;
    }

    const friendsCard = document.createElement("article");
    friendsCard.className = "profile-social-card";
    const friendsTitle = document.createElement("h4");
    friendsTitle.textContent = `Друзья · ${friends.length}`;
    const friendsText = document.createElement("p");
    friendsText.textContent =
      "Голосовые имена и разрешение на озвучивание настраиваются в приложении Ziren.";
    friendsCard.append(
      friendsTitle,
      friendsText,
      buildFriendList(friends, "Друзей пока нет."),
    );

    const privacyCard = document.createElement("article");
    privacyCard.className = "profile-social-card";
    const privacyTitle = document.createElement("h4");
    privacyTitle.textContent = "Приватность друзей";
    const privacyText = document.createElement("p");
    privacyText.textContent =
      "Когда список скрыт, посетителям не отдаётся ни список, ни количество друзей.";
    const privacyLabel = document.createElement("label");
    privacyLabel.className = "profile-social-privacy";
    const privacyCopy = document.createElement("span");
    privacyCopy.textContent = "Показывать друзей в публичном профиле";
    const privacyInput = document.createElement("input");
    privacyInput.type = "checkbox";
    privacyInput.checked = Boolean(data.privacy?.show_friends_on_profile);
    privacyInput.addEventListener("change", async () => {
      privacyInput.disabled = true;
      const requested = privacyInput.checked;

      try {
        const privacyResponse = await fetch("/api/social/privacy", {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ show_friends_on_profile: requested }),
        });

        if (!privacyResponse.ok) {
          throw new Error("Privacy update failed");
        }
      } catch (error) {
        privacyInput.checked = !requested;
        console.error("Не удалось сохранить видимость друзей", error);
      } finally {
        privacyInput.disabled = false;
      }
    });
    privacyLabel.append(privacyCopy, privacyInput);
    privacyCard.append(privacyTitle, privacyText, privacyLabel);

    grid.replaceChildren(friendsCard, privacyCard);
    return true;
  } catch (error) {
    console.error("Не удалось загрузить друзей профиля", error);
    return true;
  }
}

async function loadPublicProfileFriends() {
  const match = window.location.pathname.match(/^\/community\/(\d+)\/?$/);

  if (!match) {
    return;
  }

  try {
    const response = await fetch(`/api/social/public/${match[1]}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return;
    }

    const data = await response.json();
    const profile = data.profile;

    if (!profile?.friends_visible) {
      return;
    }

    const profileGrid = document.querySelector(".profile-grid");

    if (!profileGrid) {
      return;
    }

    const panel = document.createElement("section");
    panel.className = "profile-panel profile-panel--wide";

    const head = document.createElement("div");
    head.className = "profile-panel__head";
    const headCopy = document.createElement("div");
    const kicker = document.createElement("span");
    kicker.textContent = "ZIREN NETWORK";
    const title = document.createElement("h3");
    title.textContent = `Друзья · ${profile.friends_count || 0}`;
    headCopy.append(kicker, title);
    const state = document.createElement("span");
    state.className = "profile-panel__state";
    state.textContent = "ПОКАЗ РАЗРЕШЁН ВЛАДЕЛЬЦЕМ";
    head.append(headCopy, state);

    panel.append(
      head,
      buildFriendList(
        Array.isArray(profile.friends) ? profile.friends : [],
        "Список друзей пуст.",
      ),
    );
    profileGrid.append(panel);
  } catch (error) {
    console.error("Не удалось загрузить публичный список друзей", error);
  }
}

function ensureProfileSocialStyles() {
  const profilePath = window.location.pathname === "/profile";
  const publicProfilePath = /^\/community\/\d+\/?$/.test(window.location.pathname);

  if (!profilePath && !publicProfilePath) {
    return;
  }

  if (document.querySelector("link[data-profile-social-styles]")) {
    return;
  }

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/profile-social.css";
  link.dataset.profileSocialStyles = "true";
  document.head.append(link);
}

async function loadProfileSocial() {
  ensureProfileSocialStyles();
  const privateProfileHandled = await loadPrivateProfileFriends();

  if (!privateProfileHandled) {
    await loadPublicProfileFriends();
  }
}

function showFormErrorFromQuery() {
  const errorBox = document.querySelector("[data-form-error]");

  if (!errorBox) {
    return;
  }

  const error = new URLSearchParams(window.location.search).get("error");

  if (error) {
    errorBox.textContent = error;
    errorBox.hidden = false;
  }
}

function setupMobileNavigation() {
  const button = document.querySelector("[data-nav-toggle]");
  const navigation = document.querySelector("[data-nav-links]");

  if (!button || !navigation) {
    return;
  }

  button.addEventListener("click", () => {
    const isOpen = navigation.classList.toggle("site-nav__links--open");
    button.setAttribute("aria-expanded", String(isOpen));
  });
}

function setupCopyButtons() {
  document.querySelectorAll("[data-copy-value]").forEach((button) => {
    button.addEventListener("click", async () => {
      const value = button.getAttribute("data-copy-value");

      if (!value) {
        return;
      }

      try {
        const resolvedValue = value.startsWith("/")
          ? `${window.location.origin}${value}`
          : value;

        await navigator.clipboard.writeText(resolvedValue);
        const original = button.textContent;
        button.textContent = "Скопировано";

        window.setTimeout(() => {
          button.textContent = original;
        }, 1800);
      } catch (error) {
        console.error("Не удалось скопировать значение", error);
      }
    });
  });
}

function setupAvatarUpload() {
  const input = document.querySelector("[data-avatar-upload]");

  if (!input) {
    return;
  }

  input.addEventListener("change", () => {
    if (input.files?.length) {
      input.form?.requestSubmit();
    }
  });
}

function setupRevealAnimations() {
  const elements = document.querySelectorAll("[data-reveal]");

  if (!elements.length || !("IntersectionObserver" in window)) {
    elements.forEach((element) => element.classList.add("is-visible"));
    return;
  }

  document.documentElement.classList.add("reveal-ready");

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.14 },
  );

  elements.forEach((element) => observer.observe(element));
}

document.addEventListener("DOMContentLoaded", () => {
  updateAuthNavigation();
  updateAssistantChatLabels();
  loadCommunityTicker();
  loadProfileSocial();
  showFormErrorFromQuery();
  setupMobileNavigation();
  setupCopyButtons();
  setupAvatarUpload();
  setupRevealAnimations();
});