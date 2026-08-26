import { apiGet } from "./api.js";
import { escapeHtml } from "./chips.js";

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
    if (r.charA && !chars.has(r.charA)) issues.push(`Связь «${r.label || "?"}» ссылается на несуществующего персонажа`);
    if (r.charB && !chars.has(r.charB)) issues.push(`Связь «${r.label || "?"}» ссылается на несуществующего персонажа`);
  }

  for (const f of factions) {
    if (f.leaderId && !chars.has(f.leaderId)) issues.push(`Фракция «${f.name}» — глава не найден`);
    if (f.headquartersId && !locs.has(f.headquartersId)) issues.push(`Фракция «${f.name}» — штаб-квартира не найдена`);
    for (const m of f.memberIds || []) {
      if (!chars.has(m)) issues.push(`Фракция «${f.name}» — в составе несуществующий персонаж`);
    }
  }

  for (const ev of timeline) {
    for (const c of ev.characterIds || []) {
      if (!chars.has(c)) issues.push(`Событие «${ev.title}» ссылается на несуществующего персонажа`);
    }
    for (const l of ev.locationIds || []) {
      if (!locs.has(l)) issues.push(`Событие «${ev.title}» ссылается на несуществующую локацию`);
    }
  }

  for (const card of Object.values(board.cards || {})) {
    if (card.characterId && !chars.has(card.characterId)) {
      issues.push(`Карточка доски «${card.title}» ссылается на несуществующего персонажа`);
    }
  }

  for (const m of Object.values(map.maps || {})) {
    for (const pin of m.pins || []) {
      if (pin.characterId && !chars.has(pin.characterId)) issues.push(`Метка «${pin.label}» на карте «${m.name}» ссылается на несуществующего персонажа`);
      if (pin.locationId && !locs.has(pin.locationId)) issues.push(`Метка «${pin.label}» на карте «${m.name}» ссылается на несуществующую локацию`);
      if (pin.linkedMapId && !map.maps[pin.linkedMapId]) issues.push(`Метка «${pin.label}» на карте «${m.name}» ссылается на несуществующую под-карту`);
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
    if (!referenced.has(c.id)) issues.push(`Персонаж «${c.name}» нигде не упомянут — ни в связях, ни в таймлайне, ни во фракциях`);
  }
  for (const l of locations) {
    if (!referenced.has(l.id)) issues.push(`Локация «${l.name}» нигде не упомянута`);
  }
  return issues;
}

export function duplicateTimelineEntries({ timeline }) {
  const seen = new Map();
  const issues = [];
  for (const ev of timeline) {
    const key = `${(ev.title || "").trim().toLowerCase()}|${(ev.date || "").trim().toLowerCase()}`;
    if (!key.trim().replace("|", "")) continue;
    if (seen.has(key)) issues.push(`Возможный дубль на таймлайне: «${ev.title}» (${ev.date || "без даты"})`);
    seen.set(key, ev);
  }
  return issues;
}

export function emptyDoneChapters({ manuscript }) {
  return manuscript.chapters
    .filter((c) => c.status === "done" && !(c.content || "").trim())
    .map((c) => `Глава «${c.title}» помечена «Готово», но текст пуст`);
}

export async function renderContinuity(root) {
  root.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "continuity-panel";
  wrap.innerHTML = '<div class="empty-state">Проверяю…</div>';
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
    ["Битые ссылки", brokenRefs(data)],
    ["Забытые сущности", orphans(data)],
    ["Возможные дубли на таймлайне", duplicateTimelineEntries(data)],
    ["Главы «Готово» с пустым текстом", emptyDoneChapters(data)],
  ];

  wrap.innerHTML = "";
  const total = sections.reduce((sum, [, list]) => sum + list.length, 0);

  if (!total) {
    const ok = document.createElement("div");
    ok.className = "empty-state";
    ok.textContent = "Всё чисто — проверка не нашла проблем.";
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
