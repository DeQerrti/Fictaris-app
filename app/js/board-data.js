import { uid } from "./api.js";
import { i18n } from "./i18n.js";

// ══════════════════════════════════════════════
//  ФОРМАТ board.json
//
//  Сейчас — несколько досок: { boards: [{id, name, columns, cards,
//  cardOrder}], activeBoardId }. До 0.3.5 была одна доска без обёртки
//  ({columns, cards, cardOrder}) — такой файл всё ещё может лежать на
//  диске или прийти из старого экспорта, поэтому читают его все только
//  через эти функции, а не напрямую.
// ══════════════════════════════════════════════

export function migrateBoards(raw) {
  if (raw && Array.isArray(raw.boards) && raw.boards.length) {
    return { boards: raw.boards, activeBoardId: raw.activeBoardId || raw.boards[0].id };
  }
  const legacy = raw && raw.columns ? raw : { columns: [], cards: {}, cardOrder: {} };
  const first = { id: uid(), name: i18n("Доска 1"), ...legacy };
  return { boards: [first], activeBoardId: first.id };
}

// Все доски одним плоским {columns, cards, cardOrder} — для тех, кому
// нужны все карточки разом (поиск, статистика, проверка ссылок), а не
// разбиение по доскам.
export function flattenBoards(raw) {
  const flat = { columns: [], cards: {}, cardOrder: {} };
  for (const b of migrateBoards(raw).boards) {
    flat.columns.push(...(b.columns || []));
    Object.assign(flat.cards, b.cards || {});
    Object.assign(flat.cardOrder, b.cardOrder || {});
  }
  return flat;
}

// Участники карточки. Раньше у карточки был один персонаж (characterId) —
// старые данные читаются так же, как новые (characterIds).
export function cardCharacterIds(card) {
  if (Array.isArray(card?.characterIds)) return card.characterIds;
  return card?.characterId ? [card.characterId] : [];
}
