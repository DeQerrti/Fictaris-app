// ══════════════════════════════════════════════
//  ЧИСТКА ССЫЛОК ПРИ УДАЛЕНИИ
//
//  Персонаж, место или фракция ушли в корзину — их id оставались в других
//  файлах: в составе фракций, событиях таймлайна, главах, карточках доски,
//  метках карт, «Кто что знает». Разделы показывали пустые места или
//  «Удалено из мира», проверка согласованности ругалась. Здесь — по списку
//  «Что ссылается на что» из vault-guide.md. Собственный файл раздела
//  (characters.json и т.п.) правит сам раздел: у него своя копия в памяти.
//
//  Связи (relationships.json) удалённого персонажа уходят в корзину
//  отдельными записями — «Вернуть» персонажа возвращает и их.
// ══════════════════════════════════════════════

import { apiGet, apiPost } from "./api.js";
import { pushTrash } from "./trash.js";
import { unlinkEntity } from "./text-format.js";

function boardsOf(raw) {
  if (Array.isArray(raw?.boards)) return raw.boards;
  return raw && typeof raw === "object" && raw.cards ? [raw] : [];
}

// @[Имя|форма] → «форма», @Имя → «Имя»: удалённый персонаж в тексте
// остаётся обычными словами, а не битым упоминанием.
export function unlinkMentions(text, name, otherNames = []) {
  if (!text || !name) return { text, count: 0 };
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let count = 0;
  let out = text.replace(new RegExp(`@\\[${esc}\\|([^\\]\\n]+)\\]`, "gu"), (m, form) => {
    count++;
    return form;
  });
  const longer = otherNames.filter((n) => n && n !== name && n.startsWith(name));
  out = out.replace(new RegExp(`@${esc}(?![\\p{L}\\p{N}_])`, "gu"), (m, offset, whole) => {
    if (longer.some((n) => whole.startsWith(n, offset + 1))) return m;
    count++;
    return name;
  });
  return { text: out, count };
}

// Каждая detach* возвращает links — что именно убрала. Это кладётся в запись
// корзины, и «Вернуть» (reattach*) возвращает ссылки на место: персонаж
// снова в составе фракции, в событиях, на карточках, у родни. Не
// возвращаются только упоминания в тексте, ставшие обычными словами.

// otherNames — имена оставшихся персонажей: если есть тёзка, упоминания
// в тексте не трогаем (непонятно, чьи они).
export async function detachCharacter(character, otherNames = []) {
  const id = character.id;
  const [relationships, factions, timeline, manuscript, board, map, knowledge] = await Promise.all([
    apiGet("/api/relationships"),
    apiGet("/api/factions"),
    apiGet("/api/timeline"),
    apiGet("/api/manuscript"),
    apiGet("/api/board"),
    apiGet("/api/map"),
    apiGet("/api/knowledge"),
  ]);
  const links = { relationships: [], factions: [], timeline: [], chapters: [], cards: [], pins: [], knowledge: [] };
  const writes = [];

  const gone = relationships.filter((r) => r.charA === id || r.charB === id);
  if (gone.length) {
    for (const r of gone) await pushTrash("relationship", r);
    links.relationships = gone.map((r) => r.id);
    writes.push(apiPost("/api/relationships", relationships.filter((r) => !gone.includes(r))));
  }

  let changed = false;
  for (const f of factions) {
    const leader = f.leaderId === id;
    const at = Array.isArray(f.memberIds) ? f.memberIds.indexOf(id) : -1;
    const member = at >= 0;
    if (leader) f.leaderId = null;
    if (member) f.memberIds = f.memberIds.filter((x) => x !== id);
    if (leader || member) {
      links.factions.push({ id: f.id, leader, member, at });
      changed = true;
    }
  }
  if (changed) writes.push(apiPost("/api/factions", factions));

  changed = false;
  for (const e of timeline) {
    if (Array.isArray(e.characterIds) && e.characterIds.includes(id)) {
      links.timeline.push({ id: e.id, at: e.characterIds.indexOf(id) });
      e.characterIds = e.characterIds.filter((x) => x !== id);
      changed = true;
    }
  }
  if (changed) writes.push(apiPost("/api/timeline", timeline));

  changed = false;
  const hasNamesake = otherNames.includes(character.name);
  for (const ch of manuscript.chapters || []) {
    if (Array.isArray(ch.characterIds) && ch.characterIds.includes(id)) {
      links.chapters.push({ id: ch.id, at: ch.characterIds.indexOf(id) });
      ch.characterIds = ch.characterIds.filter((x) => x !== id);
      changed = true;
    }
    if (!hasNamesake && character.name) {
      const r = unlinkMentions(ch.content, character.name, otherNames);
      if (r.count) { ch.content = r.text; changed = true; }
    }
  }
  if (changed) writes.push(apiPost("/api/manuscript", manuscript));

  changed = false;
  for (const b of boardsOf(board)) {
    for (const card of Object.values(b.cards || {})) {
      const at = Array.isArray(card.characterIds) ? card.characterIds.indexOf(id) : -1;
      const legacy = card.characterId === id;
      if (at >= 0) card.characterIds = card.characterIds.filter((x) => x !== id);
      if (legacy) card.characterId = null;
      if (at >= 0 || legacy) {
        links.cards.push({ id: card.id, at });
        changed = true;
      }
    }
  }
  if (changed) writes.push(apiPost("/api/board", board));

  changed = false;
  for (const [mapId, m] of Object.entries(map.maps || {})) {
    for (const p of m.pins || []) if (p.characterId === id) {
      p.characterId = null;
      links.pins.push({ map: mapId, pin: p.id });
      changed = true;
    }
  }
  if (changed) writes.push(apiPost("/api/map", map));

  changed = false;
  for (const f of knowledge.facts || []) {
    if (f.entries && id in f.entries) {
      links.knowledge.push({ fact: f.id, value: f.entries[id] });
      delete f.entries[id];
      changed = true;
    }
  }
  if (changed) writes.push(apiPost("/api/knowledge", knowledge));

  await Promise.all(writes);
  return links;
}

export async function detachLocation(id) {
  const [factions, timeline, manuscript, board, map] = await Promise.all([
    apiGet("/api/factions"),
    apiGet("/api/timeline"),
    apiGet("/api/manuscript"),
    apiGet("/api/board"),
    apiGet("/api/map"),
  ]);
  const links = { headquarters: [], timeline: [], chapters: [], cards: [], pins: [] };
  const writes = [];
  let changed = false;
  for (const f of factions) if (f.headquartersId === id) {
    f.headquartersId = null;
    links.headquarters.push(f.id);
    changed = true;
  }
  if (changed) writes.push(apiPost("/api/factions", factions));

  changed = false;
  for (const e of timeline) {
    if (Array.isArray(e.locationIds) && e.locationIds.includes(id)) {
      links.timeline.push({ id: e.id, at: e.locationIds.indexOf(id) });
      e.locationIds = e.locationIds.filter((x) => x !== id);
      changed = true;
    }
  }
  if (changed) writes.push(apiPost("/api/timeline", timeline));

  changed = false;
  for (const ch of manuscript.chapters || []) {
    if (Array.isArray(ch.locationIds) && ch.locationIds.includes(id)) {
      links.chapters.push({ id: ch.id, at: ch.locationIds.indexOf(id) });
      ch.locationIds = ch.locationIds.filter((x) => x !== id);
      changed = true;
    }
    // Ссылки в тексте ([[place:id|слово]]) становятся обычным словом.
    const r = unlinkEntity(ch.content, "place", id);
    if (r.count) { ch.content = r.text; changed = true; }
  }
  if (changed) writes.push(apiPost("/api/manuscript", manuscript));

  changed = false;
  for (const b of boardsOf(board)) for (const card of Object.values(b.cards || {})) if (card.locationId === id) {
    card.locationId = null;
    links.cards.push(card.id);
    changed = true;
  }
  if (changed) writes.push(apiPost("/api/board", board));

  changed = false;
  for (const [mapId, m] of Object.entries(map.maps || {})) for (const p of m.pins || []) if (p.locationId === id) {
    p.locationId = null;
    links.pins.push({ map: mapId, pin: p.id });
    changed = true;
  }
  if (changed) writes.push(apiPost("/api/map", map));

  await Promise.all(writes);
  return links;
}

export async function detachFaction(id) {
  const [board, manuscript] = await Promise.all([apiGet("/api/board"), apiGet("/api/manuscript")]);
  const links = { cards: [] };
  let changed = false;
  for (const b of boardsOf(board)) for (const card of Object.values(b.cards || {})) if (card.factionId === id) {
    card.factionId = null;
    links.cards.push(card.id);
    changed = true;
  }
  if (changed) await apiPost("/api/board", board);
  changed = false;
  for (const ch of manuscript.chapters || []) {
    const r = unlinkEntity(ch.content, "faction", id);
    if (r.count) { ch.content = r.text; changed = true; }
  }
  if (changed) await apiPost("/api/manuscript", manuscript);
  return links;
}

// Запись своего раздела: ссылки [[entry:id|слово]] в главах становятся словом.
export async function detachEntry(id) {
  const manuscript = await apiGet("/api/manuscript");
  let changed = false;
  for (const ch of manuscript.chapters || []) {
    const r = unlinkEntity(ch.content, "entry", id);
    if (r.count) { ch.content = r.text; changed = true; }
  }
  if (changed) await apiPost("/api/manuscript", manuscript);
  return {};
}

// ── Возврат из корзины ──
// at — где id стоял в списке (порядок в списке — порядок в интерфейсе).
function addId(list, id, at = -1) {
  if (!Array.isArray(list)) return [id];
  if (list.includes(id)) return list;
  const next = [...list];
  next.splice(at >= 0 && at <= next.length ? at : next.length, 0, id);
  return next;
}

// Ссылка из links: { id, at } или просто id.
const refOf = (r) => (typeof r === "string" ? { id: r, at: -1 } : r);

function cardsById(board) {
  const map = new Map();
  for (const b of boardsOf(board)) for (const card of Object.values(b.cards || {})) map.set(card.id, card);
  return map;
}

function pinsOf(map, refs) {
  return refs.map((r) => (map.maps?.[r.map]?.pins || []).find((p) => p.id === r.pin)).filter(Boolean);
}

// characters — свежий список персонажей (уже с возвращённым): родня
// правится прямо в нём, записывает его вызывающий (trash.js).
export function reattachKin(characters, id, kin = []) {
  for (const k of kin) {
    const x = characters.find((c) => c.id === k.id);
    if (!x) continue;
    if (k.key === "partnerKind") {
      x.partnerKinds = { ...(x.partnerKinds || {}), [id]: k.value };
    } else {
      x[k.key] = addId(x[k.key], id, k.at);
    }
  }
}

export async function reattachCharacter(id, links = {}) {
  const [factions, timeline, manuscript, board, map, knowledge] = await Promise.all([
    apiGet("/api/factions"),
    apiGet("/api/timeline"),
    apiGet("/api/manuscript"),
    apiGet("/api/board"),
    apiGet("/api/map"),
    apiGet("/api/knowledge"),
  ]);
  const writes = [];
  if (links.factions?.length) {
    for (const ref of links.factions) {
      const f = factions.find((x) => x.id === ref.id);
      if (!f) continue;
      if (ref.leader && !f.leaderId) f.leaderId = id;
      if (ref.member) f.memberIds = addId(f.memberIds, id, ref.at);
    }
    writes.push(apiPost("/api/factions", factions));
  }
  if (links.timeline?.length) {
    for (const ref of links.timeline.map(refOf)) {
      const e = timeline.find((x) => x.id === ref.id);
      if (e) e.characterIds = addId(e.characterIds, id, ref.at);
    }
    writes.push(apiPost("/api/timeline", timeline));
  }
  if (links.chapters?.length) {
    for (const ref of links.chapters.map(refOf)) {
      const ch = (manuscript.chapters || []).find((x) => x.id === ref.id);
      if (ch) ch.characterIds = addId(ch.characterIds, id, ref.at);
    }
    writes.push(apiPost("/api/manuscript", manuscript));
  }
  if (links.cards?.length) {
    const cards = cardsById(board);
    for (const ref of links.cards.map(refOf)) {
      const card = cards.get(ref.id);
      if (card) card.characterIds = addId(card.characterIds, id, ref.at);
    }
    writes.push(apiPost("/api/board", board));
  }
  if (links.pins?.length) {
    for (const p of pinsOf(map, links.pins)) if (!p.characterId) p.characterId = id;
    writes.push(apiPost("/api/map", map));
  }
  if (links.knowledge?.length) {
    for (const ref of links.knowledge) {
      const f = (knowledge.facts || []).find((x) => x.id === ref.fact);
      if (f) f.entries = { ...(f.entries || {}), [id]: ref.value };
    }
    writes.push(apiPost("/api/knowledge", knowledge));
  }
  await Promise.all(writes);
}

export async function reattachLocation(id, links = {}) {
  const [locations, factions, timeline, manuscript, board, map] = await Promise.all([
    apiGet("/api/locations"),
    apiGet("/api/factions"),
    apiGet("/api/timeline"),
    apiGet("/api/manuscript"),
    apiGet("/api/board"),
    apiGet("/api/map"),
  ]);
  const writes = [];
  if (links.children?.length) {
    for (const l of locations) if (links.children.includes(l.id) && !l.parentId) l.parentId = id;
    writes.push(apiPost("/api/locations", locations));
  }
  if (links.headquarters?.length) {
    for (const f of factions) if (links.headquarters.includes(f.id) && !f.headquartersId) f.headquartersId = id;
    writes.push(apiPost("/api/factions", factions));
  }
  if (links.timeline?.length) {
    for (const ref of links.timeline.map(refOf)) {
      const e = timeline.find((x) => x.id === ref.id);
      if (e) e.locationIds = addId(e.locationIds, id, ref.at);
    }
    writes.push(apiPost("/api/timeline", timeline));
  }
  if (links.chapters?.length) {
    for (const ref of links.chapters.map(refOf)) {
      const ch = (manuscript.chapters || []).find((x) => x.id === ref.id);
      if (ch) ch.locationIds = addId(ch.locationIds, id, ref.at);
    }
    writes.push(apiPost("/api/manuscript", manuscript));
  }
  if (links.cards?.length) {
    const cards = cardsById(board);
    for (const cid of links.cards) {
      const card = cards.get(cid);
      if (card && !card.locationId) card.locationId = id;
    }
    writes.push(apiPost("/api/board", board));
  }
  if (links.pins?.length) {
    for (const p of pinsOf(map, links.pins)) if (!p.locationId) p.locationId = id;
    writes.push(apiPost("/api/map", map));
  }
  await Promise.all(writes);
}

export async function reattachFaction(id, links = {}) {
  const [factions, board, map] = await Promise.all([apiGet("/api/factions"), apiGet("/api/board"), apiGet("/api/map")]);
  const writes = [];
  if (links.relations && Object.keys(links.relations).length) {
    const self = factions.find((f) => f.id === id);
    for (const [otherId, status] of Object.entries(links.relations)) {
      const other = factions.find((f) => f.id === otherId);
      if (!other || !self) continue;
      other.relations = { ...(other.relations || {}), [id]: status };
      self.relations = { ...(self.relations || {}), [otherId]: status };
    }
    writes.push(apiPost("/api/factions", factions));
  }
  if (links.cards?.length) {
    const cards = cardsById(board);
    for (const cid of links.cards) {
      const card = cards.get(cid);
      if (card && !card.factionId) card.factionId = id;
    }
    writes.push(apiPost("/api/board", board));
  }
  if (links.borders?.length) {
    for (const ref of links.borders) {
      const shape = (map.maps?.[ref.map]?.drawing?.shapes || []).find((s) => s.id === ref.shape);
      if (shape && !shape.factionId) {
        shape.factionId = id;
        // Подпись, которую поставили при удалении, снова берётся у фракции.
        if (ref.named) delete shape.name;
      }
    }
    writes.push(apiPost("/api/map", map));
  }
  await Promise.all(writes);
}
