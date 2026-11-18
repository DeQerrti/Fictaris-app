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
import { applyInlineMarkupHtml } from "./text-format.js";
import { buildMentionRegex } from "./mentions.js";
import { iconSvg } from "./icons.js";
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
  s = s.replace(/\[\[note:([\w-]+)\]\]/g, (m, id) => put(stickyHtml(id)));
  let html = applyInlineMarkupHtml(escapeHtml(s));
  html = html.replace(/[-]/g, (ch) => tokens[ch.charCodeAt(0) - PH_BASE] ?? "");
  return html;
}

export function mentionHtml(char, form, plain) {
  const color = safeColor(char.color, "var(--accent)");
  return `<span class="mention re-mention" contenteditable="false" data-char-id="${escapeHtml(char.id)}" data-name="${escapeHtml(char.name)}" data-form="${escapeHtml(form)}"${plain ? ' data-plain="1"' : ""} style="color:${color}">${escapeHtml(form)}</span>`;
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
    if (st.backgroundColor && !el.classList.contains("re-mention")) kinds.push("highlight");
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
  const ctx = { characters: opts.characters || [], mentionRe: buildMentionRegex(opts.characters || []) };
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
    document.execCommand("insertText", false, text.replace(/\r\n?/g, "\n"));
  });
  el.addEventListener("drop", (e) => {
    const text = e.dataTransfer?.getData("text/plain");
    if (!text) return;
    e.preventDefault();
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
    const m = e.target.closest?.(".re-mention");
    if (m && el.contains(m)) {
      e.preventDefault();
      opts.onMentionClick?.(m);
    }
  });

  function format(kind) {
    el.focus();
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
      document.execCommand("insertText", false, text);
      changed();
    },
    insertSticky(id) {
      insertHtml(stickyHtml(id));
    },
    insertMention(char, form, plain = true) {
      insertHtml(`${mentionHtml(char, form, plain)} `);
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
    setCharacters(list) {
      ctx.characters = list;
      ctx.mentionRe = buildMentionRegex(list);
    },
  };
}

// ── «@» — подсказка персонажей у курсора ──
// Набрал «@» и начало имени — список рядом с курсором; стрелки, Enter или
// Tab — вставить цветное упоминание, Esc — закрыть. Работает и по
// второму слову имени («@Вир» найдёт «Астра Вирен»).
export function attachRichAutocomplete(editor, getCharacters) {
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

  function choose(char) {
    if (!query || !char) return hide();
    const r = document.createRange();
    r.setStart(query.node, query.start);
    r.setEnd(query.node, query.end);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    // Пробел после имени — только если за курсором его ещё нет.
    const nextChar = query.node.nodeValue?.[query.end] ?? "";
    hide();
    insertAtSelection(el, `${mentionHtml(char, char.name, true)}${/\s/.test(nextChar) ? "" : "\u00a0"}`);
    editor.changed();
  }

  function paint() {
    list.innerHTML = "";
    items.forEach((c, i) => {
      const item = document.createElement("div");
      item.className = "mention-autocomplete-item" + (i === active ? " active" : "");
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", i === active ? "true" : "false");
      item.style.setProperty("--chip-color", safeColor(c.color, "#7c7157"));
      item.textContent = c.name;
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        choose(c);
      });
      list.appendChild(item);
    });
  }

  function update() {
    query = currentQuery();
    if (!query) return hide();
    const q = query.text.trim().toLowerCase();
    items = getCharacters()
      .filter((c) => c.name && (!q || c.name.toLowerCase().startsWith(q) || c.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q))))
      .slice(0, 8);
    if (!items.length) return hide();
    active = 0;
    paint();
    const r = document.createRange();
    r.setStart(query.node, query.start);
    r.setEnd(query.node, query.end);
    const rect = r.getBoundingClientRect();
    list.style.position = "fixed";
    list.style.left = `${Math.min(rect.left, window.innerWidth - 240)}px`;
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

// ── Окошко упоминания ──
// Щелчок по цветному имени: как назвать в тексте (падеж), готовые формы,
// открыть досье, убрать ссылку. forms — формы этого имени, уже
// встречавшиеся в рукописи, плюс само имя и его первое слово.
export function buildMentionPanel(span, { character, forms, onChange, onOpen, onClose }) {
  const wrap = document.createElement("div");
  wrap.className = "re-mention-panel";
  const color = safeColor(character?.color, "#7c7157");
  const initial = (character?.name || "?").trim().slice(0, 1).toUpperCase();
  wrap.innerHTML = `
    <div class="re-mp-head"><span class="re-mp-av" style="background:${color}"></span><div><div class="re-mp-name"></div><div class="re-mp-role"></div></div></div>
    <label class="re-mp-row"><span class="re-mp-k"></span><input class="re-mp-input" type="text"></label>
    <div class="re-mp-forms" role="group"></div>
    <div class="re-mp-actions"><button class="btn re-mp-open"></button><button class="btn re-mp-unlink"></button></div>`;
  wrap.querySelector(".re-mp-av").textContent = initial;
  wrap.querySelector(".re-mp-name").textContent = character?.name || span.dataset.name;
  wrap.querySelector(".re-mp-role").textContent = character?.role || "";
  const t = i18n;
  wrap.querySelector(".re-mp-k").textContent = t("В тексте");
  wrap.querySelector(".re-mp-open").textContent = t("Открыть досье");
  wrap.querySelector(".re-mp-unlink").textContent = t("Убрать ссылку");
  const input = wrap.querySelector(".re-mp-input");
  input.value = span.textContent;
  input.setAttribute("aria-label", t("В тексте"));
  const formsEl = wrap.querySelector(".re-mp-forms");

  const setForm = (form) => {
    const value = form.trim() || span.dataset.name;
    span.textContent = value;
    span.dataset.form = value;
    if (value !== span.dataset.name) delete span.dataset.plain;
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
  wrap.querySelector(".re-mp-open").addEventListener("click", () => onOpen?.());
  wrap.querySelector(".re-mp-unlink").addEventListener("click", () => {
    span.replaceWith(document.createTextNode(span.textContent));
    onChange?.();
    onClose?.();
  });
  return wrap;
}
