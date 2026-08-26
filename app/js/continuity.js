import { apiGet } from "./api.js";
import { escapeHtml } from "./chips.js";
import { i18n } from "./i18n.js";

// Список проверок из брифа: битые ссылки, «забытые» сущности, дубли на
// таймлайне, главы со статусом «Готово» с пустым текстом. Каждая
// проверка — чистая функция над уже загруженными данными, без похода в
// сеть на каждую сущность.

function byId(list) {
  return new Map(list.map((x) => [x.id, x]));
}

export function brokenRefs({ characters, locations, factions, relationships, timeline, board, map }) {
  const chars = byId(characters);
  const locs = byId(locations);
  const facs = byId(factions);
  const issues = [];

  for (const r of relationships) {
    if (r.charA && !chars.has(r.charA)) issues.push(i18n("Связь «{label}» ссылается на несуществующего персонажа", { label: r.label || "?" }));
    if (r.charB && !chars.has(r.charB)) issues.push(i18n("Связь «{label}» ссылается на несуществующего персонажа", { label: r.label || "?" }));
  }

  for (const f of factions) {
    if (f.leaderId && !chars.has(f.leaderId)) issues.push(i18n("Фракция «{name}» — глава не найден", { name: f.name }));
    if (f.headquartersId && !locs.has(f.headquartersId)) issues.push(i18n("Фракция «{name}» — штаб-квартира не найдена", { name: f.name }));
    for (const m of f.memberIds || []) {
      if (!chars.has(m)) issues.push(i18n("Фракция «{name}» — в составе несуществующий персонаж", { name: f.name }));
    }
  }

  for (const ev of timeline) {
    for (const c of ev.characterIds || []) {
      if (!chars.has(c)) issues.push(i18n("Событие «{title}» ссылается на несуществующего персонажа", { title: ev.title }));
    }
    for (const l of ev.locationIds || []) {
      if (!locs.has(l)) issues.push(i18n("Событие «{title}» ссылается на несуществующую локацию", { title: ev.title }));
    }
  }

  for (const card of Object.values(board.cards || {})) {
    if (card.characterId && !chars.has(card.characterId)) {
      issues.push(i18n("Карточка доски «{title}» ссылается на несуществующего персонажа", { title: card.title }));
    }
  }

  for (const m of Object.values(map.maps || {})) {
    for (const pin of m.pins || []) {
      if (pin.characterId && !chars.has(pin.characterId)) issues.push(i18n("Метка «{label}» на карте «{name}» ссылается на несуществующего персонажа", { label: pin.label, name: m.name }));
      if (pin.locationId && !locs.has(pin.locationId)) issues.push(i18n("Метка «{label}» на карте «{name}» ссылается на несуществующую локацию", { label: pin.label, name: m.name }));
      if (pin.linkedMapId && !map.maps[pin.linkedMapId]) issues.push(i18n("Метка «{label}» на карте «{name}» ссылается на несуществующую под-карту", { label: pin.label, name: m.name }));
    }
  }

  return issues;
}

export function orphans({ characters, locations, relationships, factions, timeline, board, map }) {
  const referenced = new Set();
  for (const r of relationships) { referenced.add(r.charA); referenced.add(r.charB); }
  for (const f of factions) {
    if (f.leaderId) referenced.add(f.leaderId);
    if (f.headquartersId) referenced.add(f.headquartersId);
    for (const m of f.memberIds || []) referenced.add(m);
  }
  for (const ev of timeline) {
    for (const c of ev.characterIds || []) referenced.add(c);
    for (const l of ev.locationIds || []) referenced.add(l);
  }
  for (const card of Object.values(board.cards || {})) {
    if (card.characterId) referenced.add(card.characterId);
  }
  for (const m of Object.values(map.maps || {})) {
    for (const pin of m.pins || []) {
      if (pin.characterId) referenced.add(pin.characterId);
      if (pin.locationId) referenced.add(pin.locationId);
    }
  }

  const issues = [];
  for (const c of characters) {
    if (!referenced.has(c.id)) issues.push(i18n("Персонаж «{name}» нигде не упомянут — ни в связях, ни в таймлайне, ни во фракциях", { name: c.name }));
  }
  for (const l of locations) {
    if (!referenced.has(l.id)) issues.push(i18n("Локация «{name}» нигде не упомянута", { name: l.name }));
  }
  return issues;
}

export function duplicateTimelineEntries({ timeline }) {
  const seen = new Map();
  const issues = [];
  for (const ev of timeline) {
    const key = `${(ev.title || "").trim().toLowerCase()}|${(ev.date || "").trim().toLowerCase()}`;
    if (!key.trim().replace("|", "")) continue;
    if (seen.has(key)) issues.push(i18n("Возможный дубль на таймлайне: «{title}» ({date})", { title: ev.title, date: ev.date || i18n("без даты") }));
    seen.set(key, ev);
  }
  return issues;
}

export function emptyDoneChapters({ manuscript }) {
  return manuscript.chapters
    .filter((c) => c.status === "done" && !(c.content || "").trim())
    .map((c) => i18n("Глава «{title}» помечена «Готово», но текст пуст", { title: c.title }));
}

export async function renderContinuity(root) {
  root.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "continuity-panel";
  wrap.innerHTML = `<div class="empty-state">${i18n("Проверяю…")}</div>`;
  root.appendChild(wrap);

  const [characters, locations, relationships, factions, timeline, board, map, manuscript] = await Promise.all([
    apiGet("/api/characters"),
    apiGet("/api/locations"),
    apiGet("/api/relationships"),
    apiGet("/api/factions"),
    apiGet("/api/timeline"),
    apiGet("/api/board"),
    apiGet("/api/map"),
    apiGet("/api/manuscript"),
  ]);
  const data = { characters, locations, relationships, factions, timeline, board, map, manuscript };

  const sections = [
    [i18n("Битые ссылки"), brokenRefs(data)],
    [i18n("Забытые сущности"), orphans(data)],
    [i18n("Возможные дубли на таймлайне"), duplicateTimelineEntries(data)],
    [i18n("Главы «Готово» с пустым текстом"), emptyDoneChapters(data)],
  ];

  wrap.innerHTML = "";
  const total = sections.reduce((sum, [, list]) => sum + list.length, 0);

  if (!total) {
    const ok = document.createElement("div");
    ok.className = "empty-state";
    ok.textContent = i18n("Всё чисто — проверка не нашла проблем.");
    wrap.appendChild(ok);
    return;
  }

  for (const [title, list] of sections) {
    if (!list.length) continue;
    const section = document.createElement("div");
    section.className = "data-section";
    section.innerHTML = `<h3>${escapeHtml(title)} (${list.length})</h3>`;
    const ul = document.createElement("ul");
    ul.className = "continuity-list";
    for (const msg of list) {
      const li = document.createElement("li");
      li.textContent = msg;
      ul.appendChild(li);
    }
    section.appendChild(ul);
    wrap.appendChild(section);
  }
}
