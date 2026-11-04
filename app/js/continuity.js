import { apiGet } from "./api.js";
import { flattenBoards, cardCharacterIds } from "./board-data.js";
import { buildEmptyState } from "./chips.js";
import { knowledgeIssues } from "./knowledge.js";
import { findMentionedIds } from "./mentions.js";
import { i18n, i18nPlural } from "./i18n.js";

// Список проверок из брифа: битые ссылки, «забытые» сущности, дубли на
// таймлайне, главы со статусом «Готово» с пустым текстом. Каждая
// проверка — чистая функция над уже загруженными данными, без похода в
// сеть на каждую сущность.
//
// Замечание — { text, target }: target говорит, куда перейти по щелчку
// ({ type, id } — карточка персонажа/места/фракции, { chapter } — глава,
// { module, id? } — раздел), или его нет. Проверка открывается окном
// из нижней строки сайдбара (sidebar-overview.js), число замечаний —
// на её значке.

function byId(list) {
  return new Map(list.map((x) => [x.id, x]));
}

const issue = (text, target = null) => ({ text, target });

export function brokenRefs({ characters, locations, factions, relationships, timeline, board, map }) {
  const chars = byId(characters);
  const locs = byId(locations);
  const issues = [];

  for (const r of relationships) {
    if (r.charA && !chars.has(r.charA)) issues.push(issue(i18n("Связь «{label}» ссылается на несуществующего персонажа", { label: r.label || "?" }), { module: "graph" }));
    if (r.charB && !chars.has(r.charB)) issues.push(issue(i18n("Связь «{label}» ссылается на несуществующего персонажа", { label: r.label || "?" }), { module: "graph" }));
  }

  for (const f of factions) {
    const target = { type: "faction", id: f.id };
    if (f.leaderId && !chars.has(f.leaderId)) issues.push(issue(i18n("Фракция «{name}» – глава не найден", { name: f.name }), target));
    if (f.headquartersId && !locs.has(f.headquartersId)) issues.push(issue(i18n("Фракция «{name}» – штаб-квартира не найдена", { name: f.name }), target));
    for (const m of f.memberIds || []) {
      if (!chars.has(m)) issues.push(issue(i18n("Фракция «{name}» – в составе несуществующий персонаж", { name: f.name }), target));
    }
  }

  for (const ev of timeline) {
    const target = { module: "timeline", id: ev.id };
    for (const c of ev.characterIds || []) {
      if (!chars.has(c)) issues.push(issue(i18n("Событие «{title}» ссылается на несуществующего персонажа", { title: ev.title }), target));
    }
    for (const l of ev.locationIds || []) {
      if (!locs.has(l)) issues.push(issue(i18n("Событие «{title}» ссылается на несуществующую локацию", { title: ev.title }), target));
    }
  }

  for (const card of Object.values(board.cards || {})) {
    if (cardCharacterIds(card).some((id) => !chars.has(id))) {
      issues.push(issue(i18n("Карточка доски «{title}» ссылается на несуществующего персонажа", { title: card.title }), { module: "board" }));
    }
  }

  for (const m of Object.values(map.maps || {})) {
    for (const pin of m.pins || []) {
      const target = { module: "map" };
      if (pin.characterId && !chars.has(pin.characterId)) issues.push(issue(i18n("Метка «{label}» на карте «{name}» ссылается на несуществующего персонажа", { label: pin.label, name: m.name }), target));
      if (pin.locationId && !locs.has(pin.locationId)) issues.push(issue(i18n("Метка «{label}» на карте «{name}» ссылается на несуществующую локацию", { label: pin.label, name: m.name }), target));
      if (pin.linkedMapId && !map.maps[pin.linkedMapId]) issues.push(issue(i18n("Метка «{label}» на карте «{name}» ссылается на несуществующую под-карту", { label: pin.label, name: m.name }), target));
    }
  }

  return issues;
}

// «Забытый» — тот, на кого ничто не ссылается. Родство (родители, пары) —
// тоже ссылка: раньше вся семья, заведённая только в Родословной,
// числилась «нигде не упомянутой». Вложенность мест, главы (участники,
// места) и карточки холста — тоже.
export function orphans({ characters, locations, relationships, factions, timeline, board, map, manuscript, canvas }) {
  const referenced = new Set();
  for (const r of relationships) { referenced.add(r.charA); referenced.add(r.charB); }
  for (const c of characters) {
    for (const id of [...(c.parentIds || []), ...(c.partnerIds || [])]) {
      referenced.add(id);
      referenced.add(c.id);
    }
  }
  for (const l of locations) {
    if (l.parentId) { referenced.add(l.parentId); referenced.add(l.id); }
  }
  for (const f of factions) {
    if (f.leaderId) referenced.add(f.leaderId);
    if (f.headquartersId) referenced.add(f.headquartersId);
    for (const m of f.memberIds || []) referenced.add(m);
  }
  for (const ev of timeline) {
    for (const c of ev.characterIds || []) referenced.add(c);
    for (const l of ev.locationIds || []) referenced.add(l);
  }
  for (const ch of manuscript?.chapters || []) {
    for (const id of [...(ch.characterIds || []), ...(ch.locationIds || [])]) referenced.add(id);
    for (const id of findMentionedIds(ch.content || "", characters)) referenced.add(id);
  }
  for (const card of Object.values(board.cards || {})) {
    for (const id of cardCharacterIds(card)) referenced.add(id);
    if (card.locationId) referenced.add(card.locationId);
  }
  for (const m of Object.values(map.maps || {})) {
    for (const pin of m.pins || []) {
      if (pin.characterId) referenced.add(pin.characterId);
      if (pin.locationId) referenced.add(pin.locationId);
    }
  }
  for (const cv of Object.values(canvas?.canvases || {})) {
    for (const card of cv.cards || []) if (card.entity?.id) referenced.add(card.entity.id);
  }

  const issues = [];
  for (const c of characters) {
    if (!referenced.has(c.id)) issues.push(issue(i18n("Персонаж «{name}» нигде не упомянут – ни в связях, ни в таймлайне, ни во фракциях", { name: c.name }), { type: "character", id: c.id }));
  }
  for (const l of locations) {
    if (!referenced.has(l.id)) issues.push(issue(i18n("Локация «{name}» нигде не упомянута", { name: l.name }), { type: "location", id: l.id }));
  }
  return issues;
}

export function duplicateTimelineEntries({ timeline }) {
  const seen = new Map();
  const issues = [];
  for (const ev of timeline) {
    const key = `${(ev.title || "").trim().toLowerCase()}|${(ev.date || "").trim().toLowerCase()}`;
    if (!key.trim().replace("|", "")) continue;
    if (seen.has(key)) issues.push(issue(i18n("Возможный дубль на таймлайне: «{title}» ({date})", { title: ev.title, date: ev.date || i18n("без даты") }), { module: "timeline", id: ev.id }));
    seen.set(key, ev);
  }
  return issues;
}

export function emptyDoneChapters({ manuscript }) {
  return manuscript.chapters
    .filter((c) => c.status === "done" && !(c.content || "").trim())
    .map((c) => issue(i18n("Глава «{title}» помечена «Готово», но текст пуст", { title: c.title }), { chapter: c.id }));
}

export async function loadCheckData() {
  const [characters, locations, relationships, factions, timeline, board, map, manuscript, knowledge, canvas] = await Promise.all([
    apiGet("/api/characters"),
    apiGet("/api/locations"),
    apiGet("/api/relationships"),
    apiGet("/api/factions"),
    apiGet("/api/timeline"),
    apiGet("/api/board"),
    apiGet("/api/map"),
    apiGet("/api/manuscript"),
    apiGet("/api/knowledge"),
    apiGet("/api/canvas"),
  ]);
  return { characters, locations, relationships, factions, timeline, board: flattenBoards(board), map, manuscript, knowledge, canvas };
}

export function collectIssues(data) {
  return [
    [i18n("Битые ссылки"), brokenRefs(data)],
    [i18n("Забытые сущности"), orphans(data)],
    [i18n("Возможные дубли на таймлайне"), duplicateTimelineEntries(data)],
    [i18n("Главы «Готово» с пустым текстом"), emptyDoneChapters(data)],
    [i18n("Знания без выбранной главы или со ссылкой на удалённое"), knowledgeIssues(data).map((text) => issue(text, { modal: "knowledge" }))],
  ].filter(([, list]) => list.length);
}

// onOpen(target) — куда вести по щелчку, решает вызывающая сторона
// (sidebar-overview.js), здесь только список.
export async function renderContinuity(root, onOpen) {
  root.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "continuity-panel";
  wrap.innerHTML = `<div class="sb-pop-empty">${i18n("Проверяю…")}</div>`;
  root.appendChild(wrap);

  const sections = collectIssues(await loadCheckData());
  wrap.innerHTML = "";
  const total = sections.reduce((sum, [, list]) => sum + list.length, 0);

  const head = document.createElement("div");
  head.className = "sb-pop-head";
  head.innerHTML = `<span class="sb-pop-title"></span><span class="sb-pop-meta"></span>`;
  head.querySelector(".sb-pop-title").textContent = i18n("Проверка мира");
  head.querySelector(".sb-pop-meta").textContent = total ? i18nPlural(total, ["{n} замечание", "{n} замечания", "{n} замечаний"]) : "";
  wrap.appendChild(head);

  if (!total) {
    wrap.appendChild(buildEmptyState(i18n("Всё чисто – проверка не нашла проблем."), "checkShield"));
    return;
  }

  for (const [title, list] of sections) {
    const sec = document.createElement("div");
    sec.className = "continuity-section";
    const h = document.createElement("div");
    h.className = "continuity-section-title";
    h.textContent = `${title} · ${list.length}`;
    sec.appendChild(h);
    for (const { text, target } of list) {
      const row = document.createElement(target && onOpen ? "button" : "div");
      row.className = "continuity-row";
      row.textContent = text;
      if (target && onOpen) row.addEventListener("click", () => onOpen(target));
      sec.appendChild(row);
    }
    wrap.appendChild(sec);
  }
}
