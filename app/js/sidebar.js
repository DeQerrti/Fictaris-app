import { i18n } from "./i18n.js";

// ══════════════════════════════════════════════
//  САЙДБАР — авто-скрытие и изменение ширины
//
//  Два независимых способа управлять пространством сайдбара, оба по
//  образцам с рабочего стола: авто-скрытие (Windows) — сайдбар сжимается
//  до тонкой полосы и разворачивается поверх контента при наведении, не
//  сдвигая его (сам разворот — чистый CSS, :hover в style.css); и
//  растягивание (Обсидиан) — перетаскивание правого края меняет
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
const MIN_WIDTH = 160;
const MAX_WIDTH = 420;
const DEFAULT_WIDTH = 200;

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

export function initSidebar() {
  const appEl = document.getElementById("app");
  const sidebar = document.querySelector(".sidebar");
  const handle = document.getElementById("sidebarResizeHandle");
  const pinBtn = document.getElementById("sidebarPin");
  if (!appEl || !sidebar) return;

  document.documentElement.style.setProperty("--sidebar-width", `${readWidth()}px`);

  let pinned = readPinned();
  function applyPinned() {
    appEl.classList.toggle("sidebar-autohide", !pinned);
    if (!pinBtn) return;
    pinBtn.classList.toggle("pinned", pinned);
    pinBtn.title = pinned
      ? i18n("Меню закреплено — нажми, чтобы сворачивать его и разворачивать по наведению")
      : i18n("Меню сворачивается — нажми, чтобы закрепить его открытым");
  }
  applyPinned();

  pinBtn?.addEventListener("click", () => {
    pinned = !pinned;
    localStorage.setItem(PINNED_KEY, pinned ? "1" : "0");
    applyPinned();
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
