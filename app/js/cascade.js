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
//  отдельными записями — их можно вернуть вместе с персонажем.
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
  const writes = [];

  const gone = relationships.filter((r) => r.charA === id || r.charB === id);
  if (gone.length) {
    for (const r of gone) await pushTrash("relationship", r);
    writes.push(apiPost("/api/relationships", relationships.filter((r) => !gone.includes(r))));
  }

  let changed = false;
  for (const f of factions) {
    if (f.leaderId === id) { f.leaderId = null; changed = true; }
    if (Array.isArray(f.memberIds) && f.memberIds.includes(id)) { f.memberIds = f.memberIds.filter((x) => x !== id); changed = true; }
  }
  if (changed) writes.push(apiPost("/api/factions", factions));

  changed = false;
  for (const e of timeline) {
    if (Array.isArray(e.characterIds) && e.characterIds.includes(id)) { e.characterIds = e.characterIds.filter((x) => x !== id); changed = true; }
  }
  if (changed) writes.push(apiPost("/api/timeline", timeline));

  changed = false;
  const hasNamesake = otherNames.includes(character.name);
  for (const ch of manuscript.chapters || []) {
    if (Array.isArray(ch.characterIds) && ch.characterIds.includes(id)) { ch.characterIds = ch.characterIds.filter((x) => x !== id); changed = true; }
    if (!hasNamesake && character.name) {
      const r = unlinkMentions(ch.content, character.name, otherNames);
      if (r.count) { ch.content = r.text; changed = true; }
    }
  }
  if (changed) writes.push(apiPost("/api/manuscript", manuscript));

  changed = false;
  for (const b of boardsOf(board)) {
    for (const card of Object.values(b.cards || {})) {
      if (Array.isArray(card.characterIds) && card.characterIds.includes(id)) { card.characterIds = card.characterIds.filter((x) => x !== id); changed = true; }
      if (card.characterId === id) { card.characterId = null; changed = true; }
    }
  }
  if (changed) writes.push(apiPost("/api/board", board));

  changed = false;
  for (const m of Object.values(map.maps || {})) {
    for (const p of m.pins || []) if (p.characterId === id) { p.characterId = null; changed = true; }
  }
  if (changed) writes.push(apiPost("/api/map", map));

  changed = false;
  for (const f of knowledge.facts || []) {
    if (f.entries && id in f.entries) { delete f.entries[id]; changed = true; }
  }
  if (changed) writes.push(apiPost("/api/knowledge", knowledge));

  await Promise.all(writes);
}

export async function detachLocation(id) {
  const [factions, timeline, manuscript, board, map] = await Promise.all([
    apiGet("/api/factions"),
    apiGet("/api/timeline"),
    apiGet("/api/manuscript"),
    apiGet("/api/board"),
    apiGet("/api/map"),
  ]);
  const writes = [];
  let changed = false;
  for (const f of factions) if (f.headquartersId === id) { f.headquartersId = null; changed = true; }
  if (changed) writes.push(apiPost("/api/factions", factions));

  changed = false;
  for (const e of timeline) {
    if (Array.isArray(e.locationIds) && e.locationIds.includes(id)) { e.locationIds = e.locationIds.filter((x) => x !== id); changed = true; }
  }
  if (changed) writes.push(apiPost("/api/timeline", timeline));

  changed = false;
  for (const ch of manuscript.chapters || []) {
    if (Array.isArray(ch.locationIds) && ch.locationIds.includes(id)) { ch.locationIds = ch.locationIds.filter((x) => x !== id); changed = true; }
    // Ссылки в тексте ([[place:id|слово]]) становятся обычным словом.
    const r = unlinkEntity(ch.content, "place", id);
    if (r.count) { ch.content = r.text; changed = true; }
  }
  if (changed) writes.push(apiPost("/api/manuscript", manuscript));

  changed = false;
  for (const b of boardsOf(board)) for (const card of Object.values(b.cards || {})) if (card.locationId === id) { card.locationId = null; changed = true; }
  if (changed) writes.push(apiPost("/api/board", board));

  changed = false;
  for (const m of Object.values(map.maps || {})) for (const p of m.pins || []) if (p.locationId === id) { p.locationId = null; changed = true; }
  if (changed) writes.push(apiPost("/api/map", map));

  await Promise.all(writes);
}

export async function detachFaction(id) {
  const [board, manuscript] = await Promise.all([apiGet("/api/board"), apiGet("/api/manuscript")]);
  let changed = false;
  for (const b of boardsOf(board)) for (const card of Object.values(b.cards || {})) if (card.factionId === id) { card.factionId = null; changed = true; }
  if (changed) await apiPost("/api/board", board);
  changed = false;
  for (const ch of manuscript.chapters || []) {
    const r = unlinkEntity(ch.content, "faction", id);
    if (r.count) { ch.content = r.text; changed = true; }
  }
  if (changed) await apiPost("/api/manuscript", manuscript);
}
