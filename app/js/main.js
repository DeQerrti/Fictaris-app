import { setSyncVault } from "./sync.js"; // заодно устанавливает автосинхронизацию — см. её же комментарий про перехват fetch
import { apiGet } from "./api.js";
import { renderManuscript } from "./manuscript.js";
import { renderCharacters } from "./characters.js";
import { renderLocations } from "./locations.js";
import { renderFactions } from "./factions.js";
import { renderTimeline } from "./timeline.js";
import { renderBoard } from "./board.js";
import { renderMap } from "./map.js";
import { renderGraph } from "./graph.js";
import { renderStats } from "./stats.js";
import { renderFamilyTree } from "./family-tree.js";
import { renderCanvas } from "./canvas.js";
import { renderKnowledge } from "./knowledge.js";
import { renderSection } from "./sections.js";
import { fillWithDemoData, isProjectEmpty, maybeRunHistoryCleanup } from "./data-panel.js";
import { renderSettings } from "./settings-panel.js";
import { initProjectSwitcher } from "./project-switcher.js";
import { initUpdateBanner } from "./update-banner.js";
import { applyTheme } from "./theme.js";
import { applyLabels } from "./labels.js";
import { applyNavIcons } from "./icons.js";
import { applyTabVisibility, applyTabOrder, getHiddenTabs } from "./visibility.js";
import { initSearch } from "./search.js";
import { initShortcuts, loadShortcuts } from "./shortcuts.js";
import { initSidebar } from "./sidebar.js";
import { maybeShowOnboarding } from "./onboarding.js";
import { loadLang, i18n } from "./i18n.js";
import { initEntityModal, openEntityModal, refreshEntityModal } from "./entity-modal.js";
import { initExternalChanges } from "./external-changes.js";
import { recordRecent } from "./recent-nav.js";
import { hasPendingSaves } from "./save-badge.js";
import { buildEmptyState } from "./chips.js";
import { initA11y } from "./a11y.js";
import { initErrorReport } from "./error-report.js";
initErrorReport();
import { loadCalendar } from "./calendar.js";
import { initSidebarOverview, refreshSidebar, openPanel } from "./sidebar-overview.js";

// Только окна поверх экрана — ни вкладкой, ни разделом «по умолчанию».
const MODAL_ONLY_MODULES = ["stats", "knowledge", "settings"];

const MODULES = {
  manuscript: renderManuscript,
  characters: renderCharacters,
  locations: renderLocations,
  factions: renderFactions,
  timeline: renderTimeline,
  board: renderBoard,
  map: renderMap,
  graph: renderGraph,
  familytree: renderFamilyTree,
  canvas: renderCanvas,
  section: renderSection,
  knowledge: renderKnowledge,
  stats: renderStats,
  settings: renderSettings,
};

const content = document.getElementById("content");
const navItems = document.querySelectorAll(".nav-item");
const appEl = document.getElementById("app");
const sidebarToggle = document.getElementById("sidebarToggle");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");
// Настройки — отдельная кнопка-значок рядом с названием, а не пункт
// в общем списке .nav-item: иначе она встряла бы первой в DOM-порядке
// и сбила нумерацию цифровых горячих клавиш 1—9 (shortcuts.js), которые
// считают именно по .nav-item.
const settingsBtn = document.getElementById("settingsBtn");
const statsBtn = document.getElementById("statsBtn");

// Счётчик запросов на переключение модуля — если кликнуть вкладку мышкой
// (её MODULES[name] может уйти в сеть за данными), а потом, не дожидаясь
// отрисовки, переключиться на другую через горячую клавишу, второй запрос
// обязан выиграть: без счётчика первый (более медленный) запрос дорисует
// свой модуль поверх уже выбранного новой вкладки — подсветка в сайдбаре
// будет показывать одно, а содержимое — другое.
let openRequestId = 0;
let currentModuleName = null;
let currentArg = null;

// Проверка и Корзина — окна из нижней строки сайдбара, а не вкладки
// (sidebar-overview.js); Настройки и Статистика — окна поверх экрана.
// Своя клавиша, поиск или ссылка на них открывают окно.
const PANEL_MODULES = ["continuity", "trash"];

function openSettings(tab) {
  openEntityModal("settings", tab, { panelClass: "settings-window" });
}

// С какого раздела открывать приложение — с того, где закрыли (своё на
// каждый мир; предпочтение устройства, не данные мира). В первый раз —
// Рукопись.
const LAST_MODULE_KEY = "fictaris_last_module";
let vaultId = "";

function rememberModule(name) {
  try {
    localStorage.setItem(`${LAST_MODULE_KEY}:${vaultId}`, name);
  } catch {
    /* приватный режим — просто не запомним */
  }
}

function lastModule() {
  try {
    return localStorage.getItem(`${LAST_MODULE_KEY}:${vaultId}`);
  } catch {
    return null;
  }
}

async function openModule(name, arg) {
  if (PANEL_MODULES.includes(name)) {
    openPanel(name, document.getElementById(name === "trash" ? "trashBtn" : "continuityBtn"));
    return;
  }
  if (name === "settings") return openSettings(arg);
  if (name === "stats") return openEntityModal("stats");
  const requestId = ++openRequestId;
  currentModuleName = name;
  currentArg = arg;
  // Фокус-режим рукописи прячет сайдбар классом на body (manuscript.js) —
  // сбрасываем его при любом переключении модуля, иначе уйти со
  // страницы, скрывшей навигацию, можно было бы только через Esc.
  document.body.classList.remove("focus-mode");
  navItems.forEach((btn) => btn.classList.toggle("active", btn.dataset.module === name));
  // Плитки своих разделов (sidebar-overview.js) — подсветку им ставит
  // сам раздел событием fictaris:section-shown.
  document.querySelectorAll(".nav-tile[data-section-id]").forEach((btn) => btn.classList.remove("active"));
  // Клик мышью оставляет активный фокус на нажатой кнопке — саму подсветку
  // выбора это не портит (она через .active, не :focus), но при живом
  // переключении по горячим клавишам старая кнопка иначе продолжает
  // выделяться браузерным контуром фокуса поверх новой активной. Явный
  // blur — самый надёжный способ снять этот контур независимо от того,
  // какая кнопка успела получить фокус до этого.
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && focused.classList.contains("nav-item")) {
    focused.blur();
  }
  // Каждый раздел рисуется в свой новый контейнер, а не прямо в общий
  // #content. Тогда раздел, который ещё догружается после переключения,
  // рисует в уже отсоединённый узел и не перетирает новый, а его
  // глобальные обработчики (клавиши Мастерской карты, Esc фокус-режима)
  // по проверке root.isConnected видят, что раздел закрыт.
  const host = document.createElement("div");
  host.className = "module-host";
  content.replaceChildren(host);
  try {
    await MODULES[name](host, arg);
  } catch (e) {
    // Раздел не открылся (например, его файл испорчен — см. api.js): вместо
    // пустого экрана говорим, что случилось.
    if (requestId !== openRequestId) return;
    host.replaceChildren(buildEmptyState(i18n("Не удалось открыть раздел: {error}", { error: e?.message || String(e) })));
    return;
  }
  if (requestId !== openRequestId) return; // за это время выбрали другой модуль — не перетираем его
  appEl.classList.remove("sidebar-open"); // на телефоне — сайдбар выезжающий, после выбора закрываем
  recordRecent(name, typeof arg === "string" ? arg : null);
  if (MODULES[name] && !MODAL_ONLY_MODULES.includes(name)) rememberModule(name);
}

navItems.forEach((btn) => {
  btn.addEventListener("click", () => openModule(btn.dataset.module));
});
settingsBtn.addEventListener("click", () => openSettings());
// Ctrl+, — как в большинстве программ.
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === ",") {
    e.preventDefault();
    openSettings();
  }
});
// Боковая панель (теги, поля анкеты, календарь) закрылась — раздел под
// ней перечитывает данные.
document.addEventListener("fictaris:reload-module", () => {
  setTimeout(() => {
    if (currentModuleName && !hasPendingSaves()) reloadAfterExternalChange();
  }, 700);
});
// Данные на диске заменили изнутри приложения — вернули из корзины,
// забрали синхронизацией (trash.js, sync.js). Отложенные правки к этому
// моменту уже дописаны, поэтому перечитываем сразу.
document.addEventListener("fictaris:data-replaced", () => {
  if (currentModuleName && !hasPendingSaves()) reloadAfterExternalChange();
  else refreshSidebar();
});
// Статистика больше не вкладка (одинокая узкая колонка с цифрами
// посреди пустого экрана) — модалка поверх текущего места, тем же
// entity-modal.js, что и карточка персонажа по клику на @упоминание.
statsBtn.addEventListener("click", () => openEntityModal("stats"));

sidebarToggle.addEventListener("click", () => appEl.classList.toggle("sidebar-open"));
sidebarBackdrop.addEventListener("click", () => appEl.classList.remove("sidebar-open"));

// Связь (search.js) больше не отдельный раздел — переход к найденной
// связи открывает персонажа charA, у которого она правится в дровере
// (characters.js, мини-редактор связей); search.js кладёт этот id в
// entry.id и не должен ничего знать про то, что раздел удалён. «Знания» —
// тоже больше не раздел, а модалка (см. MODAL_ONLY_MODULES выше) —
// переход туда из поиска открывает её тем же способом, что и кнопка
// «Знания» в рукописи, а не разворачивает во весь #content.
initSearch((module, focusId) => {
  if (module === "relationships") return openModule("characters", focusId);
  if (module === "knowledge") return openEntityModal("knowledge", focusId);
  return openModule(module, focusId);
});
initShortcuts((module) => openModule(module));
initA11y();

initEntityModal(MODULES);

// Клик по @упоминанию в тексте главы (mentions.js), по персонажу в
// «Отношениях» (graph.js) и похожим ссылкам — открывает карточку персонажа, а не
// только подсвечивает имя. Если сейчас открыт уже тот же модуль —
// просто переключаем фокус на месте (как и раньше); если открыт
// какой-то другой (отношения, рукопись, таймлайн…) — карточка всплывает
// модалкой поверх текущего экрана, а не уводит с него полной сменой
// модуля (см. entity-modal.js).
document.addEventListener("fictaris:open-character", (e) => {
  if (currentModuleName === "characters") openModule("characters", e.detail.id);
  else openEntityModal("characters", e.detail.id);
});

// Открыть персонажа, место или фракцию одним обработчиком (холст,
// «Отношения» и др.) — отдельное общее событие с типом сущности,
// а не переиспользование fictaris:open-character (та завязана именно
// на модуль «Персонажи» и используется @упоминаниями в тексте главы).
const ENTITY_MODULES = { character: "characters", location: "locations", faction: "factions", entry: "section" };
// Раздел удалили (sections.js) — уходим на другой.
document.addEventListener("fictaris:open-module", (e) => openModule(e.detail.module, e.detail.id));
document.addEventListener("fictaris:open-entity", (e) => {
  const module = ENTITY_MODULES[e.detail.type];
  if (!module) return;
  if (currentModuleName === module) openModule(module, e.detail.id);
  else openEntityModal(module, e.detail.id);
});

// Карточка холста, привязанная к главе (canvas.js, «Привязать к
// главе…») — клик открывает саму главу, тем же приёмом, что и открытие
// карточки персонажа выше.
document.addEventListener("fictaris:open-chapter", (e) => {
  if (currentModuleName === "manuscript") openModule("manuscript", e.detail.id);
  else openEntityModal("manuscript", e.detail.id);
});

// Файлы проекта поправили снаружи (external-changes.js) — открытый
// раздел перечитывает данные тем же рендером. Без arg: тот ведёт к
// карточке, с которой раздел когда-то открыли, а не к той, что открыта
// сейчас; глава рукописи и так помнится в manuscript.json. Прокрутку
// возвращаем руками — иначе каждая внешняя правка кидала бы наверх.
async function reloadAfterExternalChange() {
  if (currentModuleName) {
    const scroll = content.scrollTop;
    await openModule(currentModuleName, currentModuleName === "section" ? currentArg : undefined);
    content.scrollTop = scroll;
  }
  refreshEntityModal();
  refreshSidebar();
}
initExternalChanges(reloadAfterExternalChange);

async function boot() {
  await loadLang(); // до всего остального — applyLabels и любой другой i18n() ниже должны видеть уже загруженный язык
  applyTheme(); // независимо от info — кэш уже применён инлайн-скриптом, здесь только свежие данные
  loadCalendar(); // месяцы мира — полю «Дата мира» в анкетах (calendar.js, cachedCalendar)
  applyNavIcons();
  applyLabels();
  applyTabOrder();
  applyTabVisibility();
  loadShortcuts();
  initSidebar();
  const info = await apiGet("/api/app/info").catch(() => ({ vaultPath: null }));
  if (!info.vaultPath) {
    location.href = "/welcome";
    return;
  }
  const hidden = await getHiddenTabs();
  // Окна (MODAL_ONLY_MODULES) своего пункта в сайдбаре не имеют — как
  // раздел при запуске они не годятся. Скрытый в Настройках раздел —
  // тоже нет.
  vaultId = info.currentVaultId || info.vaultPath || "";
  setSyncVault(vaultId, Array.isArray(info.vaults) ? info.vaults.length : 1);
  const last = lastModule();
  const usable = (key) => MODULES[key] && key !== "section" && !MODAL_ONLY_MODULES.includes(key) && !hidden.includes(key);
  const defaultModule = usable(last)
    ? last
    : usable("manuscript")
      ? "manuscript"
      : Object.keys(MODULES).find(usable) || "manuscript";
  openModule(defaultModule);
  initSidebarOverview({ openModule, openEntityModal, getCurrent: () => currentModuleName });
  initProjectSwitcher();
  if (!localStorage.getItem("fictaris_onboarding_seen")) {
    maybeShowOnboarding({ onFillDemo: fillWithDemoData, projectEmpty: await isProjectEmpty() });
  }
  // На телефоне обновления проверяет сам mobile.bundle.js (полностью на
  // клиенте, без /api/app/update-status) — там своя полоска.
  if (!info.mobile) initUpdateBanner();
  maybeRunHistoryCleanup();
}

boot();
