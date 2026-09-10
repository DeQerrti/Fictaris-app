import { apiGet } from "./api.js";
import { escapeHtml } from "./chips.js";
import { factionTypeInfo, locationTypeInfo } from "./icons.js";
import { loadStatuses } from "./chapter-status.js";
import { loadWritingLog, saveDailyGoal, computeStats } from "./writing-goal.js";
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

export function wordCount(text) {
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

// ── Писательская серия ───────────────────────────
// Дневная цель по словам, сколько написано сегодня и серия дней подряд
// с выполненной целью (writing-goal.js) — то, что дают Scrivener/
// NovelPad/4TheWords и подобные трекеры привычки писать, а Fictaris
// раньше показывал только "сколько всего слов" без истории по дням.
function buildWritingStreakSection(log) {
  const stats = computeStats(log);
  const section = buildSection(
    i18n("Писательская серия"),
    i18n("Дневная цель по словам – считается по автосохранениям рукописи, не нужно отмечать вручную.")
  );

  const tiles = document.createElement("div");
  tiles.className = "stat-tiles";
  tiles.append(
    buildTile(stats.streak, i18n("дней подряд с целью")),
    buildTile(stats.goal ? `${stats.todayWords} / ${stats.goal}` : stats.todayWords, i18n("слов сегодня"))
  );
  section.appendChild(tiles);

  const goalRow = document.createElement("div");
  goalRow.className = "field";
  goalRow.style.maxWidth = "240px";
  const goalLabel = document.createElement("label");
  goalLabel.textContent = i18n("Дневная цель, слов (0 – выключить)");
  goalRow.appendChild(goalLabel);
  const goalInput = document.createElement("input");
  goalInput.type = "number";
  goalInput.min = "0";
  goalInput.step = "50";
  goalInput.value = stats.goal || 0;
  let goalTimer;
  goalInput.addEventListener("input", () => {
    clearTimeout(goalTimer);
    goalTimer = setTimeout(() => saveDailyGoal(goalInput.value), 500);
  });
  goalRow.appendChild(goalInput);
  section.appendChild(goalRow);

  const bars = document.createElement("div");
  bars.className = "streak-bars";
  for (const day of stats.last14) {
    const bar = document.createElement("div");
    bar.className = "streak-bar" + (day.hit ? " hit" : "");
    bar.title = `${day.date}: ${day.words} ${i18n("слов")}`;
    const pct = stats.goal > 0 ? Math.round((day.words / stats.goal) * 100) : day.words > 0 ? 100 : 0;
    const fill = document.createElement("div");
    fill.className = "streak-bar-fill";
    fill.style.height = `${Math.max(day.words > 0 ? 6 : 0, Math.min(100, pct))}%`;
    bar.appendChild(fill);
    bars.appendChild(bar);
  }
  section.appendChild(bars);

  return section;
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

  const [characters, locations, factions, timeline, board, manuscript, relationships, statuses, writingLog] = await Promise.all([
    apiGet("/api/characters"),
    apiGet("/api/locations"),
    apiGet("/api/factions"),
    apiGet("/api/timeline"),
    apiGet("/api/board"),
    apiGet("/api/manuscript"),
    apiGet("/api/relationships"),
    loadStatuses(),
    loadWritingLog(),
  ]);

  const totalWords = manuscript.chapters.reduce((sum, c) => sum + wordCount(c.content), 0);
  const cardCount = Object.keys(board.cards || {}).length;

  wrap.appendChild(buildWritingStreakSection(writingLog));

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
    buildTile(totalWords.toLocaleString(currentLang() === "en" ? "en-US" : "ru-RU"), i18n("слов написано")),
    buildTile(
      manuscript.chapters.length ? Math.round(totalWords / manuscript.chapters.length).toLocaleString(currentLang() === "en" ? "en-US" : "ru-RU") : 0,
      i18n("слов в среднем на главу")
    )
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

  const castSection = buildSection(i18n("Чаще всего в таймлайне"), i18n("Сколько раз персонаж указан участником события – топ-8."));
  castSection.appendChild(buildBarList(castRows, castMax));
  wrap.appendChild(castSection);

  // ── Прогресс рукописи ────────────────────────────
  const statusRows = statuses.map((s) => ({
    label: i18n(s.label),
    value: manuscript.chapters.filter((c) => c.status === s.key).length,
    color: s.color,
  }));
  const statusMax = Math.max(1, ...statusRows.map((r) => r.value));

  const progressSection = buildSection(i18n("Прогресс рукописи"), i18n("Главы по статусу."));
  progressSection.appendChild(buildBarList(statusRows, statusMax));
  wrap.appendChild(progressSection);

  // ── Локации по типу ──────────────────────────────
  const byType = new Map();
  for (const loc of locations) byType.set(loc.type, (byType.get(loc.type) || 0) + 1);
  const locationRows = [...byType.entries()].map(([type, value]) => {
    const [, label, , color] = locationTypeInfo(type);
    return { label: i18n(label), value, color };
  });
  const locationMax = Math.max(1, ...locationRows.map((r) => r.value));

  const locationSection = buildSection(i18n("Локации по типу"));
  locationSection.appendChild(buildBarList(locationRows, locationMax));
  wrap.appendChild(locationSection);

  // ── Больше всего связей ──────────────────────────
  const degree = new Map();
  for (const rel of relationships) {
    if (rel.charA) degree.set(rel.charA, (degree.get(rel.charA) || 0) + 1);
    if (rel.charB) degree.set(rel.charB, (degree.get(rel.charB) || 0) + 1);
  }
  const degreeRows = [...degree.entries()]
    .map(([id, count]) => {
      const c = characters.find((x) => x.id === id);
      return c ? { label: c.name, value: count, color: c.color } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  const degreeMax = Math.max(1, ...degreeRows.map((r) => r.value));

  const degreeSection = buildSection(i18n("Больше всего связей"), i18n("Сколько связей у персонажа в модуле «Связи» – топ-8."));
  degreeSection.appendChild(buildBarList(degreeRows, degreeMax));
  wrap.appendChild(degreeSection);

  root.appendChild(wrap);
}
