import { apiGet, apiPost } from "./api.js";

// ══════════════════════════════════════════════
//  ТЕМА
//
//  По образцу TasteID (app/js/theme.js), сильно сокращено под масштаб
//  Fictaris: две темы вместо десяти, один акцентный цвет вместо девяти
//  переопределяемых токенов — но тот же принцип (реестр тем + CSS-
//  переменные + кэш в localStorage от мигания при загрузке).
//
//  Сами цвета тем лежат в style.css, в блоках [data-skin="..."].
//  Здесь — только выбор темы и пересчёт акцента.
// ══════════════════════════════════════════════

export const THEME_PRESETS = {
  dark: { label: "Тёмная", hint: "Стол писателя ночью", direction: "lighten" },
  light: { label: "Пергамент", hint: "Тёплая бумага", defaultAccent: "#a4653a", direction: "darken" },
};

const CACHE_KEY = "fictaris_theme_cache";

function isHex(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function hexToRgb(hex) {
  const m = hex.replace("#", "");
  return {
    r: parseInt(m.substring(0, 2), 16),
    g: parseInt(m.substring(2, 4), 16),
    b: parseInt(m.substring(4, 6), 16),
  };
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h, s;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Ховер-вариант акцента — светлее на тёмной теме, темнее на светлой:
// иначе на пергаменте акцент при наведении почти сливался бы с фоном.
function accentHover(hex, direction) {
  const { r, g, b } = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  const delta = direction === "darken" ? -14 : 14;
  return hslToHex(h, s, Math.min(96, Math.max(4, l + delta)));
}

function resolveAccent(settings, skin) {
  if (isHex(settings.accent)) return settings.accent;
  if (isHex(THEME_PRESETS[skin]?.defaultAccent)) return THEME_PRESETS[skin].defaultAccent;
  return null; // нет своего — используется акцент из CSS темы как есть
}

function applyOverrides(skin, accent) {
  document.documentElement.setAttribute("data-skin", skin);
  let style = document.getElementById("theme-overrides");
  if (!style) {
    style = document.createElement("style");
    style.id = "theme-overrides";
    document.head.appendChild(style);
  }
  if (!accent) {
    style.textContent = "";
    return;
  }
  const hover = accentHover(accent, THEME_PRESETS[skin]?.direction || "lighten");
  style.textContent = `:root { --accent: ${accent}; --accent-hover: ${hover}; }`;
}

// Сообщает окну Electron, в какие цвета красить кнопки
// свернуть/развернуть/закрыть (electron/chrome.js) — рамка рисуется
// системой, а не CSS, поэтому её не перекрасить обычными стилями. На
// вебе/телефоне такого адреса нет — тихий catch, это не ошибка.
function syncTitleBarColors(skin) {
  const cs = getComputedStyle(document.documentElement);
  const bg = cs.getPropertyValue("--bg").trim();
  const symbol = cs.getPropertyValue("--text-dim").trim();
  apiPost("/api/app/set-titlebar-colors", { bg, symbol, skin }).catch(() => {});
}

export async function applyTheme() {
  let settings = {};
  try {
    settings = (await apiGet("/api/site-settings")) || {};
  } catch {
    // нет файла/сети — остаёмся на теме по умолчанию
  }
  const skin = THEME_PRESETS[settings.theme] ? settings.theme : "dark";
  const accent = resolveAccent(settings, skin);
  applyOverrides(skin, accent);
  // Размер шрифта редактора (Настройки → Редактор) — читает --editor-font-size
  // .chapter-content в style.css. Тоже «как выглядит приложение», поэтому
  // применяется тут же, а не отдельным модулем.
  if (Number.isFinite(settings.editorFontSize)) {
    document.documentElement.style.setProperty("--editor-font-size", `${settings.editorFontSize}px`);
  }
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ skin, accent }));
  } catch {
    // приватный режим/квота — не страшно, это только кэш для FOUC
  }
  syncTitleBarColors(skin);
  return { theme: skin, accent: settings.accent || null };
}

// Вызывается из настроек — сохраняет и сразу применяет, без перезагрузки.
export async function saveTheme(patch) {
  const settings = (await apiGet("/api/site-settings").catch(() => ({}))) || {};
  const next = { ...settings, ...patch };
  await apiPost("/api/site-settings", next);
  return applyTheme();
}
