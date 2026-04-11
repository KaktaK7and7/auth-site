async function updateAuthUI() {
  try {
    const response = await fetch("/api/me", {
      method: "GET",
      credentials: "include",
      cache: "no-store"
    });

    const data = await response.json();
    const authContainers = document.querySelectorAll("[data-auth-container]");

    authContainers.forEach((container) => {
      if (data.loggedIn && data.user) {
        container.innerHTML = `
          <a class="btn btn-secondary" href="/profile">${data.user.username}</a>
        `;
      } else {
        container.innerHTML = `
          <a class="btn btn-secondary" href="/login.html">Войти</a>
        `;
      }
    });
  } catch (error) {
    console.error("Ошибка проверки авторизации:", error);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  updateAuthUI();
});