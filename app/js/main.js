import { apiGet } from "./api.js";
import { renderManuscript } from "./manuscript.js";
import { renderCharacters } from "./characters.js";
import { renderLocations } from "./locations.js";
import { renderRelationships } from "./relationships.js";
import { renderFactions } from "./factions.js";
import { renderTimeline } from "./timeline.js";
import { renderBoard } from "./board.js";
import { renderMap } from "./map.js";
import { renderGraph } from "./graph.js";
import { renderContinuity } from "./continuity.js";
import { renderData } from "./data-panel.js";
import { renderTrash, trashCount } from "./trash.js";
import { initProjectSwitcher } from "./project-switcher.js";
import { initUpdateBanner } from "./update-banner.js";
import { applyTheme } from "./theme.js";

const MODULES = {
  manuscript: renderManuscript,
  characters: renderCharacters,
  locations: renderLocations,
  relationships: renderRelationships,
  factions: renderFactions,
  timeline: renderTimeline,
  board: renderBoard,
  map: renderMap,
  graph: renderGraph,
  continuity: renderContinuity,
  trash: renderTrash,
  data: renderData,
};

const content = document.getElementById("content");
const navItems = document.querySelectorAll(".nav-item");
const appEl = document.getElementById("app");
const sidebarToggle = document.getElementById("sidebarToggle");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");

async function openModule(name, arg) {
  // Фокус-режим рукописи прячет сайдбар классом на body (manuscript.js) —
  // сбрасываем его при любом переключении модуля, иначе уйти со
  // страницы, скрывшей навигацию, можно было бы только через Esc.
  document.body.classList.remove("focus-mode");
  navItems.forEach((btn) => btn.classList.toggle("active", btn.dataset.module === name));
  content.innerHTML = "";
  await MODULES[name](content, arg);
  appEl.classList.remove("sidebar-open"); // на телефоне — сайдбар выезжающий, после выбора закрываем
}

navItems.forEach((btn) => {
  btn.addEventListener("click", () => openModule(btn.dataset.module));
});

sidebarToggle.addEventListener("click", () => appEl.classList.toggle("sidebar-open"));
sidebarBackdrop.addEventListener("click", () => appEl.classList.remove("sidebar-open"));

// Клик по @упоминанию в тексте главы (mentions.js) — открывает карточку
// персонажа в модуле «Персонажи», а не только подсвечивает имя.
document.addEventListener("fictaris:open-character", (e) => {
  openModule("characters", e.detail.id);
});

const trashBadge = document.getElementById("trashBadge");
async function refreshTrashBadge() {
  const n = await trashCount().catch(() => 0);
  trashBadge.textContent = n > 0 ? String(n) : "";
}
document.addEventListener("fictaris:trash-changed", refreshTrashBadge);

async function boot() {
  applyTheme(); // независимо от info — кэш уже применён инлайн-скриптом, здесь только свежие данные
  const info = await apiGet("/api/app/info").catch(() => ({ vaultPath: null }));
  if (!info.vaultPath) {
    location.href = "/welcome";
    return;
  }
  openModule("manuscript");
  refreshTrashBadge();
  initProjectSwitcher();
  // На телефоне обновления проверяет сам mobile.bundle.js (полностью на
  // клиенте, без /api/app/update-status) — там своя полоска.
  if (!info.mobile) initUpdateBanner();
}

boot();
