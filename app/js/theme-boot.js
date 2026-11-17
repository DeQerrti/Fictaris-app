// Тема из кэша — синхронно, до первой отрисовки, иначе долю секунды
// видно тёмную тему по умолчанию, а потом она подменяется на
// выбранную (см. app/js/theme.js, applyTheme). Сеть на телефоне и на
// компьютере отвечает не мгновенно, а мигание темы при каждой
// загрузке страницы — то, чего этот кэш и должен избежать. Обычный
// скрипт, не модуль; отдельным файлом, а не встроенным в index.html, —
// ради Content-Security-Policy без 'unsafe-inline' для скриптов.
try {
  const cached = JSON.parse(localStorage.getItem("fictaris_theme_cache") || "null");
  if (cached && cached.skin) {
    document.documentElement.setAttribute("data-skin", cached.skin);
    // Та же карта ключ→CSS-переменная, что и CUSTOM_COLOR_TOKENS в
    // app/js/theme.js — здесь копия нарочно: это синхронный инлайн-
    // скрипт до всякой загрузки модулей, ему взять её больше неоткуда.
    const CSS_VAR = {
      bg: "--bg", panelAlt: "--panel-alt", card: "--card", panel: "--panel",
      border: "--border", text: "--text", textDim: "--text-dim", textFaint: "--text-faint",
    };
    const vars = [];
    if (/^#[0-9a-f]{6}$/i.test(cached.accent || "")) vars.push(`--accent: ${cached.accent}`);
    for (const [key, cssVar] of Object.entries(CSS_VAR)) {
      const v = cached.customColors && cached.customColors[key];
      if (/^#[0-9a-f]{6}$/i.test(v || "")) vars.push(`${cssVar}: ${v}`);
    }
    if (vars.length) {
      const style = document.createElement("style");
      style.id = "theme-overrides";
      style.textContent = `:root { ${vars.join("; ")}; }`;
      document.head.appendChild(style);
    }
  }
} catch {}
