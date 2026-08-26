import { apiGet } from "./api.js";
import { escapeHtml } from "./chips.js";
import { locationTypeInfo, factionTypeInfo } from "./icons.js";

// ══════════════════════════════════════════════
//  ГЛОБАЛЬНЫЙ ПОИСК
//
//  Ни у Fictaris, ни у TasteID раньше не было поиска, который смотрит
//  сразу во все модули — у TasteID это фильтр внутри одной вкладки
//  (отзывы), а здесь модулей восемь и искать в них по одному не годится.
//
//  Индекс строится один раз на открытие (кэш на 5 секунд — не бегать в
//  сеть при каждом нажатии "/"), сам поиск — простая подстрока по
//  названию и подписи, без библиотек: справочник вряд ли настолько
//  велик, чтобы это стало узким местом.
// ══════════════════════════════════════════════

const MODULE_LABELS = {
  characters: "Персонаж",
  locations: "Локация",
  factions: "Фракция",
  timeline: "Событие",
  manuscript: "Глава",
  board: "Карточка",
};

let overlay = null;
let input = null;
let list = null;
let onNavigate = null; // (module, focusId) => void
let index = [];
let indexLoadedAt = 0;

function snippet(text, max = 90) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

async function buildIndex() {
  const [characters, locations, factions, timeline, manuscript, board] = await Promise.all([
    apiGet("/api/characters"),
    apiGet("/api/locations"),
    apiGet("/api/factions"),
    apiGet("/api/timeline"),
    apiGet("/api/manuscript"),
    apiGet("/api/board"),
  ]);

  const entries = [];
  for (const c of characters) {
    entries.push({ module: "characters", id: c.id, title: c.name, subtitle: snippet(c.role), color: c.color || "#7c7157" });
  }
  for (const l of locations) {
    const [, , , color] = locationTypeInfo(l.type);
    entries.push({ module: "locations", id: l.id, title: l.name, subtitle: snippet(l.description), color });
  }
  for (const f of factions) {
    const [, , , color] = factionTypeInfo(f.type);
    entries.push({ module: "factions", id: f.id, title: f.name, subtitle: snippet(f.description), color });
  }
  for (const e of timeline) {
    entries.push({ module: "timeline", id: e.id, title: e.title, subtitle: snippet(e.description || e.date), color: "#6a8fae" });
  }
  for (const c of manuscript.chapters || []) {
    entries.push({
      module: "manuscript",
      id: c.id,
      title: c.title || "Без названия",
      subtitle: snippet(c.content),
      color: "#c9944a",
    });
  }
  // У карточек доски нет отдельного экрана-редактора с фокусом по id
  // (board.js правит их прямо внутри колонок) — переход просто
  // открывает доску, без подсветки конкретной карточки.
  for (const col of board.columns || []) {
    for (const cardId of board.cardOrder?.[col.id] || []) {
      const card = board.cards?.[cardId];
      if (card) entries.push({ module: "board", id: null, title: card.title, subtitle: col.title, color: "#9a9250" });
    }
  }
  return entries;
}

async function refreshIndex() {
  index = await buildIndex().catch(() => []);
  indexLoadedAt = Date.now();
}

function ensureOverlay() {
  if (overlay) return;
  overlay = document.createElement("div");
  overlay.className = "search-overlay hidden";
  overlay.innerHTML =
    '<div class="search-modal"><input type="text" class="search-input" placeholder="Персонажи, локации, фракции, таймлайн, рукопись…" /><div class="search-results"></div></div>';
  document.body.appendChild(overlay);
  input = overlay.querySelector(".search-input");
  list = overlay.querySelector(".search-results");

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  input.addEventListener("input", () => renderResults(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
    if (e.key === "Enter") list.querySelector(".search-result")?.click();
  });
}

function renderResults(query) {
  const q = query.trim().toLowerCase();
  list.innerHTML = "";
  if (!q) return;
  const matches = index
    .filter((e) => (e.title || "").toLowerCase().includes(q) || (e.subtitle || "").toLowerCase().includes(q))
    .slice(0, 30);
  if (!matches.length) {
    list.innerHTML = '<div class="search-empty">Ничего не найдено</div>';
    return;
  }
  for (const m of matches) {
    const row = document.createElement("button");
    row.className = "search-result";
    row.style.setProperty("--result-color", m.color);
    row.innerHTML =
      `<span class="search-result-type">${MODULE_LABELS[m.module] || m.module}</span>` +
      `<span class="search-result-title">${escapeHtml(m.title || "Без названия")}</span>` +
      (m.subtitle ? `<span class="search-result-sub">${escapeHtml(m.subtitle)}</span>` : "");
    row.addEventListener("click", () => {
      close();
      onNavigate?.(m.module, m.id);
    });
    list.appendChild(row);
  }
}

function close() {
  overlay?.classList.add("hidden");
}

export async function openSearch() {
  ensureOverlay();
  overlay.classList.remove("hidden");
  input.value = "";
  list.innerHTML = "";
  input.focus();
  if (Date.now() - indexLoadedAt > 5000) await refreshIndex();
}

// navigate(module, focusId) — вызывающая сторона (main.js) решает, как
// переключить модуль; здесь мы не знаем и не должны знать про openModule.
export function initSearch(navigate) {
  onNavigate = navigate;
  document.addEventListener("keydown", (e) => {
    // "/" открывает поиск — но не когда фокус уже в поле ввода/тексте
    // главы, иначе там нельзя было бы напечатать сам слэш.
    const tag = document.activeElement?.tagName;
    const typing = tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable;
    if (e.key === "/" && !typing) {
      e.preventDefault();
      openSearch();
    }
  });
}
