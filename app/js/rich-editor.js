// ══════════════════════════════════════════════
//  РЕДАКТОР ГЛАВЫ «КАК В КНИГЕ»
//
//  Раньше главу писали в обычном текстовом поле и видели служебную
//  разметку: вместо «Астра» — @[Астра Вирен|Астра], звёздочки курсива,
//  [[note:n1]] стикеров. Оформленный текст был только в «Просмотре», где
//  писать нельзя. Здесь пишут сразу в оформленном тексте: упоминание —
//  цветное слово, стикер — значок, курсив — курсивом.
//
//  Формат хранения не меняется — глава по-прежнему простой текст с теми
//  же маркерами (vault-guide.md, text-format.js): render() разбирает его
//  в HTML, serialize() собирает обратно. Поэтому экспорт, поиск,
//  синхронизация и правка файлов снаружи работают как раньше.
// ══════════════════════════════════════════════

import { escapeHtml } from "./chips.js";
import { applyInlineMarkupHtml, ENTITY_LINK_RE } from "./text-format.js";
import { buildMentionRegex } from "./mentions.js";
import { iconSvg, locationTypeInfo, factionTypeInfo } from "./icons.js";
import { safeColor } from "./sanitize.js";
import { i18n } from "./i18n.js";
import { addBeforeFlush } from "./save-badge.js";

const PH_BASE = 0xe000; // символы из области частного использования — временные заглушки

// ── Текст → HTML ──
function renderLine(line, ctx) {
  const tokens = [];
  const put = (html) => {
    tokens.push(html);
    return String.fromCharCode(PH_BASE + tokens.length - 1);
  };
  let s = line;
  const re = ctx.mentionRe;
  if (re) {
    re.lastIndex = 0;
    s = s.replace(re, (m, aliasName, form, plainName) => {
      const name = aliasName ?? plainName;
      const char = ctx.characters.find((c) => c.name === name);
      if (!char) return m;
      return put(mentionHtml(char, aliasName !== undefined ? form : name, aliasName === undefined));
    });
  }
  s = s.replace(ENTITY_LINK_RE, (m, kind, id, shown) => put(linkHtml(kind, id, shown, ctx)));
  s = s.replace(/\[\[note:([\w-]+)\]\]/g, (m, id) => put(stickyHtml(id)));
  // Комментарий к фрагменту (comments.js): подсветка вокруг текста.
  s = s.replace(/\[\[c:([\w-]+)\]\]/g, (m, id) => put(`<span class="re-comment${ctx.resolved?.has(id) ? " resolved" : ""}" data-comment-id="${escapeHtml(id)}">`));
  s = s.replace(/\[\[\/c\]\]/g, () => put("</span>"));
  let html = applyInlineMarkupHtml(escapeHtml(s));
  html = html.replace(/[-]/g, (ch) => tokens[ch.charCodeAt(0) - PH_BASE] ?? "");
  return html;
}

export function mentionHtml(char, form, plain) {
  const color = safeColor(char.color, "var(--accent)");
  return `<span class="mention re-mention" contenteditable="false" data-char-id="${escapeHtml(char.id)}" data-name="${escapeHtml(char.name)}" data-form="${escapeHtml(form)}"${plain ? ' data-plain="1"' : ""} style="color:${color}">${escapeHtml(form)}</span>`;
}

// Ссылка на место или фракцию: цвет — от типа места/фракции, как в
// разделах. Удалённое (id не найден) — приглушённо, но ссылка в тексте
// сохраняется как была.
export function entityOf(kind, id, ctx) {
  const list = kind === "place" ? ctx.locations : kind === "entry" ? ctx.entries : ctx.factions;
  return (list || []).find((x) => x.id === id) || null;
}

export function entityColor(kind, entity) {
  if (!entity) return "var(--text-faint)";
  if (kind === "entry") return safeColor(entity._sec?.color, "#7d6a9e");
  return kind === "place" ? locationTypeInfo(entity.type)[3] : factionTypeInfo(entity.type)[3];
}

export function linkHtml(kind, id, shown, ctx) {
  const entity = entityOf(kind, id, ctx);
  const text = shown || entity?.name || "?";
  return `<span class="re-link re-link-${kind}${entity ? "" : " missing"}" contenteditable="false" data-kind="${kind}" data-id="${escapeHtml(id)}" data-form="${escapeHtml(text)}" style="color:${entityColor(kind, entity)}">${escapeHtml(text)}</span>`;
}

function stickyHtml(id) {
  return `<span class="sticky-marker re-sticky" contenteditable="false" data-sticky-id="${escapeHtml(id)}">${iconSvg("note", 13)}</span>`;
}

function renderText(text, ctx) {
  return String(text || "")
    .split("\n")
    .map((line) => `<div class="re-p">${renderLine(line, ctx) || "<br>"}</div>`)
    .join("");
}

// ── HTML → текст ──
const BLOCK = new Set(["DIV", "P", "LI", "H1", "H2", "H3", "H4", "BLOCKQUOTE", "PRE"]);

function styleKinds(el) {
  const kinds = [];
  const tag = el.tagName;
  if (tag === "B" || tag === "STRONG") kinds.push("bold");
  if (tag === "I" || tag === "EM") kinds.push("italic");
  if (tag === "U") kinds.push("underline");
  if (tag === "S" || tag === "STRIKE" || tag === "DEL") kinds.push("strike");
  if (tag === "MARK") kinds.push("highlight");
  const st = el.style;
  if (st) {
    if (st.fontWeight === "bold" || Number(st.fontWeight) >= 600) kinds.push("bold");
    if (st.fontStyle === "italic") kinds.push("italic");
    const deco = st.textDecorationLine || st.textDecoration || "";
    if (/underline/.test(deco)) kinds.push("underline");
    if (/line-through/.test(deco)) kinds.push("strike");
    if (st.backgroundColor && !el.classList.contains("re-mention") && !el.classList.contains("re-link")) kinds.push("highlight");
  }
  return [...new Set(kinds)];
}

const MARKERS = { bold: ["**", "**"], italic: ["*", "*"], underline: ["<u>", "</u>"], strike: ["~~", "~~"], highlight: ["==", "=="] };
// Снаружи внутрь: жирный снаружи курсива даёт «***x***», который разбирается
// как жирный с курсивом; остальные — по порядку разбора в text-format.js.
const ORDER = ["highlight", "strike", "underline", "bold", "italic"];

function inlineText(node, active) {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue.replace(/ /g, " ").replace(/[-​]/g, "");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node;
  if (el.classList.contains("re-mention")) {
    const name = el.dataset.name;
    const form = (el.textContent || "").replace(/ /g, " ").trim() || el.dataset.form || name;
    return el.dataset.plain === "1" && form === name ? `@${name}` : `@[${name}|${form}]`;
  }
  if (el.classList.contains("re-sticky")) return `[[note:${el.dataset.stickyId}]]`;
  if (el.classList.contains("re-comment")) {
    let inner = "";
    for (const child of el.childNodes) inner += inlineText(child, active);
    return inner ? `[[c:${el.dataset.commentId}]]${inner}[[/c]]` : "";
  }
  if (el.classList.contains("re-link")) {
    // «]» и «|» в слове сломали бы разметку ссылки — заменяем похожими.
    const shown = (el.textContent || "").replace(/\u00a0/g, " ").trim().replace(/\]/g, ")").replace(/\|/g, "/") || el.dataset.form || "?";
    return `[[${el.dataset.kind}:${el.dataset.id}|${shown}]]`;
  }
  if (el.tagName === "BR") return "\n";
  if (el.tagName === "IMG" || el.tagName === "SCRIPT" || el.tagName === "STYLE") return "";
  const own = styleKinds(el).filter((k) => !active.has(k));
  const next = new Set([...active, ...own]);
  let inner = "";
  for (const child of el.childNodes) {
    if (BLOCK.has(child.nodeName) && inner && !inner.endsWith("\n")) inner += "\n";
    inner += inlineText(child, next);
    if (BLOCK.has(child.nodeName) && child.nextSibling) inner += "\n";
  }
  if (!inner.trim() || !own.length) return inner;
  // Маркеры не захватывают пробелы по краям — иначе «** слово**» не разберётся.
  const lead = inner.match(/^\s*/)[0];
  const trail = inner.match(/\s*$/)[0];
  let core = inner.slice(lead.length, inner.length - trail.length);
  for (const k of ORDER.filter((x) => own.includes(x)).reverse()) core = MARKERS[k][0] + core + MARKERS[k][1];
  return lead + core + trail;
}

export function serialize(root) {
  const lines = [];
  let pending = "";
  let hasPending = false;
  const flush = () => {
    if (hasPending) lines.push(pending);
    pending = "";
    hasPending = false;
  };
  for (const node of root.childNodes) {
    if (BLOCK.has(node.nodeName)) {
      flush();
      // Одна строка-абзац; <div><br></div> — пустой абзац.
      const text = inlineText(node, new Set());
      lines.push(text.replace(/\n$/, ""));
    } else {
      pending += inlineText(node, new Set());
      hasPending = true;
    }
  }
  flush();
  return lines.join("\n");
}

// Вставка готового HTML в место курсора — вручную через Range, а не
// execCommand("insertHTML"): тот выносил нередактируемое упоминание из
// абзаца на уровень редактора, и при сохранении оно становилось отдельным
// абзацем. Курсор после вставки — сразу за вставленным.
export function insertAtSelection(root, html) {
  const sel = getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  // Курсор прямо в корне редактора (пустой редактор) — сначала абзац.
  if (range.startContainer === root) {
    const p = document.createElement("div");
    p.className = "re-p";
    range.insertNode(p);
    range.selectNodeContents(p);
    range.collapse(true);
  }
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const nodes = [...tpl.content.childNodes];
  const last = nodes[nodes.length - 1];
  range.insertNode(tpl.content);
  // Пустой абзац держит <br> — после вставки он лишний.
  const block = last?.parentElement?.closest?.(".re-p");
  if (block && block.lastChild?.nodeName === "BR" && block.childNodes.length > 1) block.lastChild.remove();
  if (last) {
    const after = document.createRange();
    after.setStartAfter(last);
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);
  }
}

// ── Сам редактор ──
// opts: { text, characters, placeholder, onChange(text), onMentionClick(span), onReady }
export function createRichEditor(opts) {
  const ctx = { characters: opts.characters || [], locations: opts.locations || [], factions: opts.factions || [], entries: opts.entries || [], mentionRe: buildMentionRegex(opts.characters || []) };
  const el = document.createElement("div");
  el.className = "chapter-content rich-editor";
  el.contentEditable = "true";
  el.spellcheck = true;
  el.setAttribute("role", "textbox");
  el.setAttribute("aria-multiline", "true");
  if (opts.placeholder) el.dataset.placeholder = opts.placeholder;
  el.innerHTML = renderText(opts.text, ctx);
  let lastText = serialize(el);
  // Если разбор и сборка дали не ровно исходный текст (необычная
  // разметка в файле), первой правкой запишется нормализованный вариант;
  // сам файл не трогаем, пока человек ничего не менял.
  const syncEmpty = () => el.classList.toggle("is-empty", !el.textContent.trim() && !el.querySelector(".re-mention, .re-sticky"));
  syncEmpty();

  const changed = () => {
    const text = serialize(el);
    syncEmpty();
    if (text === lastText) return;
    lastText = text;
    opts.onChange?.(text);
  };

  // ── Отмена и повтор ──
  // Встроенная отмена браузера не видит того, что вставлено программой
  // (ссылка, стикер, упоминание, смена падежа) — Ctrl+Z их пропускал.
  // Поэтому история своя: снимок — текст главы и место курсора. Набор
  // подряд объединяется в один шаг (пауза больше секунды или другой вид
  // правки — новый шаг), вставки и оформление — всегда отдельный шаг.
  const undoStack = [];
  const redoStack = [];
  const UNDO_LIMIT = 300;
  let lastKind = null;
  let lastAt = 0;

  function caretPos() {
    const sel = getSelection();
    if (!sel.rangeCount || !el.contains(sel.anchorNode)) return null;
    const node = sel.anchorNode.nodeType === Node.TEXT_NODE ? sel.anchorNode.parentElement : sel.anchorNode;
    const p = node.closest?.(".re-p");
    if (!p || !el.contains(p)) return null;
    const r = document.createRange();
    r.setStart(p, 0);
    r.setEnd(sel.anchorNode, sel.anchorOffset);
    return { p: [...el.children].indexOf(p), offset: r.toString().length };
  }

  function setCaret(pos) {
    const p = pos ? el.children[Math.min(pos.p, el.children.length - 1)] : el.lastElementChild;
    if (!p) return;
    const r = document.createRange();
    let left = pos ? pos.offset : Infinity;
    let placed = false;
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const locked = t.parentElement.closest('[contenteditable="false"]');
      if (left <= t.nodeValue.length) {
        if (locked && el.contains(locked)) r.setStartAfter(locked);
        else r.setStart(t, left);
        placed = true;
        break;
      }
      left -= t.nodeValue.length;
    }
    if (!placed) {
      r.selectNodeContents(p);
      r.collapse(false);
    }
    r.collapse(true);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  // kind: "type" / "delete" — набор (объединяется), остальное — отдельный шаг.
  function recordUndo(kind = "edit") {
    const now = Date.now();
    const groupable = (kind === "type" || kind === "delete") && kind === lastKind && now - lastAt < 1000;
    lastKind = kind;
    lastAt = now;
    if (groupable) return;
    const text = serialize(el);
    if (undoStack.length && undoStack[undoStack.length - 1].text === text) return;
    undoStack.push({ text, caret: caretPos() });
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack.length = 0;
  }

  function restore(state) {
    el.innerHTML = renderText(state.text, ctx);
    el.focus();
    setCaret(state.caret);
    lastKind = null;
    changed();
  }

  function undo() {
    if (pending) flushNow();
    const current = { text: serialize(el), caret: caretPos() };
    let state = undoStack.pop();
    while (state && state.text === current.text) state = undoStack.pop();
    if (!state) return;
    redoStack.push(current);
    restore(state);
  }

  function redo() {
    const state = redoStack.pop();
    if (!state) return;
    undoStack.push({ text: serialize(el), caret: caretPos() });
    restore(state);
  }

  el.addEventListener("beforeinput", (e) => {
    if (e.inputType === "historyUndo" || e.inputType === "historyRedo") {
      e.preventDefault();
      if (e.inputType === "historyUndo") undo();
      else redo();
      return;
    }
    const kind = e.inputType.startsWith("insertText") || e.inputType === "insertCompositionText"
      ? "type"
      : e.inputType.startsWith("delete")
        ? "delete"
        : e.inputType;
    recordUndo(kind);
  });
  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y — по коду клавиши, в любой раскладке.
  el.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.code === "KeyZ") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (e.code === "KeyY") {
      e.preventDefault();
      redo();
    }
  });
  // Длинная глава: сборка всего текста на каждое нажатие заметно
  // тормозит (≈16 мс на 35 тыс. слов) — собираем после короткой паузы.
  // Перед срочной записью (закрытие окна, F5, смена проекта) несобранное
  // отдаётся через addBeforeFlush.
  const LONG = 40000;
  let pending = null;
  const flushNow = () => {
    if (!pending) return;
    clearTimeout(pending);
    pending = null;
    changed();
  };
  const unregister = addBeforeFlush(() => {
    if (!el.isConnected) {
      unregister();
      return;
    }
    flushNow();
  });
  el.addEventListener("input", () => {
    if (el.textContent.length < LONG) return changed();
    clearTimeout(pending);
    pending = setTimeout(flushNow, 250);
  });
  el.addEventListener("blur", flushNow);

  // Вставка — только простым текстом: чужое оформление (шрифты, цвета,
  // таблицы из Word или браузера) в главу не тянем. Маркеры в
  // вставленном тексте (@[…], **…**) оформятся при следующем открытии.
  el.addEventListener("paste", (e) => {
    const text = e.clipboardData?.getData("text/plain");
    if (text == null) return;
    e.preventDefault();
    recordUndo("paste");
    document.execCommand("insertText", false, text.replace(/\r\n?/g, "\n"));
  });
  el.addEventListener("drop", (e) => {
    const text = e.dataTransfer?.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    recordUndo("paste");
    const range = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (range) {
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    document.execCommand("insertText", false, text);
  });

  // Ctrl+B/I/U — как в любом текстовом редакторе.
  el.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    const kind = { b: "bold", "и": "bold", i: "italic", "ш": "italic", u: "underline", "г": "underline" }[k];
    if (kind) {
      e.preventDefault();
      format(kind);
    }
  });

  el.addEventListener("click", (e) => {
    const m = e.target.closest?.(".re-mention, .re-link");
    if (m && el.contains(m)) {
      e.preventDefault();
      opts.onMentionClick?.(m, e);
      return;
    }
    const c = e.target.closest?.(".re-comment");
    if (c && el.contains(c) && getSelection().isCollapsed) opts.onCommentClick?.(c, e);
  });

  function format(kind) {
    el.focus();
    recordUndo("format");
    if (kind === "highlight") {
      const sel = getSelection();
      const node = sel.anchorNode?.parentElement?.closest?.("mark, [style*='background']");
      if (node && el.contains(node)) {
        node.replaceWith(...node.childNodes);
        changed();
      } else document.execCommand("hiliteColor", false, "rgba(201, 148, 74, 0.35)");
    } else {
      document.execCommand("styleWithCSS", false, false);
      document.execCommand({ bold: "bold", italic: "italic", underline: "underline", strike: "strikeThrough" }[kind]);
    }
    changed();
  }

  function placeCaretAtEndIfOutside() {
    const sel = getSelection();
    if (sel.rangeCount && el.contains(sel.anchorNode)) return;
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el.lastElementChild || el);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function insertHtml(html) {
    placeCaretAtEndIfOutside();
    recordUndo("insert");
    insertAtSelection(el, html);
    changed();
  }

  return {
    el,
    format,
    getText: () => serialize(el),
    focus: () => el.focus(),
    insertText(text) {
      placeCaretAtEndIfOutside();
      recordUndo("insert");
      document.execCommand("insertText", false, text);
      changed();
    },
    insertSticky(id) {
      insertHtml(stickyHtml(id));
    },
    ctx,
    // Выделенное (или сохранённое заранее, если фокус уходил в окно поиска)
    // становится ссылкой: само слово остаётся в тексте как было.
    linkRange(range, target) {
      const shown = range.toString().replace(/\s+/g, " ").trim();
      if (!shown) return;
      el.focus();
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      recordUndo("link");
      insertAtSelection(el, targetHtml(target, shown, ctx));
      changed();
    },
    // Комментарий к выделенному (comments.js): выделение в одном абзаце
    // оборачивается подсветкой. Возвращает выделенный текст или null.
    wrapComment(id) {
      const sel = getSelection();
      if (!sel.rangeCount || sel.isCollapsed) return null;
      const range = sel.getRangeAt(0);
      const pOf = (n) => (n.nodeType === Node.TEXT_NODE ? n.parentElement : n)?.closest?.(".re-p");
      const p = pOf(range.startContainer);
      if (!p || p !== pOf(range.endContainer) || !el.contains(p)) return null;
      const quote = range.toString().replace(/\s+/g, " ").trim();
      if (!quote) return null;
      recordUndo("comment");
      const span = document.createElement("span");
      span.className = "re-comment";
      span.dataset.commentId = id;
      span.appendChild(range.extractContents());
      range.insertNode(span);
      sel.removeAllRanges();
      changed();
      return quote;
    },
    // Убрать подсветку комментария (сам текст остаётся).
    unwrapComment(id) {
      for (const span of el.querySelectorAll(`.re-comment[data-comment-id="${CSS.escape(id)}"]`)) span.replaceWith(...span.childNodes);
      changed();
    },
    setResolved(ids) {
      ctx.resolved = ids;
      for (const span of el.querySelectorAll(".re-comment")) span.classList.toggle("resolved", ids.has(span.dataset.commentId));
    },
    // Для правок снаружи редактора (окно ссылки, подсказка «@»): снимок
    // до изменения — чтобы Ctrl+Z их отменял.
    recordUndo: () => recordUndo("external"),
    undo,
    redo,
    savedRange() {
      const sel = getSelection();
      return sel.rangeCount && el.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    },
    selectionText() {
      const sel = getSelection();
      if (!sel.rangeCount || !el.contains(sel.anchorNode)) return "";
      const frag = sel.getRangeAt(0).cloneContents();
      const tmp = document.createElement("div");
      tmp.appendChild(frag);
      return serialize(tmp);
    },
    hasSelection() {
      const sel = getSelection();
      return !!sel.rangeCount && !sel.isCollapsed && el.contains(sel.anchorNode);
    },
    changed,
    setSources({ characters, locations, factions, entries }) {
      if (characters) {
        ctx.characters = characters;
        ctx.mentionRe = buildMentionRegex(characters);
      }
      if (locations) ctx.locations = locations;
      if (factions) ctx.factions = factions;
      if (entries) ctx.entries = entries;
    },
  };
}

// ── Что можно упомянуть: персонажи, места, фракции ──
// Единый список для «@» и для «Сделать ссылкой…». kind: "character" |
// "place" | "faction".
const KIND_LABEL = { character: "Персонаж", place: "Место", faction: "Фракция" };

// entries — записи своих разделов с _sec (раздел: name, color), см. sections.js.
export function linkTargets({ characters = [], locations = [], factions = [], entries = [] }) {
  return [
    ...characters.filter((c) => c.name).map((c) => ({ kind: "character", id: c.id, name: c.name, color: safeColor(c.color, "#7c7157"), entity: c })),
    ...locations.filter((l) => l.name).map((l) => ({ kind: "place", id: l.id, name: l.name, color: locationTypeInfo(l.type)[3], entity: l })),
    ...factions.filter((f) => f.name).map((f) => ({ kind: "faction", id: f.id, name: f.name, color: factionTypeInfo(f.type)[3], entity: f })),
    ...entries.filter((e) => e.name && e._sec).map((e) => ({ kind: "entry", id: e.id, name: e.name, color: safeColor(e._sec.color, "#7d6a9e"), entity: e, label: e._sec.name })),
  ];
}

// Насколько название похоже на набранное или выделенное слово. Учитывает
// падежи грубо: «Ивняке» → основа «Ивня» найдёт «Ивняк», «Вельде» — «Вельда».
export function matchScore(name, query) {
  const n = name.toLowerCase();
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  if (n === q) return 100;
  if (n.startsWith(q)) return 80;
  const words = n.split(/[\s-]+/);
  if (words.some((w) => w.startsWith(q))) return 60;
  const stem = q.length > 4 ? q.slice(0, q.length - 2) : q.length > 3 ? q.slice(0, q.length - 1) : q;
  if (words.some((w) => w.startsWith(stem))) return 40;
  if (n.includes(q)) return 20;
  return 0;
}

export function rankTargets(targets, query, limit = 8) {
  return targets
    .map((t) => ({ t, s: matchScore(t.name, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.t.name.localeCompare(b.t.name))
    .slice(0, limit)
    .map((x) => x.t);
}

// HTML ссылки для выбранного: персонаж — @-упоминание, остальное — [[…]].
export function targetHtml(target, shown, ctx) {
  if (target.kind === "character") return mentionHtml(target.entity, shown || target.name, !shown || shown === target.name);
  return linkHtml(target.kind, target.id, shown || target.name, ctx);
}

function itemEl(t, active) {
  const item = document.createElement("div");
  item.className = "mention-autocomplete-item re-target" + (active ? " active" : "");
  item.setAttribute("role", "option");
  item.setAttribute("aria-selected", active ? "true" : "false");
  item.style.setProperty("--chip-color", t.color);
  const name = document.createElement("span");
  name.textContent = t.name;
  const kind = document.createElement("small");
  kind.textContent = t.label || i18n(KIND_LABEL[t.kind]);
  item.append(name, kind);
  return item;
}

// ── «@» — подсказка у курсора ──
// Набрал «@» и начало названия — список персонажей, мест и фракций рядом с
// курсором; стрелки, Enter или Tab — вставить ссылку, Esc — закрыть.
export function attachRichAutocomplete(editor, getSources) {
  const el = editor.el;
  const list = document.createElement("div");
  list.className = "mention-autocomplete re-autocomplete";
  list.setAttribute("role", "listbox");
  list.style.display = "none";
  document.body.appendChild(list);
  let items = [];
  let active = 0;
  let query = null;

  const hide = () => {
    list.style.display = "none";
    query = null;
  };

  function currentQuery() {
    const sel = getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return null;
    const node = sel.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE || !el.contains(node)) return null;
    const before = node.nodeValue.slice(0, sel.anchorOffset);
    const m = /(?:^|[^\p{L}\p{N}_@])@([\p{L}\p{N}_-]*(?: [\p{L}\p{N}_-]*)?)$/u.exec(before);
    if (!m) return null;
    return { node, end: sel.anchorOffset, start: sel.anchorOffset - m[1].length - 1, text: m[1] };
  }

  function choose(t) {
    if (!query || !t) return hide();
    const r = document.createRange();
    r.setStart(query.node, query.start);
    r.setEnd(query.node, query.end);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    // Пробел после названия — только если за курсором его ещё нет.
    const nextChar = query.node.nodeValue?.[query.end] ?? "";
    hide();
    editor.recordUndo();
    insertAtSelection(el, `${targetHtml(t, null, editor.ctx)}${/\s/.test(nextChar) ? "" : " "}`);
    editor.changed();
  }

  function paint() {
    list.innerHTML = "";
    items.forEach((t, i) => {
      const item = itemEl(t, i === active);
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        choose(t);
      });
      list.appendChild(item);
    });
  }

  function update() {
    query = currentQuery();
    if (!query) return hide();
    items = rankTargets(linkTargets(getSources()), query.text, 8);
    if (!items.length) return hide();
    active = 0;
    paint();
    const r = document.createRange();
    r.setStart(query.node, query.start);
    r.setEnd(query.node, query.end);
    const rect = r.getBoundingClientRect();
    list.style.position = "fixed";
    list.style.left = `${Math.min(rect.left, window.innerWidth - 260)}px`;
    list.style.top = `${rect.bottom + 4}px`;
    list.style.bottom = "auto";
    list.style.display = "block";
  }

  el.addEventListener("input", update);
  el.addEventListener("keydown", (e) => {
    if (list.style.display === "none") return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      paint();
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      choose(items[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      hide();
    }
  });
  el.addEventListener("blur", () => setTimeout(hide, 150));
  return { hide, destroy: () => list.remove() };
}

// ── «Сделать ссылкой…» (правая кнопка на выделенном слове) ──
// Поиск по персонажам, местам и фракциям; сверху — похожие на выделенное
// слово с учётом падежа. Выбор — выделенное слово становится ссылкой и
// остаётся в тексте как было («в Ивняке» → ссылка на «Ивняк»).
export function buildLinkPicker({ selected, sources, onPick }) {
  const wrap = document.createElement("div");
  wrap.className = "re-link-picker";
  const input = document.createElement("input");
  input.className = "re-mp-input";
  input.type = "text";
  input.placeholder = i18n("Персонаж, место или фракция");
  input.setAttribute("aria-label", i18n("Сделать ссылкой на…"));
  const list = document.createElement("div");
  list.className = "re-link-list";
  list.setAttribute("role", "listbox");
  const hint = document.createElement("div");
  hint.className = "re-mp-role";
  hint.textContent = i18n("«{word}» станет ссылкой", { word: selected });
  wrap.append(hint, input, list);

  const all = linkTargets(sources);
  let items = [];
  let active = 0;
  function paint() {
    list.innerHTML = "";
    items.forEach((t, i) => {
      const item = itemEl(t, i === active);
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        onPick(t);
      });
      list.appendChild(item);
    });
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "re-mp-role";
      empty.textContent = i18n("Ничего не найдено");
      list.appendChild(empty);
    }
  }
  function update() {
    const q = input.value.trim();
    // Пустой поиск — по выделенному слову (похожие сверху), а если похожих
    // нет — просто всё по алфавиту.
    items = q ? rankTargets(all, q, 30) : rankTargets(all, selected, 30);
    if (!q && !items.length) items = [...all].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 30);
    active = 0;
    paint();
  }
  input.addEventListener("input", update);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!items.length) return;
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      paint();
      list.children[active]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items[active]) onPick(items[active]);
    }
  });
  update();
  return wrap;
}

// ── Окошко ссылки (щелчок по цветному слову) ──
// Как назвать в тексте (падеж), готовые формы, открыть, убрать ссылку —
// одинаково для персонажей, мест и фракций.
export function buildMentionPanel(span, { title, subtitle, color, forms, openLabel, onChange, onOpen, onClose, onBeforeChange }) {
  const wrap = document.createElement("div");
  wrap.className = "re-mention-panel";
  wrap.innerHTML = `
    <div class="re-mp-head"><span class="re-mp-av"></span><div><div class="re-mp-name"></div><div class="re-mp-role"></div></div></div>
    <label class="re-mp-row"><span class="re-mp-k"></span><input class="re-mp-input" type="text"></label>
    <div class="re-mp-forms" role="group"></div>
    <div class="re-mp-actions"><button class="btn re-mp-open"></button><button class="btn re-mp-unlink"></button></div>`;
  const av = wrap.querySelector(".re-mp-av");
  av.style.background = color || "#7c7157";
  av.textContent = (title || "?").trim().slice(0, 1).toUpperCase();
  wrap.querySelector(".re-mp-name").textContent = title || "";
  wrap.querySelector(".re-mp-role").textContent = subtitle || "";
  wrap.querySelector(".re-mp-k").textContent = i18n("В тексте");
  wrap.querySelector(".re-mp-open").textContent = openLabel || i18n("Открыть досье");
  wrap.querySelector(".re-mp-unlink").textContent = i18n("Убрать ссылку");
  if (!onOpen) wrap.querySelector(".re-mp-open").remove();
  const input = wrap.querySelector(".re-mp-input");
  input.value = span.textContent;
  input.setAttribute("aria-label", i18n("В тексте"));
  const formsEl = wrap.querySelector(".re-mp-forms");

  let recorded = false;
  const before = () => {
    if (!recorded) onBeforeChange?.();
    recorded = true;
  };
  const setForm = (form) => {
    before();
    const value = form.trim() || span.dataset.name || span.dataset.form || "?";
    span.textContent = value;
    span.dataset.form = value;
    if (span.dataset.name && value !== span.dataset.name) delete span.dataset.plain;
    paintForms();
    onChange?.();
  };
  function paintForms() {
    formsEl.innerHTML = "";
    for (const f of forms) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "re-mp-form" + (f === span.textContent ? " on" : "");
      b.textContent = f;
      b.setAttribute("aria-pressed", f === span.textContent ? "true" : "false");
      b.addEventListener("click", () => {
        input.value = f;
        setForm(f);
      });
      formsEl.appendChild(b);
    }
  }
  paintForms();
  input.addEventListener("input", () => setForm(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onClose?.();
    }
  });
  wrap.querySelector(".re-mp-open")?.addEventListener("click", () => onOpen?.());
  wrap.querySelector(".re-mp-unlink").addEventListener("click", () => {
    before();
    span.replaceWith(document.createTextNode(span.textContent));
    onChange?.();
    onClose?.();
  });
  return wrap;
}
