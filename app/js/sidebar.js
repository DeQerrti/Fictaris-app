import { i18n } from "./i18n.js";
import { openPopover, closeMenu } from "./context-menu.js";

// ══════════════════════════════════════════════
//  САЙДБАР — вид панели и изменение ширины
//
//  Вид панели — одна кнопка внизу с тремя вариантами: развёрнута,
//  только иконки (узкая полоса, как в VS Code) и «прятать» — сайдбар
//  сжимается до тонкой полосы и разворачивается поверх контента при
//  наведении, как панель задач Windows (сам разворот — чистый CSS,
//  :hover в style.css). Раньше это были две одинаковые на вид кнопки у
//  логотипа, и что каждая делает, было не понять. Отдельно —
//  растягивание (Обсидиан): перетаскивание правого края меняет
//  постоянную ширину.
//
//  Оба хранятся в localStorage, а не в site-settings.json: это
//  предпочтение конкретного устройства/экрана, а не проекта — ширина
//  удобного сайдбара на ноутбуке и на мониторе разная, и синхронизировать
//  её между устройствами было бы неверно (в отличие от темы или языка,
//  общих для всего хранилища).
// ══════════════════════════════════════════════

const WIDTH_KEY = "fictaris_sidebar_width";
const PINNED_KEY = "fictaris_sidebar_pinned";
const COLLAPSED_KEY = "fictaris_sidebar_collapsed";
const MIN_WIDTH = 220;
const MAX_WIDTH = 420;
// Плитки «Мира» в два столбца и карточка «Сейчас пишу» с названием
// главы — уже 240 тесновато; 264 — по-прежнему в разумных для такой
// панели 240—300px.
const DEFAULT_WIDTH = 264;

function clampWidth(w) {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));
}

function readWidth() {
  const raw = Number(localStorage.getItem(WIDTH_KEY));
  return Number.isFinite(raw) && raw > 0 ? clampWidth(raw) : DEFAULT_WIDTH;
}

// По умолчанию — закреплён (как раньше, всегда виден): авто-скрытие
// включают сознательно, а не находят однажды свёрнутым без объяснений.
function readPinned() {
  const raw = localStorage.getItem(PINNED_KEY);
  return raw === null ? true : raw === "1";
}

function readCollapsed() {
  return localStorage.getItem(COLLAPSED_KEY) === "1";
}

const MODES = [
  ["full", "Развёрнута", "Подписи, счётчики, «Сейчас пишу»"],
  ["icons", "Только иконки", "Узкая полоса, подсказки при наведении"],
  ["hide", "Прятать", "Выезжает при наведении на край, как панель задач"],
];

// Те же два ключа localStorage, что и раньше, — выбранный вид у тех, кто
// уже настроил панель, не сбрасывается.
function readMode() {
  if (!readPinned()) return "hide";
  return readCollapsed() ? "icons" : "full";
}

function writeMode(mode) {
  localStorage.setItem(PINNED_KEY, mode === "hide" ? "0" : "1");
  localStorage.setItem(COLLAPSED_KEY, mode === "icons" ? "1" : "0");
}

export function initSidebar() {
  const appEl = document.getElementById("app");
  const sidebar = document.querySelector(".sidebar");
  const handle = document.getElementById("sidebarResizeHandle");
  const modeBtn = document.getElementById("sidebarMode");
  if (!appEl || !sidebar) return;

  document.documentElement.style.setProperty("--sidebar-width", `${readWidth()}px`);

  let mode = readMode();
  function applyMode() {
    appEl.classList.toggle("sidebar-autohide", mode === "hide");
    appEl.classList.toggle("sidebar-collapsed", mode === "icons");
  }
  applyMode();

  modeBtn?.addEventListener("click", () => {
    const list = document.createElement("div");
    list.className = "sb-mode-menu";
    const title = document.createElement("div");
    title.className = "sb-mode-title";
    title.textContent = i18n("Вид панели");
    list.appendChild(title);
    for (const [key, label, hint] of MODES) {
      const opt = document.createElement("button");
      opt.className = "sb-mode-opt" + (key === mode ? " active" : "");
      opt.innerHTML = `<span class="sb-mode-radio"></span><span><span class="sb-mode-label"></span><span class="sb-mode-hint"></span></span>`;
      opt.querySelector(".sb-mode-label").textContent = i18n(label);
      opt.querySelector(".sb-mode-hint").textContent = i18n(hint);
      opt.addEventListener("click", () => {
        mode = key;
        writeMode(mode);
        applyMode();
        closeMenu();
      });
      list.appendChild(opt);
    }
    const rect = modeBtn.getBoundingClientRect();
    openPopover(rect.right + 8, rect.bottom, list, "sb-mode-popover");
  });

  // ── Растягивание (перетаскивание правого края) ──
  let dragging = false;
  handle?.addEventListener("mousedown", (e) => {
    e.preventDefault();
    dragging = true;
    handle.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    document.documentElement.style.setProperty("--sidebar-width", `${clampWidth(e.clientX)}px`);
  });
  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    const current = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--sidebar-width"), 10);
    localStorage.setItem(WIDTH_KEY, String(current || DEFAULT_WIDTH));
  });
}
