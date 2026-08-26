import { apiGet } from "./api.js";
import { escapeHtml } from "./chips.js";
import { factionTypeInfo } from "./icons.js";
import { i18n, currentLang } from "./i18n.js";

// ══════════════════════════════════════════════
//  СТАТИСТИКА ПО МИРУ
//
//  По духу TasteID (app/js/stats.js — панель, посчитанная по уже
//  загруженным данным), но содержание своё: там разбивка по типам и
//  оценкам, здесь — то, что интересно писателю: сколько персонажей в
//  каждой фракции, сколько слов написано по главам, кто чаще всего
//  фигурирует в таймлайне. Ничего не хранится отдельно — цифры каждый
//  раз считаются заново по characters/locations/factions/timeline/
//  manuscript, как и советовал ресерч по рынку (мимо не пройдёшь ни
//  один инструмент воркбилдинга без обзорной панели).
// ══════════════════════════════════════════════

function wordCount(text) {
  const m = (text || "").trim().match(/\S+/g);
  return m ? m.length : 0;
}

function buildTile(value, label) {
  const tile = document.createElement("div");
  tile.className = "stat-tile";
  tile.innerHTML = `<div class="stat-tile-value">${value}</div><div class="stat-tile-label">${escapeHtml(label)}</div>`;
  return tile;
}

// rows — [{ label, value, color }], max — общий знаменатель для ширины
// полосок (обычно наибольшее значение среди rows).
function buildBarList(rows, max) {
  const list = document.createElement("div");
  list.className = "stat-bar-list";
  if (!rows.length) {
    list.innerHTML = `<div class="empty-state">${i18n("Пока нечего показать.")}</div>`;
    return list;
  }
  for (const { label, value, color } of rows) {
    const row = document.createElement("div");
    row.className = "stat-bar-row";
    const width = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
    row.innerHTML = `
      <span class="stat-bar-label">${escapeHtml(label)}</span>
      <span class="stat-bar-track"><span class="stat-bar-fill" style="width:${width}%;background:${color || "var(--accent)"}"></span></span>
      <span class="stat-bar-value">${value}</span>
    `;
    list.appendChild(row);
  }
  return list;
}

function buildSection(title, hint) {
  const section = document.createElement("div");
  section.className = "data-section";
  section.innerHTML = `<h3>${escapeHtml(title)}</h3>` + (hint ? `<p>${escapeHtml(hint)}</p>` : "");
  return section;
}

export async function renderStats(root) {
  root.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "data-panel";

  const [characters, locations, factions, timeline, board, manuscript] = await Promise.all([
    apiGet("/api/characters"),
    apiGet("/api/locations"),
    apiGet("/api/factions"),
    apiGet("/api/timeline"),
    apiGet("/api/board"),
    apiGet("/api/manuscript"),
  ]);

  const totalWords = manuscript.chapters.reduce((sum, c) => sum + wordCount(c.content), 0);
  const cardCount = Object.keys(board.cards || {}).length;

  const overview = buildSection(i18n("Обзор"));
  const tiles = document.createElement("div");
  tiles.className = "stat-tiles";
  tiles.append(
    buildTile(characters.length, i18n("персонажей")),
    buildTile(locations.length, i18n("локаций")),
    buildTile(factions.length, i18n("фракций")),
    buildTile(timeline.length, i18n("событий")),
    buildTile(cardCount, i18n("карточек на доске")),
    buildTile(manuscript.chapters.length, i18n("глав")),
    buildTile(totalWords.toLocaleString(currentLang() === "en" ? "en-US" : "ru-RU"), i18n("слов написано"))
  );
  overview.appendChild(tiles);
  wrap.appendChild(overview);

  // ── Персонажи по фракциям ──────────────────────
  const inFaction = new Set();
  const factionRows = factions.map((f) => {
    for (const id of f.memberIds || []) inFaction.add(id);
    const [, , , color] = factionTypeInfo(f.type);
    return { label: f.name, value: (f.memberIds || []).length, color };
  });
  const unaffiliated = characters.filter((c) => !inFaction.has(c.id)).length;
  if (unaffiliated) factionRows.push({ label: i18n("Без фракции"), value: unaffiliated, color: "#7c7157" });
  const factionMax = Math.max(1, ...factionRows.map((r) => r.value));

  const factionSection = buildSection(i18n("Персонажи по фракциям"));
  factionSection.appendChild(buildBarList(factionRows, factionMax));
  wrap.appendChild(factionSection);

  // ── Слова по главам ─────────────────────────────
  const chapterRows = manuscript.chapters.map((c) => ({
    label: c.title || i18n("Без названия"),
    value: wordCount(c.content),
  }));
  const chapterMax = Math.max(1, ...chapterRows.map((r) => r.value));

  const chapterSection = buildSection(i18n("Слова по главам"));
  chapterSection.appendChild(buildBarList(chapterRows, chapterMax));
  wrap.appendChild(chapterSection);

  // ── Кто чаще всего фигурирует в таймлайне ───────
  const appearances = new Map();
  for (const e of timeline) {
    for (const id of e.characterIds || []) appearances.set(id, (appearances.get(id) || 0) + 1);
  }
  const castRows = [...appearances.entries()]
    .map(([id, count]) => {
      const c = characters.find((x) => x.id === id);
      return c ? { label: c.name, value: count, color: c.color } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  const castMax = Math.max(1, ...castRows.map((r) => r.value));

  const castSection = buildSection(i18n("Чаще всего в таймлайне"), i18n("Сколько раз персонаж указан участником события — топ-8."));
  castSection.appendChild(buildBarList(castRows, castMax));
  wrap.appendChild(castSection);

  root.appendChild(wrap);
}
