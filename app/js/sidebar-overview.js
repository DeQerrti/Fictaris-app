import { apiGet } from "./api.js";
import { flattenBoards } from "./board-data.js";
import { iconSvg } from "./icons.js";
import { i18n, i18nPlural } from "./i18n.js";
import { readRecent } from "./recent-nav.js";
import { computeStats } from "./writing-goal.js";
import { wordCount } from "./stats.js";
import { loadStatuses, statusByKey, buildStatusDot } from "./chapter-status.js";
import { collectIssues, renderContinuity } from "./continuity.js";
import { renderTrash } from "./trash.js";
import { openPopover, closeMenu } from "./context-menu.js";
import { openSearch } from "./search.js";
import { personAvatarHtml } from "./entity-view.js";

// ══════════════════════════════════════════════
//  САЙДБАР — «Стол писателя»
//
//  Наверху — мир (иконка приложения, название, книга) и поиск, ниже
//  карточка «Сейчас пишу» (глава, слова, цель дня, «Продолжить»),
//  разделы сюжета, «Мир» плитками со счётчиками, «Наглядно» и
//  «Недавнее». Внизу строка значков: Проверка и Корзина открываются
//  окном поверх экрана, а не вкладкой — у обеих короткий список, на
//  всю ширину он только пустовал; число замечаний и записей — прямо на
//  значке, чтобы о них не забывали.
//
//  Сами пункты — по-прежнему .nav-item[data-module] (main.js, горячие
//  клавиши, скрытие и порядок в Настройках работают с ними); здесь
//  только числа, карточки и окна. Данные перечитываются после любого
//  сохранения (событие fictaris:data-changed из api.js) с задержкой —
//  не на каждое нажатие клавиши.
// ══════════════════════════════════════════════

const SECTION_TITLES = { plot: "Сюжет", world: "Мир", views: "Наглядно" };
const ENTITY_MODULES = { character: "characters", location: "locations", faction: "factions" };
const RECENT_MAX = 4;

let openModule = null;
let openEntityModal = null;
let getCurrent = () => null;
let refreshTimer = null;
let lastData = null;

export function initSidebarOverview(deps) {
  ({ openModule, openEntityModal, getCurrent } = deps);

  for (const el of document.querySelectorAll(".nav-group-label[data-section]")) {
    el.textContent = i18n(SECTION_TITLES[el.dataset.section]);
  }
  const searchText = document.getElementById("sbSearchText");
  if (searchText) searchText.textContent = i18n("Найти или перейти…");
  document.getElementById("sbSearch")?.addEventListener("click", () => openSearch());

  document.getElementById("continuityBtn")?.addEventListener("click", (e) => openPanel("continuity", e.currentTarget));
  document.getElementById("trashBtn")?.addEventListener("click", (e) => openPanel("trash", e.currentTarget));

  document.addEventListener("fictaris:data-changed", () => scheduleRefresh());
  document.addEventListener("fictaris:trash-changed", () => scheduleRefresh(100));
  document.addEventListener("fictaris:recent-changed", refreshRecent);
  refreshSidebar();
}

export function scheduleRefresh(delay = 800) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshSidebar, delay);
}

// ── Окна Проверки и Корзины ────────────────────
export function openPanel(kind, anchor) {
  const box = document.createElement("div");
  box.className = "sb-pop-body";
  const rect = (anchor || document.querySelector(".sidebar")).getBoundingClientRect();
  const sidebarRight = document.querySelector(".sidebar")?.getBoundingClientRect().right || rect.right;
  openPopover(sidebarRight + 8, rect.bottom, box, "sb-pop");
  const reposition = () => {
    const menu = box.closest(".sb-pop");
    if (!menu) return;
    const h = menu.getBoundingClientRect().height;
    menu.style.top = `${Math.max(8, Math.min(rect.bottom, window.innerHeight - 8) - h)}px`;
  };
  const done = kind === "continuity" ? renderContinuity(box, goToTarget) : renderTrash(box);
  done.then(reposition);
  reposition();
}

function goToTarget(target) {
  closeMenu();
  if (target.type) {
    document.dispatchEvent(new CustomEvent("fictaris:open-entity", { detail: { type: target.type, id: target.id } }));
  } else if (target.chapter) {
    openModule("manuscript", target.chapter);
  } else if (target.modal) {
    openEntityModal(target.modal);
  } else if (target.module) {
    openModule(target.module, target.id);
  }
}

// ── Данные ─────────────────────────────────────
async function loadData() {
  const names = ["characters", "locations", "factions", "relationships", "timeline", "board", "map", "manuscript", "canvas", "knowledge", "writing-log", "trash"];
  const values = await Promise.all(names.map((n) => apiGet(`/api/${n}`).catch(() => null)));
  const d = Object.fromEntries(names.map((n, i) => [n, values[i]]));
  return {
    characters: d.characters || [],
    locations: d.locations || [],
    factions: d.factions || [],
    relationships: d.relationships || [],
    timeline: d.timeline || [],
    board: flattenBoards(d.board || {}),
    map: d.map || { maps: {} },
    manuscript: d.manuscript || { chapters: [] },
    canvas: d.canvas || { canvases: {} },
    knowledge: d.knowledge || { facts: [] },
    log: d["writing-log"] || { days: {} },
    trash: Array.isArray(d.trash) ? d.trash : [],
    statuses: await loadStatuses(),
  };
}

// Книги: пока Рукопись ни разу не открывали, books нет — тогда одна
// книга на все главы, как и считает сама Рукопись при первом открытии.
function booksOf(manuscript) {
  const chapters = manuscript.chapters || [];
  const books = Array.isArray(manuscript.books) && manuscript.books.length
    ? manuscript.books
    : [{ id: null, title: i18n("Книга 1") }];
  const activeId = books.some((b) => b.id === manuscript.activeBookId) ? manuscript.activeBookId : books[0].id;
  const inBook = (b) => (b.id === null ? chapters : chapters.filter((c) => (c.bookId || books[0].id) === b.id));
  return { books, active: books.find((b) => b.id === activeId), inBook };
}

export async function refreshSidebar() {
  const data = await loadData().catch(() => null);
  if (!data) return;
  lastData = data;
  renderCounts(data);
  renderWorld(data);
  renderNow(data);
  renderBooks(data);
  renderRecent(data);
  const issues = collectIssues(data).reduce((s, [, list]) => s + list.length, 0);
  setBadge("continuityBadge", issues, i18nPlural(issues, ["{n} замечание", "{n} замечания", "{n} замечаний"]), "continuityBtn", i18n("Проверка мира"));
  setBadge("trashBadge", data.trash.length, i18nPlural(data.trash.length, ["{n} запись", "{n} записи", "{n} записей"]), "trashBtn", i18n("Корзина"));
}

// Пересчитать только «Недавнее» — после каждого перехода, без похода за
// всеми файлами.
export function refreshRecent() {
  if (lastData) renderRecent(lastData);
}

function setBadge(id, n, text, btnId, title) {
  const el = document.getElementById(id);
  if (el) el.textContent = n ? String(n > 99 ? "99+" : n) : "";
  const btn = document.getElementById(btnId);
  if (btn) btn.title = n ? `${title} – ${text}` : title;
}

function renderCounts(data) {
  const { active, inBook } = booksOf(data.manuscript);
  const counts = {
    manuscript: inBook(active).length,
    board: Object.keys(data.board.cards || {}).length,
    characters: data.characters.length,
    locations: data.locations.length,
    factions: data.factions.length,
    timeline: data.timeline.length,
    map: Object.keys(data.map.maps || {}).length,
    graph: data.relationships.length,
    canvas: (data.canvas.order || Object.keys(data.canvas.canvases || {})).length,
  };
  for (const btn of document.querySelectorAll(".sidebar .nav-item[data-module]")) {
    const n = counts[btn.dataset.module];
    let el = btn.querySelector(".nav-count");
    if (n === undefined) {
      el?.remove();
      continue;
    }
    if (!el) {
      el = document.createElement("span");
      el.className = "nav-count";
      btn.appendChild(el);
    }
    el.textContent = n ? String(n) : btn.classList.contains("nav-tile") ? "0" : "";
    // В узкой полосе подписей нет — подсказка при наведении.
    const label = btn.querySelector(".nav-label")?.textContent.trim() || "";
    btn.title = n ? `${label} · ${n}` : label;
  }
}

function renderWorld(data) {
  const sub = document.getElementById("sbWorldSub");
  if (!sub) return;
  const { books, active, inBook } = booksOf(data.manuscript);
  const chapters = inBook(active).length;
  const chaptersText = i18nPlural(chapters, ["{n} глава", "{n} главы", "{n} глав"]);
  sub.textContent = books.length > 1 ? `${active.title || i18n("Без названия")} · ${chaptersText}` : chaptersText;
}

function renderNow(data) {
  const el = document.getElementById("sbNow");
  if (!el) return;
  const { active, inBook } = booksOf(data.manuscript);
  const chapters = inBook(active);
  const current = chapters.find((c) => c.id === data.manuscript.activeChapterId) || chapters[chapters.length - 1];
  if (!current) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const status = statusByKey(data.statuses, current.status);
  const stats = computeStats(data.log);
  const words = wordCount(current.content);
  const goal = stats.goal;
  const pct = goal ? Math.min(100, Math.round((stats.todayWords / goal) * 100)) : 0;

  el.innerHTML = `
    <div class="sb-now-k"></div>
    <div class="sb-now-title"></div>
    <div class="sb-now-meta"><span class="sb-now-status"></span><span class="sb-now-words"></span></div>
    <div class="sb-now-goal"><span class="sb-now-goal-text"></span><span class="sb-now-bar"><i style="width:${pct}%"></i></span></div>
    <button class="btn sb-now-btn"></button>`;
  el.querySelector(".sb-now-k").textContent = i18n("Сейчас пишу");
  el.querySelector(".sb-now-title").textContent = current.title || i18n("Без названия");
  const statusEl = el.querySelector(".sb-now-status");
  statusEl.append(buildStatusDot(status), document.createTextNode(i18n(status?.label || "")));
  el.querySelector(".sb-now-words").textContent = i18nPlural(words, ["{n} слово", "{n} слова", "{n} слов"]);
  el.querySelector(".sb-now-goal-text").textContent = goal
    ? i18n("Сегодня {n} из {goal}", { n: stats.todayWords, goal })
    : i18nPlural(stats.todayWords, ["Сегодня {n} слово", "Сегодня {n} слова", "Сегодня {n} слов"]);
  el.classList.toggle("goal-hit", stats.todayHit);
  const btn = el.querySelector(".sb-now-btn");
  btn.textContent = i18n("Продолжить");
  btn.addEventListener("click", () => openModule("manuscript", current.id));
}

// Под «Рукописью» — книги, только если их больше одной: с одной книгой
// строка повторяла бы сам пункт.
function renderBooks(data) {
  const el = document.getElementById("sbBooks");
  if (!el) return;
  el.innerHTML = "";
  const { books, active, inBook } = booksOf(data.manuscript);
  if (books.length < 2) return;
  for (const b of books) {
    const chapters = inBook(b);
    const row = document.createElement("button");
    row.className = "sb-book" + (b === active ? " active" : "");
    row.innerHTML = `<span class="sb-book-title"></span><span class="nav-count"></span>`;
    row.querySelector(".sb-book-title").textContent = b.title || i18n("Без названия");
    row.querySelector(".nav-count").textContent = String(chapters.length);
    row.addEventListener("click", () => {
      const target = chapters.find((c) => c.id === b.lastChapterId) || chapters[0];
      if (target) openModule("manuscript", target.id);
    });
    el.appendChild(row);
  }
}

// ── Недавнее ───────────────────────────────────
function resolveRecent(entry, data) {
  const navLabel = (module) => window.SITE_LABELS?.nav?.[module] || module;
  const lists = { characters: data.characters, locations: data.locations, factions: data.factions };
  if (entry.id && lists[entry.module]) {
    const e = lists[entry.module].find((x) => x.id === entry.id);
    if (!e) return null;
    const kind = { characters: i18n("персонаж"), locations: i18n("место"), factions: i18n("фракция") }[entry.module];
    const lead = entry.module === "characters"
      ? personAvatarHtml(e, "cast-avatar sb-recent-avatar")
      : `<span class="sb-recent-icon">${iconSvg(entry.module === "locations" ? "pin" : "shield", 14)}</span>`;
    return { lead, title: e.name || i18n("Без имени"), kind };
  }
  if (entry.id && entry.module === "manuscript") {
    const ch = (data.manuscript.chapters || []).find((c) => c.id === entry.id);
    if (!ch) return null;
    return { lead: `<span class="sb-recent-icon">${iconSvg("book", 14)}</span>`, title: ch.title || i18n("Без названия"), kind: i18n("рукопись") };
  }
  if (entry.id) return null;
  const icons = { board: "columns", timeline: "clock", map: "map", graph: "network", familytree: "tree", canvas: "frame", manuscript: "book", characters: "user", locations: "pin", factions: "shield" };
  if (!icons[entry.module]) return null;
  return { lead: `<span class="sb-recent-icon">${iconSvg(icons[entry.module], 14)}</span>`, title: navLabel(entry.module), kind: i18n("раздел") };
}

function renderRecent(data) {
  const el = document.getElementById("sbRecent");
  if (!el) return;
  const current = getCurrent();
  const rows = [];
  for (const entry of readRecent()) {
    // То, что открыто сейчас, в «Недавнем» не нужно — оно и так на экране.
    if (current && entry.module === current && !entry.id) continue;
    const r = resolveRecent(entry, data);
    if (r) rows.push({ entry, ...r });
    if (rows.length >= RECENT_MAX) break;
  }
  el.innerHTML = "";
  el.hidden = !rows.length;
  if (!rows.length) return;
  const title = document.createElement("div");
  title.className = "nav-group-label";
  title.textContent = i18n("Недавнее");
  el.appendChild(title);
  for (const { entry, lead, title: text, kind } of rows) {
    const row = document.createElement("button");
    row.className = "sb-recent-row";
    row.innerHTML = `${lead}<span class="sb-recent-title"></span><span class="sb-recent-kind"></span>`;
    row.querySelector(".sb-recent-title").textContent = text;
    row.querySelector(".sb-recent-kind").textContent = kind;
    row.addEventListener("click", () => {
      const type = Object.keys(ENTITY_MODULES).find((k) => ENTITY_MODULES[k] === entry.module);
      if (entry.id && type) document.dispatchEvent(new CustomEvent("fictaris:open-entity", { detail: { type, id: entry.id } }));
      else openModule(entry.module, entry.id || undefined);
    });
    el.appendChild(row);
  }
}
