(() => {
  if (document.body.dataset.networkPage !== "friends") return;

  const profileByName = new Map();
  const wired = new WeakSet();
  let refreshTimer = null;

  async function readJson(path) {
    const response = await fetch(path, {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return null;
    return response.json();
  }

  function rememberPerson(person) {
    if (!person?.id || !person?.username) return;
    profileByName.set(String(person.username).toLocaleLowerCase("ru-RU"), {
      ...person,
      network_profile_url:
        person.network_profile_url || `/network-profile.html?id=${Number(person.id)}`,
    });
  }

  async function loadOwnCode() {
    const data = await readJson("/api/social/friend-code");
    const code = String(data?.friend_code || "");
    const target = document.querySelector("[data-friend-code]");
    const copy = document.querySelector("[data-copy-friend-code]");
    if (target) target.textContent = code || "Код недоступен";
    if (copy) {
      copy.disabled = !code;
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(code);
          const previous = copy.textContent;
          copy.textContent = "Скопировано";
          window.setTimeout(() => { copy.textContent = previous; }, 1500);
        } catch {
          copy.textContent = "Не удалось";
        }
      }, { once: true });
    }
  }

  async function refreshKnownPeople() {
    const friendsData = await readJson("/api/social/friends");
    for (const friend of friendsData?.friends || []) rememberPerson(friend);
    for (const request of friendsData?.requests || []) rememberPerson(request.user);

    const query = document.querySelector("[data-user-search]")?.value?.trim() || "";
    if (query.length >= 2) {
      const searchData = await readJson(
        `/api/social/users/search?q=${encodeURIComponent(query)}`,
      );
      for (const person of searchData?.users || []) rememberPerson(person);
    }

    applyProfileLinks();
  }

  function wireClickable(element, href, username) {
    if (!element || wired.has(element)) return;
    wired.add(element);
    element.style.cursor = "pointer";
    element.title = `Открыть профиль ${username}`;
    element.setAttribute("tabindex", "0");
    element.setAttribute("role", "link");
    const open = () => { window.location.href = href; };
    element.addEventListener("click", open);
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
  }

  function applyProfileLinks() {
    document.querySelectorAll(".network-person").forEach((row) => {
      const name = row.querySelector(".network-person__copy strong")?.textContent?.trim();
      if (!name) return;
      const person = profileByName.get(name.toLocaleLowerCase("ru-RU"));
      if (!person?.network_profile_url) return;

      wireClickable(row.querySelector("img"), person.network_profile_url, name);
      wireClickable(row.querySelector(".network-person__copy strong"), person.network_profile_url, name);

      const actions = row.querySelector(".network-actions");
      if (
        actions
        && !actions.querySelector('a[href^="/network-profile.html"]')
      ) {
        const link = document.createElement("a");
        link.className = "network-button network-button--ghost";
        link.href = person.network_profile_url;
        link.textContent = "Профиль";
        actions.prepend(link);
      }
    });
  }

  function scheduleRefresh() {
    if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      void refreshKnownPeople();
    }, 120);
  }

  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(document.body, { childList: true, subtree: true });

  document.querySelector("[data-user-search]")?.addEventListener("input", scheduleRefresh);
  document.querySelector("[data-user-search-button]")?.addEventListener("click", scheduleRefresh);

  void loadOwnCode();
  void refreshKnownPeople();
})();
