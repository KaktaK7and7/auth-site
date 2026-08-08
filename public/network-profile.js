(() => {
  const params = new URLSearchParams(window.location.search);
  const userId = Number.parseInt(params.get("id") || "", 10);
  const card = document.querySelector("[data-network-profile-card]");

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: "include",
      cache: "no-store",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.href = `/login.html?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      throw new Error("Нужен вход в аккаунт");
    }
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || "Ошибка Ziren Network");
    }
    return data;
  }

  async function sendRequest(targetId) {
    await api("/api/social/friends/requests", {
      method: "POST",
      body: JSON.stringify({ user_id: targetId }),
    });
    await load();
  }

  async function acceptRequest(requestId) {
    await api(`/api/social/friends/requests/${requestId}/accept`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    await load();
  }

  function relationshipAction(profile, relation, requests) {
    if (relation.status === "self") {
      const link = element("a", "site-button site-button--ghost", "Мой профиль");
      link.href = "/profile";
      return link;
    }

    if (relation.status === "accepted") {
      const link = element("a", "site-button site-button--primary", "Написать сообщение");
      link.href = `/messages.html?user=${profile.id}`;
      return link;
    }

    if (relation.status === "pending" && relation.request_direction === "incoming") {
      const request = requests.find(
        (item) => item.direction === "incoming" && Number(item.user?.id) === Number(profile.id),
      );
      if (request) {
        const button = element("button", "site-button site-button--primary", "Принять заявку");
        button.type = "button";
        button.addEventListener("click", () => void acceptRequest(request.id));
        return button;
      }
    }

    if (relation.status === "pending") {
      const state = element("span", "network-profile-state", "Заявка отправлена");
      return state;
    }

    const button = element("button", "site-button site-button--primary", "Добавить в друзья");
    button.type = "button";
    button.addEventListener("click", () => void sendRequest(profile.id));
    return button;
  }

  function renderFriends(profile) {
    const section = document.querySelector("[data-network-profile-friends]");
    const count = document.querySelector("[data-network-profile-friend-count]");
    const list = document.querySelector("[data-network-profile-friend-list]");
    if (!section || !count || !list) return;

    if (!profile.friends_visible) {
      section.hidden = true;
      return;
    }

    section.hidden = false;
    count.textContent = String(profile.friends_count || 0);
    list.replaceChildren();

    if (!profile.friends?.length) {
      list.append(element("p", "network-muted", "Список друзей пуст."));
      return;
    }

    for (const friend of profile.friends) {
      const link = element("a", "network-profile-friend");
      link.href = friend.network_profile_url;
      const image = document.createElement("img");
      image.src = friend.avatar_url || "/images/Ziren.png";
      image.alt = "";
      const name = element("strong", "", friend.username);
      link.append(image, name);
      list.append(link);
    }
  }

  async function load() {
    if (!card || !userId) {
      if (card) card.textContent = "Некорректная ссылка на профиль.";
      return;
    }

    try {
      const [profileData, friendsData] = await Promise.all([
        api(`/api/social/users/${userId}/profile`),
        api("/api/social/friends"),
      ]);
      const profile = profileData.profile;
      const relation = profile.relationship || { status: "none", request_direction: null };

      card.replaceChildren();
      const hero = element("div", "network-profile-hero");
      const avatar = document.createElement("img");
      avatar.className = "network-profile-avatar";
      avatar.src = profile.avatar_url || "/images/Ziren.png";
      avatar.alt = `Аватар ${profile.username}`;

      const copy = element("div", "network-profile-copy");
      copy.append(
        element("span", "network-kicker", "ZIREN MEMBER"),
        element("h1", "", profile.username),
        element("p", "network-profile-status", profile.status_text || "Пользователь Ziren"),
      );
      if (profile.bio) copy.append(element("p", "network-profile-bio", profile.bio));

      const actions = element("div", "network-profile-actions");
      actions.append(relationshipAction(profile, relation, friendsData.requests || []));
      if (profile.public_profile_url) {
        const publicLink = element("a", "site-button site-button--ghost", "Публичный профиль");
        publicLink.href = profile.public_profile_url;
        actions.append(publicLink);
      }
      copy.append(actions);
      hero.append(avatar, copy);
      card.append(hero);

      renderFriends(profile);
      document.title = `${profile.username} — Ziren Network`;
    } catch (error) {
      card.replaceChildren(element("div", "network-profile-loading", error.message || "Профиль недоступен"));
    }
  }

  void load();
})();
