import "./sync.js"; // устанавливает автосинхронизацию — см. её же комментарий про перехват fetch
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
import { renderStats } from "./stats.js";
import { renderFamilyTree } from "./family-tree.js";
import { renderContinuity } from "./continuity.js";
import { fillWithDemoData } from "./data-panel.js";
import { renderSettings } from "./settings-panel.js";
import { renderTrash, trashCount } from "./trash.js";
import { initProjectSwitcher } from "./project-switcher.js";
import { initUpdateBanner } from "./update-banner.js";
import { applyTheme } from "./theme.js";
import { applyLabels } from "./labels.js";
import { applyTabVisibility, getHiddenTabs } from "./visibility.js";
import { initSearch, openSearch } from "./search.js";
import { initShortcuts, loadShortcuts } from "./shortcuts.js";
import { maybeShowOnboarding } from "./onboarding.js";
import { loadLang, i18n } from "./i18n.js";

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
  familytree: renderFamilyTree,
  stats: renderStats,
  continuity: renderContinuity,
  trash: renderTrash,
  settings: renderSettings,
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

document.getElementById("searchTrigger").addEventListener("click", () => openSearch());
initSearch((module, focusId) => openModule(module, focusId));
initShortcuts((module) => openModule(module));

// Клик по @упоминанию в тексте главы (mentions.js) — открывает карточку
// персонажа в модуле «Персонажи», а не только подсвечивает имя.
document.addEventListener("fictaris:open-character", (e) => {
  openModule("characters", e.detail.id);
});

// Граф проекта (graph.js) держит персонажей, локаций и фракций в одном
// SVG — при клике на узел нужно открыть три разных модуля одним и тем
// же обработчиком, поэтому отдельное общее событие с типом сущности,
// а не переиспользование fictaris:open-character (та завязана именно
// на модуль «Персонажи» и используется @упоминаниями в тексте главы).
const ENTITY_MODULES = { character: "characters", location: "locations", faction: "factions" };
document.addEventListener("fictaris:open-entity", (e) => {
  const module = ENTITY_MODULES[e.detail.type];
  if (module) openModule(module, e.detail.id);
});

const trashBadge = document.getElementById("trashBadge");
async function refreshTrashBadge() {
  const n = await trashCount().catch(() => 0);
  trashBadge.textContent = n > 0 ? String(n) : "";
}
document.addEventListener("fictaris:trash-changed", refreshTrashBadge);

async function boot() {
  await loadLang(); // до всего остального — applyLabels и любой другой i18n() ниже должны видеть уже загруженный язык
  applyTheme(); // независимо от info — кэш уже применён инлайн-скриптом, здесь только свежие данные
  applyLabels();
  applyTabVisibility();
  loadShortcuts();
  const searchTriggerText = document.getElementById("searchTrigger").childNodes[0];
  if (searchTriggerText) searchTriggerText.textContent = `${i18n("🔍 Поиск")} `;
  const info = await apiGet("/api/app/info").catch(() => ({ vaultPath: null }));
  if (!info.vaultPath) {
    location.href = "/welcome";
    return;
  }
  const hidden = await getHiddenTabs();
  const defaultModule = hidden.includes("manuscript")
    ? Object.keys(MODULES).find((key) => key !== "settings" && !hidden.includes(key)) || "settings"
    : "manuscript";
  openModule(defaultModule);
  refreshTrashBadge();
  initProjectSwitcher();
  maybeShowOnboarding({ onFillDemo: fillWithDemoData });
  // На телефоне обновления проверяет сам mobile.bundle.js (полностью на
  // клиенте, без /api/app/update-status) — там своя полоска.
  if (!info.mobile) initUpdateBanner();
}

boot();
