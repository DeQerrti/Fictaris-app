// ══════════════════════════════════════════════
//  ФОРМАТИРОВАНИЕ ТЕКСТА ГЛАВЫ
//
//  wrapSelection (manuscript.js, ПКМ → «Форматирование») расставляет
//  условные маркеры прямо в тексте главы: **жирный**, *курсив*,
//  ~~зачёркнутый~~, ==выделение==, <u>подчёркнутый</u>. Общее место, а
//  не по копии в каждом потребителе — раньше их разбирал только режим
//  "Просмотр" в manuscript.js, а PDF/.docx-экспорт показывали маркеры
//  буквально, хотя обещали то же форматирование.
//
//  Два представления, не одно, потому что HTML и OOXML принципиально
//  разные форматы:
//  — applyInlineMarkupHtml — для HTML (режим "Просмотр", экспорт в
//    PDF): маркеры пережили html-экранирование как обычные символы,
//    поэтому работает поверх уже готовой экранированной строки.
//  — parseInlineSegments — для .docx (docx.js): там нет тегов, только
//    последовательность text-run'ов со своими свойствами (жирный/
//    курсив/...), поэтому разбирает сырой (неэкранированный) текст в
//    плоский список сегментов, а не строку.
// ══════════════════════════════════════════════

// Порядок важен: **жирный** разбирается раньше одиночных *, иначе
// первая пара *…* съела бы половину **жирного** как курсив.
export function applyInlineMarkupHtml(html) {
  return html
    .replace(/\*\*([^\n]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^\n*]+?)\*(?!\*)/g, "<em>$1</em>")
    .replace(/~~([^\n]+?)~~/g, "<s>$1</s>")
    .replace(/==([^\n]+?)==/g, "<mark>$1</mark>")
    .replace(/&lt;u&gt;([\s\S]+?)&lt;\/u&gt;/g, "<u>$1</u>");
}

// Та же пятёрка маркеров, только на сыром (неэкранированном) тексте —
// <u> здесь настоящий "<u>", не &lt;u&gt;. Каждый проход режет уже
// накопленный список сегментов на части — так один и тот же кусок
// текста может собрать сразу несколько флагов (bold+italic и т.п.),
// как и в HTML-версии.
const SEGMENT_MARKERS = [
  [/\*\*([^\n]+?)\*\*/g, "bold"],
  [/(?<!\*)\*([^\n*]+?)\*(?!\*)/g, "italic"],
  [/~~([^\n]+?)~~/g, "strike"],
  [/==([^\n]+?)==/g, "highlight"],
  [/<u>([\s\S]+?)<\/u>/g, "underline"],
];

export function parseInlineSegments(rawText) {
  let segments = [{ text: rawText }];
  for (const [re, key] of SEGMENT_MARKERS) {
    const next = [];
    for (const seg of segments) {
      // Уже нарезанный по этому же маркеру или пустой сегмент — как
      // есть, повторно не разбираем (в частности, содержимое,
      // добытое ИЗ маркера этого типа, само тем же типом уже не режем).
      if (seg[key] || !seg.text) { next.push(seg); continue; }
      let lastIndex = 0;
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(seg.text))) {
        if (m.index > lastIndex) next.push({ ...seg, text: seg.text.slice(lastIndex, m.index) });
        next.push({ ...seg, text: m[1], [key]: true });
        lastIndex = m.index + m[0].length;
      }
      if (lastIndex < seg.text.length) next.push({ ...seg, text: seg.text.slice(lastIndex) });
    }
    segments = next;
  }
  return segments.filter((s) => s.text !== "");
}

// Текст главы для читателя — то, что уходит в экспорт (.md, .docx, PDF).
// Служебная разметка редактора читателю не нужна: @[Надя|Наде] → «Наде»,
// @Надя → «Надя», маркер стикера [[note:n1]] (заметка автора) убирается.
// @ снимается только в начале слова перед буквой — «почта@домен» не
// трогаем. Форматирование (**жирный** и т.п.) остаётся: его разбирает
// каждый формат сам.
export function toReaderText(text) {
  return String(text || "")
    .replace(/\[\[(?:place|faction|entry):[\w-]+\|([^\]\n]*)\]\]/g, "$1")
    .replace(/ ?\[\[note:[^\]\n]*\]\]/g, "")
    .replace(/@\[([^|\]\n]+)\|([^\]\n]+)\]/g, "$2")
    .replace(/(^|[^\p{L}\p{N}_@])@(?=\p{L})/gu, "$1");
}

// ── Ссылки на места и фракции в тексте главы ──
// [[place:<id места>|как в тексте]], [[faction:<id фракции>|как в тексте]]
// — по id, а не по названию: переименование места ссылку не ломает, а
// слово в тексте (падеж) остаётся тем, что написал автор. Персонажи —
// по-прежнему @Имя / @[Имя|форма] (mentions.js).
// [[entry:<id записи>|как в тексте]] — запись своего раздела мира (sections.js).
export const ENTITY_LINK_RE = /\[\[(place|faction|entry):([\w-]+)\|([^\]\n]*)\]\]/g;

export function linkedEntityIds(text, kind) {
  const ids = new Set();
  for (const m of String(text || "").matchAll(ENTITY_LINK_RE)) if (m[1] === kind) ids.add(m[2]);
  return ids;
}

// Место или фракцию удалили — ссылка становится обычным словом.
export function unlinkEntity(text, kind, id) {
  let count = 0;
  const out = String(text || "").replace(ENTITY_LINK_RE, (m, k, i, shown) => {
    if (k !== kind || i !== id) return m;
    count++;
    return shown;
  });
  return { text: out, count };
}
