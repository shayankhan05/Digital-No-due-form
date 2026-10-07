const THEME_KEY = "digitalNoDueTheme";

export function initThemeToggle() {
  const button = document.getElementById("themeToggle");

  // Get previously saved theme
  const savedTheme =
    localStorage.getItem(THEME_KEY) || "light";

  applyTheme(savedTheme);

  if (!button) return;

  updateButton(button, savedTheme);

  button.addEventListener("click", () => {
    const isDark =
      document.documentElement.getAttribute("data-theme") === "dark";

    const newTheme = isDark ? "light" : "dark";

    applyTheme(newTheme);

    localStorage.setItem(THEME_KEY, newTheme);

    updateButton(button, newTheme);
  });
}


function applyTheme(theme) {

  // METHOD 1 — data-theme on HTML
  document.documentElement.setAttribute(
    "data-theme",
    theme
  );

  // METHOD 2 — class on BODY
  if (theme === "dark") {
    document.body.classList.add("dark-theme");
    document.body.classList.add("dark");
  } else {
    document.body.classList.remove("dark-theme");
    document.body.classList.remove("dark");
  }
}


function updateButton(button, theme) {

  if (theme === "dark") {
    button.textContent = "☀️";
    button.title = "Switch to light mode";
  } else {
    button.textContent = "🌙";
    button.title = "Switch to dark mode";
  }

}