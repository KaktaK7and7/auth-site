(() => {
  const page = document.body.dataset.networkPage;
  if (!page) return;

  const state = {
    session: null,
    friends: [],
    requests: [],
    groups: [],
    active: null,
    activeMessages: [],
    pollId: null,
    listPollId: null,
    busy: false,
  };

  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }

  function button(label, className = "network-button") {
    const element = node("button", className, label);
    element.type = "button";
    return element;
  }

  function avatar(src, alt = "") {
    const image = document.createElement("img");
    image.src = src || "/images/Ziren.png";
    image.alt = alt;
    image.loading = "lazy";
    return image;
  }

  function profileLink(person, label = "Профиль") {
    if (!person.public_profile_url) return null;
    const link = node("a", "network-button network-button--ghost", label);
    link.href = person.public_profile_url;
    return link;
  }

  function setStatus(message = "", isError = false) {
    const box = qs("[data-network-status]");
    if (!box) return;
    box.hidden = !message;
    box.textContent = message;
    box.classList.toggle("is-error", Boolean(message && isError));
  }

  async function api(path, options = {}) {
    const init = {
      credentials: "include",
      cache: "no-store",
      ...options,
      headers: {
        ...(options.body && !(options.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...(options.headers || {}),
      },
    };
    const response = await fetch(path, init);
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error("Сервер Ziren вернул некорректный ответ");
    }
    if (!response.ok || data.ok === false) {
      if (response.status === 401) {
        window.location.href = `/login.html?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        throw new Error("Нужен вход в аккаунт");
      }
      throw new Error(data.error || `Ошибка сервера: ${response.status}`);
    }
    return data;
  }

  async function requireSession() {
    const response = await fetch("/api/me", { credentials: "include", cache: "no-store" });
    const data = await response.json();
    if (!data.loggedIn || !data.user) {
      window.location.href = `/login.html?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      throw new Error("Нужен вход в аккаунт");
    }
    state.session = data.user;
    return data.user;
  }

  function formatTime(value) {
    if (!value) return "";
    try {
      return new Date(value).toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  function totalUnread() {
    return state.friends.reduce((sum, friend) => sum + Number(friend.unread_count || 0), 0)
      + state.groups.reduce((sum, group) => sum + Number(group.unread_count || 0), 0);
  }

  function syncCounters() {
    qsa("[data-friend-count]").forEach((element) => {
      element.textContent = String(state.friends.length);
    });
    qsa("[data-total-unread]").forEach((element) => {
      element.textContent = String(totalUnread());
    });
  }

  async function refreshFriends({ silent = false } = {}) {
    try {
      const data = await api("/api/social/friends");
      state.friends = Array.isArray(data.friends) ? data.friends : [];
      state.requests = Array.isArray(data.requests) ? data.requests : [];
      state.friendsPrivacy = Boolean(data.privacy?.show_friends_on_profile);
      syncCounters();
      if (page === "friends") renderFriendsPage();
      if (page === "messages") renderThreadLists();
    } catch (error) {
      if (!silent) setStatus(error.message || "Не удалось загрузить друзей", true);
    }
  }

  async function refreshGroups({ silent = false } = {}) {
    if (page !== "messages") return;
    try {
      const data = await api("/api/social/groups");
      state.groups = Array.isArray(data.groups) ? data.groups : [];
      syncCounters();
      renderThreadLists();
    } catch (error) {
      if (!silent) setStatus(error.message || "Не удалось загрузить группы", true);
    }
  }

  function renderPersonBase(person, subtitle = "") {
    const row = node("div", "network-person");
    row.append(avatar(person.avatar_url, ""));
    const copy = node("div", "network-person__copy");
    copy.append(node("strong", "", person.username));
    copy.append(node("small", "", subtitle || person.status_text || "Пользователь Ziren"));
    row.append(copy);
    const actions = node("div", "network-actions");
    row.append(actions);
    return { row, actions, copy };
  }

  function renderFriendsPage() {
    const total = qs("[data-friends-total]");
    if (total) total.textContent = String(state.friends.length);
    const privacy = qs("[data-friends-privacy]");
    if (privacy) privacy.checked = Boolean(state.friendsPrivacy);

    const incoming = state.requests.filter((request) => request.direction === "incoming");
    const outgoing = state.requests.filter((request) => request.direction === "outgoing");
    renderRequests(qs("[data-incoming-requests]"), incoming, true);
    renderRequests(qs("[data-outgoing-requests]"), outgoing, false);

    const list = qs("[data-friends-list]");
    if (!list) return;
    list.replaceChildren();

    if (!state.friends.length) {
      list.append(node("p", "network-muted", "Друзей пока нет. Найди пользователя выше и отправь заявку."));
      return;
    }

    for (const friend of state.friends) {
      const { row, actions, copy } = renderPersonBase(
        friend,
        friend.status_text || (friend.voice_alias ? `Голосовое имя: ${friend.voice_alias}` : "Друг Ziren"),
      );

      const prefs = node("div", "network-preferences");
      const aliasInput = document.createElement("input");
      aliasInput.className = "network-input";
      aliasInput.maxLength = 48;
      aliasInput.value = friend.voice_alias || "";
      aliasInput.placeholder = "Голосовое имя: Диана, Шеф…";

      const announceLabel = node("label", "network-switch");
      const announce = document.createElement("input");
      announce.type = "checkbox";
      announce.checked = Boolean(friend.announce_messages);
      announceLabel.append(announce, node("span", "", "Озвучивать"));

      const save = button("Сохранить");
      save.addEventListener("click", async () => {
        try {
          save.disabled = true;
          await api(`/api/social/friends/${friend.id}/preferences`, {
            method: "PATCH",
            body: JSON.stringify({
              voice_alias: aliasInput.value.trim(),
              announce_messages: announce.checked,
            }),
          });
          await refreshFriends({ silent: true });
          setStatus("Настройки друга синхронизированы с приложением.");
        } catch (error) {
          setStatus(error.message, true);
        } finally {
          save.disabled = false;
        }
      });
      prefs.append(aliasInput, announceLabel, save);
      copy.append(prefs);

      const profile = profileLink(friend);
      if (profile) actions.append(profile);
      const message = node("a", "network-button", "Написать");
      message.href = `/messages.html?user=${friend.id}`;
      actions.append(message);
      const remove = button("Удалить", "network-button network-button--danger");
      remove.addEventListener("click", async () => {
        if (!window.confirm(`Удалить ${friend.username} из друзей?`)) return;
        try {
          await api(`/api/social/friends/${friend.id}`, { method: "DELETE" });
          await refreshFriends();
          setStatus(`${friend.username} удалён из друзей.`);
        } catch (error) {
          setStatus(error.message, true);
        }
      });
      actions.append(remove);
      list.append(row);
    }
  }

  function renderRequests(container, requests, incoming) {
    if (!container) return;
    container.replaceChildren();
    if (!requests.length) {
      container.append(node("p", "network-muted", incoming ? "Новых заявок нет." : "Отправленных заявок нет."));
      return;
    }
    for (const request of requests) {
      const person = request.user;
      const { row, actions } = renderPersonBase(
        person,
        incoming ? "Хочет добавить тебя в друзья" : "Ожидает ответа",
      );
      const profile = profileLink(person);
      if (profile) actions.append(profile);
      if (incoming) {
        const accept = button("Принять");
        accept.addEventListener("click", async () => {
          try {
            await api(`/api/social/friends/requests/${request.id}/accept`, {
              method: "POST",
              body: JSON.stringify({}),
            });
            await refreshFriends();
          } catch (error) {
            setStatus(error.message, true);
          }
        });
        actions.append(accept);
      }
      const decline = button(incoming ? "Отклонить" : "Отменить", "network-button network-button--ghost");
      decline.addEventListener("click", async () => {
        try {
          await api(`/api/social/friends/requests/${request.id}`, { method: "DELETE" });
          await refreshFriends();
        } catch (error) {
          setStatus(error.message, true);
        }
      });
      actions.append(decline);
      container.append(row);
    }
  }

  async function searchPeople() {
    const input = qs("[data-user-search]");
    const results = qs("[data-user-search-results]");
    const query = input?.value.trim() || "";
    if (!results) return;
    results.replaceChildren();
    if (query.length < 2) {
      results.append(node("p", "network-muted", "Введи минимум два символа."));
      return;
    }

    try {
      const data = await api(`/api/social/users/search?q=${encodeURIComponent(query)}`);
      const users = Array.isArray(data.users) ? data.users : [];
      if (!users.length) {
        results.append(node("p", "network-muted", "Пользователи не найдены."));
        return;
      }
      for (const person of users) {
        const { row, actions } = renderPersonBase(person);
        const profile = profileLink(person);
        if (profile) actions.append(profile);
        if (person.friendship_status === "none") {
          const add = button("+ В друзья");
          add.addEventListener("click", async () => {
            try {
              add.disabled = true;
              await api("/api/social/friends/requests", {
                method: "POST",
                body: JSON.stringify({ user_id: person.id }),
              });
              await refreshFriends({ silent: true });
              await searchPeople();
              setStatus(`Заявка пользователю ${person.username} отправлена.`);
            } catch (error) {
              setStatus(error.message, true);
            } finally {
              add.disabled = false;
            }
          });
          actions.append(add);
        } else if (person.friendship_status === "accepted") {
          const message = node("a", "network-button", "Написать");
          message.href = `/messages.html?user=${person.id}`;
          actions.append(message);
        } else {
          actions.append(node("span", "network-muted", person.request_direction === "incoming" ? "Заявка тебе" : "Заявка отправлена"));
        }
        results.append(row);
      }
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  function threadButton({ type, id, title, subtitle, avatarUrl, unread }) {
    const element = node("button", "network-thread");
    element.type = "button";
    if (state.active?.type === type && state.active?.id === id) {
      element.classList.add("is-active");
    }
    if (avatarUrl) {
      const image = avatar(avatarUrl, "");
      image.className = "network-thread__avatar";
      element.append(image);
    } else {
      const placeholder = node("div", "network-thread__avatar", "#");
      placeholder.style.display = "grid";
      placeholder.style.placeItems = "center";
      element.append(placeholder);
    }
    const copy = node("div", "network-thread__copy");
    copy.append(node("strong", "", title));
    copy.append(node("small", "", subtitle || ""));
    element.append(copy);
    if (unread > 0) element.append(node("span", "network-thread__badge", String(Math.min(unread, 99))));
    element.addEventListener("click", () => openThread(type, id));
    return element;
  }

  function renderThreadLists() {
    const directList = qs("[data-direct-thread-list]");
    const groupList = qs("[data-group-thread-list]");
    if (!directList || !groupList) return;

    directList.replaceChildren();
    directList.append(node("div", "network-threads__head", "Личные"));
    for (const friend of state.friends) {
      directList.append(threadButton({
        type: "direct",
        id: Number(friend.id),
        title: friend.voice_alias || friend.username,
        subtitle: friend.last_message_at ? formatTime(friend.last_message_at) : friend.status_text || "Начать диалог",
        avatarUrl: friend.avatar_url,
        unread: Number(friend.unread_count || 0),
      }));
    }
    if (!state.friends.length) directList.append(node("p", "network-muted", "Добавь друзей, чтобы начать переписку."));

    groupList.replaceChildren();
    groupList.append(node("div", "network-threads__head", "Группы"));
    for (const group of state.groups) {
      groupList.append(threadButton({
        type: "group",
        id: Number(group.id),
        title: group.name,
        subtitle: group.last_message_body || `${group.member_count} участников`,
        avatarUrl: "",
        unread: Number(group.unread_count || 0),
      }));
    }
    if (!state.groups.length) groupList.append(node("p", "network-muted", "Групп пока нет."));
  }

  async function openThread(type, id, { silent = false } = {}) {
    const numericId = Number(id);
    if (!numericId) return;
    state.active = { type, id: numericId };
    renderThreadLists();
    if (!silent) setStatus("");

    try {
      if (type === "direct") {
        const friend = state.friends.find((item) => Number(item.id) === numericId);
        if (!friend) throw new Error("Диалог недоступен");
        const data = await api(`/api/social/conversations/${numericId}`);
        state.activeMessages = Array.isArray(data.messages) ? data.messages : [];
        const lastIncoming = [...state.activeMessages].reverse().find((message) => Number(message.sender_id) === numericId);
        if (lastIncoming) {
          await api("/api/social/messages/read", {
            method: "POST",
            body: JSON.stringify({ friend_id: numericId, up_to_id: lastIncoming.id }),
          });
        }
        renderDirectChat(friend);
      } else {
        const [groupData, messageData] = await Promise.all([
          api(`/api/social/groups/${numericId}`),
          api(`/api/social/groups/${numericId}/messages`),
        ]);
        state.activeGroup = groupData.group;
        state.activeMessages = Array.isArray(messageData.messages) ? messageData.messages : [];
        const last = state.activeMessages[state.activeMessages.length - 1];
        await api(`/api/social/groups/${numericId}/read`, {
          method: "POST",
          body: JSON.stringify(last ? { up_to_id: last.id } : {}),
        });
        renderGroupChat(groupData.group);
      }
      await Promise.all([
        refreshFriends({ silent: true }),
        refreshGroups({ silent: true }),
      ]);
    } catch (error) {
      if (!silent) setStatus(error.message, true);
    }
  }

  function messageNode(message, isOwn, author = "") {
    const bubble = node("article", `network-message${isOwn ? " is-own" : ""}`);
    if (author) bubble.append(node("div", "network-message__author", author));
    if (message.body) bubble.append(node("div", "network-message__body", message.body));
    if (message.kind === "screenshot" && message.attachment_url) {
      const image = document.createElement("img");
      image.src = message.attachment_url;
      image.alt = "Скриншот";
      image.loading = "lazy";
      bubble.append(image);
    }
    bubble.append(node("div", "network-message__time", formatTime(message.created_at)));
    return bubble;
  }

  function baseChatHead(title, subtitle = "") {
    const head = node("div", "network-chat__head");
    const copy = node("div", "");
    copy.append(node("span", "network-kicker", "ZIREN MESSENGER"));
    copy.append(node("h2", "", title));
    if (subtitle) copy.append(node("small", "network-muted", subtitle));
    head.append(copy);
    const actions = node("div", "network-actions");
    head.append(actions);
    return { head, actions };
  }

  function renderDirectChat(friend) {
    const pane = qs("[data-chat-pane]");
    if (!pane) return;
    pane.replaceChildren();

    const { head, actions } = baseChatHead(friend.voice_alias || friend.username, friend.username);
    const profile = profileLink(friend);
    if (profile) actions.append(profile);
    pane.append(head);

    const messages = node("div", "network-messages");
    if (!state.activeMessages.length) {
      messages.append(node("div", "network-empty", "Сообщений пока нет. Напиши первым."));
    } else {
      for (const message of state.activeMessages) {
        messages.append(messageNode(message, Number(message.sender_id) === Number(state.session.id)));
      }
    }
    pane.append(messages);

    const compose = node("form", "network-compose");
    const input = document.createElement("input");
    input.className = "network-input";
    input.maxLength = 4000;
    input.placeholder = "Сообщение…";
    const send = button("Отправить");
    send.type = "submit";
    compose.append(input, send);
    compose.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = input.value.trim();
      if (!body) return;
      try {
        send.disabled = true;
        await api("/api/social/messages", {
          method: "POST",
          body: JSON.stringify({ recipient_id: friend.id, kind: "text", body }),
        });
        input.value = "";
        await openThread("direct", friend.id, { silent: true });
      } catch (error) {
        setStatus(error.message, true);
      } finally {
        send.disabled = false;
        input.focus();
      }
    });
    pane.append(compose);
    requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight; });
  }

  function renderGroupChat(group) {
    const pane = qs("[data-chat-pane]");
    if (!pane) return;
    pane.replaceChildren();

    const { head, actions } = baseChatHead(group.name, `${group.members.length} участников · ${group.role}`);
    const manage = button("Участники", "network-button network-button--ghost");
    manage.addEventListener("click", () => renderGroupManager(group));
    actions.append(manage);
    pane.append(head);

    const messages = node("div", "network-messages");
    if (!state.activeMessages.length) {
      messages.append(node("div", "network-empty", "Это начало группы. Напиши первое сообщение."));
    } else {
      for (const message of state.activeMessages) {
        messages.append(messageNode(
          message,
          Number(message.sender_id) === Number(state.session.id),
          Number(message.sender_id) === Number(state.session.id) ? "" : message.sender_username,
        ));
      }
    }
    pane.append(messages);

    const compose = node("form", "network-compose");
    const input = document.createElement("input");
    input.className = "network-input";
    input.maxLength = 4000;
    input.placeholder = `Сообщение в «${group.name}»…`;
    const send = button("Отправить");
    send.type = "submit";
    compose.append(input, send);
    compose.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = input.value.trim();
      if (!body) return;
      try {
        send.disabled = true;
        await api(`/api/social/groups/${group.id}/messages`, {
          method: "POST",
          body: JSON.stringify({ body }),
        });
        input.value = "";
        await openThread("group", group.id, { silent: true });
      } catch (error) {
        setStatus(error.message, true);
      } finally {
        send.disabled = false;
        input.focus();
      }
    });
    pane.append(compose);
    requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight; });
  }

  function renderGroupManager(group) {
    const pane = qs("[data-chat-pane]");
    if (!pane) return;
    pane.replaceChildren();
    const { head, actions } = baseChatHead(group.name, "Управление группой");
    const back = button("← В чат", "network-button network-button--ghost");
    back.addEventListener("click", () => renderGroupChat(group));
    actions.append(back);
    pane.append(head);

    const body = node("div", "network-messages");
    if (["owner", "admin"].includes(group.role)) {
      const settings = node("div", "network-card");
      const nameInput = document.createElement("input");
      nameInput.className = "network-input";
      nameInput.maxLength = 80;
      nameInput.value = group.name;
      const description = document.createElement("textarea");
      description.className = "network-textarea";
      description.maxLength = 280;
      description.value = group.description || "";
      const save = button("Сохранить группу");
      save.addEventListener("click", async () => {
        try {
          await api(`/api/social/groups/${group.id}`, {
            method: "PATCH",
            body: JSON.stringify({ name: nameInput.value, description: description.value }),
          });
          await openThread("group", group.id);
        } catch (error) {
          setStatus(error.message, true);
        }
      });
      settings.append(node("strong", "", "Название и описание"), nameInput, description, save);
      body.append(settings);
    }

    const members = node("div", "network-list");
    for (const member of group.members) {
      const row = node("div", "network-group-member");
      row.append(avatar(member.avatar_url, ""));
      const copy = node("div", "network-group-member__copy");
      copy.append(node("strong", "", member.username));
      copy.append(node("small", "", member.role === "owner" ? "Владелец" : member.role === "admin" ? "Администратор" : "Участник"));
      row.append(copy);
      const memberActions = node("div", "network-actions");
      const profile = profileLink(member);
      if (profile) memberActions.append(profile);
      if (group.role === "owner" && member.role !== "owner") {
        const promote = button(member.role === "admin" ? "Снять админа" : "Сделать админом", "network-button network-button--ghost");
        promote.addEventListener("click", async () => {
          try {
            await api(`/api/social/groups/${group.id}/members/${member.id}`, {
              method: "PATCH",
              body: JSON.stringify({ role: member.role === "admin" ? "member" : "admin" }),
            });
            await openThread("group", group.id);
            renderGroupManager(state.activeGroup);
          } catch (error) {
            setStatus(error.message, true);
          }
        });
        memberActions.append(promote);
      }
      const canRemove = Number(member.id) === Number(state.session.id)
        ? member.role !== "owner"
        : ["owner", "admin"].includes(group.role) && member.role === "member";
      if (canRemove) {
        const remove = button(Number(member.id) === Number(state.session.id) ? "Покинуть" : "Удалить", "network-button network-button--danger");
        remove.addEventListener("click", async () => {
          try {
            await api(`/api/social/groups/${group.id}/members/${member.id}`, { method: "DELETE" });
            if (Number(member.id) === Number(state.session.id)) {
              state.active = null;
              await refreshGroups();
              renderThreadLists();
              pane.replaceChildren(node("div", "network-empty", "Ты покинул группу."));
            } else {
              await openThread("group", group.id);
              renderGroupManager(state.activeGroup);
            }
          } catch (error) {
            setStatus(error.message, true);
          }
        });
        memberActions.append(remove);
      }
      row.append(memberActions);
      members.append(row);
    }
    body.append(node("h3", "", "Участники"), members);

    if (["owner", "admin"].includes(group.role)) {
      const currentIds = new Set(group.members.map((member) => Number(member.id)));
      const available = state.friends.filter((friend) => !currentIds.has(Number(friend.id)));
      if (available.length) {
        const addBox = node("div", "network-card");
        addBox.append(node("strong", "", "Добавить друга"));
        const select = document.createElement("select");
        select.className = "network-select";
        for (const friend of available) {
          const option = document.createElement("option");
          option.value = String(friend.id);
          option.textContent = friend.voice_alias || friend.username;
          select.append(option);
        }
        const add = button("Добавить");
        add.addEventListener("click", async () => {
          try {
            await api(`/api/social/groups/${group.id}/members`, {
              method: "POST",
              body: JSON.stringify({ user_id: Number(select.value) }),
            });
            await openThread("group", group.id);
            renderGroupManager(state.activeGroup);
          } catch (error) {
            setStatus(error.message, true);
          }
        });
        addBox.append(select, add);
        body.append(addBox);
      }
    }

    if (group.role === "owner") {
      const danger = button("Удалить группу", "network-button network-button--danger");
      danger.addEventListener("click", async () => {
        if (!window.confirm(`Удалить группу «${group.name}» и всю её историю?`)) return;
        try {
          await api(`/api/social/groups/${group.id}`, { method: "DELETE" });
          state.active = null;
          await refreshGroups();
          pane.replaceChildren(node("div", "network-empty", "Группа удалена."));
        } catch (error) {
          setStatus(error.message, true);
        }
      });
      body.append(danger);
    }

    pane.append(body);
  }

  function setupGroupModal() {
    const modal = qs("[data-group-modal]");
    const form = qs("[data-create-group-form]");
    const picker = qs("[data-group-member-picker]");
    if (!modal || !form || !picker) return;

    function open() {
      picker.replaceChildren();
      for (const friend of state.friends) {
        const label = document.createElement("label");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.value = String(friend.id);
        label.append(input, avatar(friend.avatar_url, ""), node("span", "", friend.voice_alias || friend.username));
        picker.append(label);
      }
      if (!state.friends.length) picker.append(node("p", "network-muted", "Сначала добавь кого-нибудь в друзья."));
      modal.hidden = false;
    }

    function close() {
      modal.hidden = true;
    }

    qsa("[data-create-group-open]").forEach((element) => element.addEventListener("click", open));
    qsa("[data-create-group-close]").forEach((element) => element.addEventListener("click", close));
    modal.addEventListener("click", (event) => {
      if (event.target === modal) close();
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const memberIds = qsa('input[type="checkbox"]:checked', picker).map((input) => Number(input.value));
      try {
        const result = await api("/api/social/groups", {
          method: "POST",
          body: JSON.stringify({
            name: String(data.get("name") || "").trim(),
            description: String(data.get("description") || "").trim(),
            member_ids: memberIds,
          }),
        });
        form.reset();
        close();
        await refreshGroups();
        await openThread("group", result.group.id);
        setStatus("Группа создана и синхронизирована с приложением.");
      } catch (error) {
        setStatus(error.message, true);
      }
    });
  }

  function setupFriendsInteractions() {
    const input = qs("[data-user-search]");
    const search = qs("[data-user-search-button]");
    if (search) search.addEventListener("click", searchPeople);
    if (input) {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          searchPeople();
        }
      });
    }
    const privacy = qs("[data-friends-privacy]");
    if (privacy) {
      privacy.addEventListener("change", async () => {
        const requested = privacy.checked;
        try {
          privacy.disabled = true;
          await api("/api/social/privacy", {
            method: "PATCH",
            body: JSON.stringify({ show_friends_on_profile: requested }),
          });
          state.friendsPrivacy = requested;
          setStatus("Видимость друзей сохранена.");
        } catch (error) {
          privacy.checked = !requested;
          setStatus(error.message, true);
        } finally {
          privacy.disabled = false;
        }
      });
    }
  }

  async function initMessagesPage() {
    setupGroupModal();
    await Promise.all([refreshFriends(), refreshGroups()]);
    renderThreadLists();

    const params = new URLSearchParams(window.location.search);
    const userId = Number(params.get("user"));
    const groupId = Number(params.get("group"));
    if (groupId && state.groups.some((group) => Number(group.id) === groupId)) {
      await openThread("group", groupId);
    } else if (userId && state.friends.some((friend) => Number(friend.id) === userId)) {
      await openThread("direct", userId);
    }

    state.pollId = window.setInterval(() => {
      if (state.active) void openThread(state.active.type, state.active.id, { silent: true });
    }, 3200);
    state.listPollId = window.setInterval(() => {
      void refreshFriends({ silent: true });
      void refreshGroups({ silent: true });
    }, 7000);
  }

  async function initFriendsPage() {
    setupFriendsInteractions();
    await refreshFriends();
    state.listPollId = window.setInterval(() => void refreshFriends({ silent: true }), 7000);
  }

  async function init() {
    try {
      await requireSession();
      if (page === "friends") await initFriendsPage();
      if (page === "messages") await initMessagesPage();
    } catch (error) {
      setStatus(error.message || "Не удалось открыть Ziren Network", true);
    }
  }

  window.addEventListener("beforeunload", () => {
    if (state.pollId) window.clearInterval(state.pollId);
    if (state.listPollId) window.clearInterval(state.listPollId);
  });

  void init();
})();
