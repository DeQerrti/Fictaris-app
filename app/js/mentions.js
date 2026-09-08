import { escapeHtml } from "./chips.js";
import { openContextMenu } from "./context-menu.js";
import { i18n } from "./i18n.js";

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// \b в JS-регулярках — чисто ASCII-концепция и не считает кириллицу
// словообразующей, поэтому границы совпадений ломались на «Астрариум»
// внутри имени «Астра». Вместо \b — negative lookahead: совпадение не
// продолжается словообразующим символом (латиница, кириллица, цифра,
// подчёркивание) сразу после имени.
//
// Две формы упоминания в одном регулярном выражении:
//   @[Имя|Как показать]  — псевдоним, тем же приёмом, что [[Имя|текст]]
//                           в Obsidian: слева от "|" — точное имя карточки
//                           (по нему ищется персонаж), справа — как это
//                           место должно читаться в самом тексте.
//                           Специально ради падежей: имя карточки —
//                           именительный ("Надя"), а в предложении нужно
//                           "Наде" — искать по m[1], показывать m[2].
//   @Имя                  — как раньше, без изменений.
// Обычная форма — резервная строгая проверка по границе слова
// (?!...), поэтому её нельзя просто "или" склеить наивно: движок
// сперва пробует форму с [ ], и только не найдя "[" сразу после "@" —
// обычную. Поэтому альтернативы идут именно в этом порядке.
function buildMentionRegex(characters) {
  const names = characters
    .map((c) => c.name)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length) // длинные имена раньше коротких — иначе «Аста» перехватит начало «Астра»
    .map(escapeRegex);
  if (!names.length) return null;
  const alt = names.join("|");
  return new RegExp(`@\\[(${alt})\\|([^\\]]+)\\]|@(${alt})(?![A-Za-zА-Яа-яЁё0-9_])`, "g");
}

// Персонаж и то, что должно быть видно в тексте, — общая часть для
// всех трёх функций ниже, чтобы не дублировать разбор групп m[1..3]
// трижды.
function resolveMatch(m, characters) {
  if (m[1] !== undefined) {
    return { char: characters.find((ch) => ch.name === m[1]), display: m[2] };
  }
  return { char: characters.find((ch) => ch.name === m[3]), display: `@${m[3]}` };
}

// Экранированный HTML с @упоминаниями, обёрнутыми в кликабельный span.
export function mentionsToHtml(text, characters) {
  const regex = buildMentionRegex(characters);
  if (!regex) return escapeHtml(text);

  let html = "";
  let last = 0;
  let m;
  while ((m = regex.exec(text))) {
    html += escapeHtml(text.slice(last, m.index));
    const { char, display } = resolveMatch(m, characters);
    html += `<span class="mention" data-char-id="${char.id}" style="color:${char.color || "var(--accent)"}">${escapeHtml(display)}</span>`;
    last = m.index + m[0].length;
  }
  html += escapeHtml(text.slice(last));
  return html;
}

// То же самое, но для статического экспорта сайта (export-site.js):
// @упоминание становится настоящей ссылкой <a href>, а не span'ом,
// который в приложении раскрывает карточку через JS-обработчик клика
// (никакого JS на статических страницах нет). hrefFor получает
// найденного персонажа и решает, куда вести ссылку — знает про
// структуру экспортированных файлов export-site.js, эта функция нет.
export function mentionsToLinkedHtml(text, characters, hrefFor) {
  const regex = buildMentionRegex(characters);
  if (!regex) return escapeHtml(text);

  let html = "";
  let last = 0;
  let m;
  while ((m = regex.exec(text))) {
    html += escapeHtml(text.slice(last, m.index));
    const { char, display } = resolveMatch(m, characters);
    const href = hrefFor(char);
    html += href ? `<a href="${href}">${escapeHtml(display)}</a>` : escapeHtml(display);
    last = m.index + m[0].length;
  }
  html += escapeHtml(text.slice(last));
  return html;
}

// Просто множество id упомянутых персонажей, без HTML — для мест,
// которым нужна не разметка, а сам факт связи (graph.js: ребро от
// сущности с текстом к упомянутому в нём персонажу).
export function findMentionedIds(text, characters) {
  const regex = buildMentionRegex(characters);
  const ids = new Set();
  if (!regex) return ids;
  let m;
  while ((m = regex.exec(text))) {
    const { char } = resolveMatch(m, characters);
    if (char) ids.add(char.id);
  }
  return ids;
}

// Автодополнение @упоминаний при наборе — список подсказок под полем,
// без привязки к точным координатам курсора (для этого пришлось бы
// мерить метрики шрифта символ за символом в plain textarea — не стоит
// сложности ради простого автокомплита).
export function attachMentionAutocomplete(field, getCharacters) {
  const list = document.createElement("div");
  list.className = "mention-autocomplete";
  list.style.display = "none";
  const parent = field.parentElement;
  if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
  parent.appendChild(list);

  function currentQuery() {
    const pos = field.selectionStart;
    const before = field.value.slice(0, pos);
    const m = /@([A-Za-zА-Яа-яЁё0-9_]*)$/.exec(before);
    return m ? { query: m[1], start: pos - m[1].length - 1 } : null;
  }

  function hide() {
    list.style.display = "none";
  }

  function update() {
    const q = currentQuery();
    const characters = getCharacters();
    if (!q || !characters.length) return hide();
    const matches = characters.filter((c) =>
      (c.name || "").toLowerCase().startsWith(q.query.toLowerCase())
    );
    if (!matches.length) return hide();

    list.innerHTML = "";
    for (const c of matches.slice(0, 6)) {
      const item = document.createElement("div");
      item.className = "mention-autocomplete-item";
      item.style.setProperty("--chip-color", c.color || "#7c7157");
      item.textContent = c.name;
      // mousedown, не click — иначе blur поля срабатывает раньше и список
      // успевает скрыться до того, как долетит клик.
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const pos = field.selectionStart;
        const value = field.value;
        const inserted = `@${c.name} `;
        field.value = value.slice(0, q.start) + inserted + value.slice(pos);
        const newPos = q.start + inserted.length;
        field.setSelectionRange(newPos, newPos);
        hide();
        field.dispatchEvent(new Event("input"));
        field.focus();
      });
      list.appendChild(item);
    }
    list.style.display = "block";
  }

  field.addEventListener("input", update);
  field.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
  field.addEventListener("blur", () => setTimeout(hide, 150));
}

// ══════════════════════════════════════════════
//  ПРАВЫЙ КЛИК: "ДОБАВИТЬ УПОМИНАНИЕ" / "ИЗМЕНИТЬ ОТОБРАЖАЕМЫЙ ТЕКСТ"
//
//  Синтаксис @[Имя|как показать] сам по себе никто не найдёт, если не
//  прочитать об этом — поэтому вместо документации сам правый клик
//  предлагает нужное действие: по обычному слову — "Добавить
//  упоминание" (выбор персонажа из списка сам решает, нужен ли
//  псевдоним — если слово совпадает с именем один в один, вставляется
//  просто "@Имя", иначе "@[Имя|то_что_было_выделено]"); по уже
//  существующему упоминанию — "Изменить отображаемый текст…".
// ══════════════════════════════════════════════

function isWordChar(ch) {
  return !!ch && /[A-Za-zА-Яа-яЁё0-9_]/.test(ch);
}

// Слово под кареткой, когда явного выделения нет — раздвигаем границы
// от позиции клика влево/вправо, пока идут словообразующие символы.
function wordAt(text, pos) {
  let start = pos;
  let end = pos;
  while (start > 0 && isWordChar(text[start - 1])) start--;
  while (end < text.length && isWordChar(text[end])) end++;
  if (start === end) return null;
  return { start, end, raw: text.slice(start, end) };
}

// Токен @[...] или @Слово, в границы которого попадает pos — чтобы
// правый клик в любом месте существующего упоминания (в том числе
// внутри квадратных скобок псевдонима) находил его целиком, а не одно
// слово внутри.
function mentionTokenAt(text, pos) {
  const re = /@\[[^\]]*\]|@[A-Za-zА-Яа-яЁё0-9_]+/g;
  let m;
  while ((m = re.exec(text))) {
    const start = m.index;
    const end = start + m[0].length;
    if (pos >= start && pos <= end) return { start, end, raw: m[0] };
  }
  return null;
}

// То же самое, но когда диапазон уже задан явным выделением — просто
// проверяем, что выделено ровно одно упоминание целиком, а не кусок.
function selectionAsMentionToken(text, start, end) {
  const raw = text.slice(start, end);
  if (/^@\[[^\]]*\]$/.test(raw) || /^@[A-Za-zА-Яа-яЁё0-9_]+$/.test(raw)) return { start, end, raw };
  return null;
}

function parseMentionToken(raw, characters) {
  const alias = /^@\[(.+)\|(.+)\]$/.exec(raw);
  if (alias) {
    const char = characters.find((c) => c.name === alias[1]);
    return char ? { char, display: alias[2] } : null;
  }
  const bare = /^@(.+)$/.exec(raw);
  if (bare) {
    const char = characters.find((c) => c.name === bare[1]);
    return char ? { char, display: bare[1] } : null;
  }
  return null;
}

function replaceRange(field, range, insertText) {
  const value = field.value;
  field.value = value.slice(0, range.start) + insertText + value.slice(range.end);
  const newPos = range.start + insertText.length;
  field.setSelectionRange(newPos, newPos);
  field.dispatchEvent(new Event("input")); // тот же приём, что и вставка автодополнением выше — включает autosave поля
  field.focus();
}

function renameMention(field, range, char) {
  const current = parseMentionToken(field.value.slice(range.start, range.end), [char])?.display || char.name;
  const next = window.prompt(i18n("Как показывать «{name}» в тексте:", { name: char.name }), current);
  if (next === null) return; // отменили
  const trimmed = next.trim();
  if (!trimmed) return;
  const token = trimmed === char.name ? `@${char.name}` : `@[${char.name}|${trimmed}]`;
  replaceRange(field, range, token);
}

// Чистый строитель пунктов меню (без побочных эффектов и без своего
// contextmenu-слушателя) — под позицию клика/выделение прямо сейчас в
// field. Возвращает [] когда там нет ни слова, ни упоминания (тогда
// вызывающая сторона просто не добавляет ничего в своё меню). Нужен
// отдельно от attachMentionContextMenu ниже затем, что у некоторых
// полей (главы рукописи, manuscript.js/attachEditorContextMenu) уже
// есть свой contextmenu-слушатель с другими пунктами — туда эти
// пункты нужно подмешать, а не завести второй независимый слушатель
// поверх (второй openContextMenu просто закрыл бы меню первого).
export function buildMentionContextMenuItems(field, characters) {
  if (!characters.length) return [];

  const text = field.value;
  const hasSelection = field.selectionStart !== field.selectionEnd;

  const mentionRange = hasSelection
    ? selectionAsMentionToken(text, field.selectionStart, field.selectionEnd)
    : mentionTokenAt(text, field.selectionStart);
  const parsed = mentionRange && parseMentionToken(mentionRange.raw, characters);

  if (mentionRange && parsed) {
    return [
      {
        label: i18n("Изменить отображаемый текст…"),
        action: () => renameMention(field, mentionRange, parsed.char),
      },
    ];
  }

  const word = hasSelection
    ? { start: field.selectionStart, end: field.selectionEnd, raw: text.slice(field.selectionStart, field.selectionEnd) }
    : wordAt(text, field.selectionStart);
  const raw = word?.raw.trim();
  if (!raw) return [];

  const exact = characters.find((c) => c.name === raw);
  if (exact) {
    return [{ label: i18n("Добавить упоминание «{name}»", { name: exact.name }), action: () => replaceRange(field, word, `@${exact.name}`) }];
  }
  return [
    {
      label: i18n("Добавить упоминание"),
      items: characters.map((c) => ({
        label: c.name,
        action: () => replaceRange(field, word, `@[${c.name}|${raw}]`),
      })),
    },
  ];
}

// Удобная обёртка поверх buildMentionContextMenuItems для полей БЕЗ
// собственного contextmenu-слушателя (timeline.js) — заводит его сама
// и открывает меню целиком из этих пунктов. Если пунктов нет (клик
// мимо слова), preventDefault не зовём — сработает обычное системное
// меню (вставить/копировать и т.п.).
export function attachMentionContextMenu(field, getCharacters) {
  field.addEventListener("contextmenu", (e) => {
    const items = buildMentionContextMenuItems(field, getCharacters());
    if (!items.length) return;
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY, items);
  });
}

// Hover-превью карточки при наведении на @упоминание в режиме просмотра.
// Один тултип на всё приложение, добавленный в body, — чтобы не
// обрезаться overflow:hidden/auto контейнеров рукописи и таймлайна.
let tooltipEl = null;
function ensureTooltip() {
  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.className = "mention-preview";
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

export function attachMentionHoverPreview(container, getCharacters) {
  container.addEventListener("mouseover", (e) => {
    const el = e.target.closest(".mention");
    if (!el) return;
    const c = getCharacters().find((x) => x.id === el.dataset.charId);
    if (!c) return;

    const tip = ensureTooltip();
    const initial = (c.name || "?").trim().slice(0, 1).toUpperCase();
    tip.innerHTML = `
      <div class="mention-preview-avatar" style="background:${c.color || "#7c7157"}">${escapeHtml(initial)}</div>
      <div>
        <div class="mention-preview-name">${escapeHtml(c.name || "")}</div>
        <div class="mention-preview-role">${escapeHtml(c.role || "")}</div>
      </div>
    `;
    const rect = el.getBoundingClientRect();
    tip.style.left = `${rect.left}px`;
    tip.style.top = `${rect.bottom + 6}px`;
    tip.style.display = "flex";
  });

  container.addEventListener("mouseout", (e) => {
    const leavingMention = e.target.closest(".mention");
    const enteringMention = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest(".mention");
    if (leavingMention && !enteringMention && tooltipEl) tooltipEl.style.display = "none";
  });
}
