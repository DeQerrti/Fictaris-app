import { apiGet, apiPost, uid } from "./api.js";
import { debounceSave } from "./save-badge.js";
import { escapeHtml, buildEmptyState } from "./chips.js";
import { iconSvg } from "./icons.js";
import { openPopover, closeMenu } from "./context-menu.js";
import { findMentionedIds } from "./mentions.js";
import { toReaderText, linkedEntityIds } from "./text-format.js";
import { loadEntries, entryViews } from "./sections.js";
import { readPref, writePref } from "./entity-view.js";
import { i18n, i18nPlural } from "./i18n.js";

// ══════════════════════════════════════════════
//  СЮЖЕТНЫЕ ЛИНИИ
//
//  Сетка: строки — линии (персонаж, фракция, запись своего раздела или
//  своя тема), столбцы — главы книги по порядку, сверху части. В клетке
//  — что в этой линии происходит в главе. Линия персонажа заполняется
//  сама: где он есть в главе (в списке главы или упомянут), там клетка
//  с фразой о нём из текста; своя запись в клетке её заменяет. Пустая
//  клетка — линия пропадает: видно провалы.
//
//  Сверху можно положить шаблон структуры (три акта, «Спасти котика»,
//  путь героя, семь точек) — такты по доле глав книги.
//
//  Данные — plotlines.json: { lines: [{ id, name, color, kind, refId,
//  cells: { [id главы]: текст } }], structure }. kind — "character" |
//  "faction" | "entry" | "custom", refId — id персонажа, фракции, записи.
// ══════════════════════════════════════════════

const COLORS = ["#c9944a", "#4f7d74", "#6a8fae", "#a4483c", "#7d6a9e", "#9a9250", "#b5636b", "#5a8a5f"];

function structures() {
  return {
    three: { name: i18n("Три акта"), beats: [[i18n("Завязка"), 0], [i18n("Поворот 1"), 0.25], [i18n("Середина"), 0.5], [i18n("Поворот 2"), 0.75], [i18n("Развязка"), 0.95]] },
    stc: {
      name: i18n("Спасти котика"),
      beats: [[i18n("Открывающий образ"), 0], [i18n("Катализатор"), 0.1], [i18n("Сомнения"), 0.15], [i18n("Второй акт"), 0.2], [i18n("Вторая линия"), 0.22], [i18n("Весёлые игры"), 0.3],
        [i18n("Середина"), 0.5], [i18n("Враги наступают"), 0.6], [i18n("Всё потеряно"), 0.75], [i18n("Тёмная ночь"), 0.8], [i18n("Третий акт"), 0.85], [i18n("Финал"), 0.9], [i18n("Финальный образ"), 1]],
    },
    hero: {
      name: i18n("Путь героя"),
      beats: [[i18n("Обычный мир"), 0], [i18n("Зов"), 0.08], [i18n("Отказ"), 0.12], [i18n("Наставник"), 0.18], [i18n("Порог"), 0.25], [i18n("Испытания"), 0.35],
        [i18n("Приближение"), 0.45], [i18n("Испытание"), 0.5], [i18n("Награда"), 0.6], [i18n("Путь назад"), 0.75], [i18n("Воскресение"), 0.9], [i18n("Возвращение"), 1]],
    },
    seven: { name: i18n("Семь точек"), beats: [[i18n("Крючок"), 0], [i18n("Поворот 1"), 0.2], [i18n("Нажим 1"), 0.35], [i18n("Середина"), 0.5], [i18n("Нажим 2"), 0.65], [i18n("Поворот 2"), 0.8], [i18n("Развязка"), 1]] },
  };
}

let data = { lines: [] };
let manuscript = { chapters: [] };
let characters = [];
let factions = [];
let entries = [];
let container = null;
let bookId = null;
const save = debounceSave((value) => apiPost("/api/plotlines", value));
const persist = () => save(data);

export async function renderPlotlines(root) {
  container = root;
  const [pl, ms, chars, facs, own] = await Promise.all([
    apiGet("/api/plotlines").catch(() => ({ lines: [] })),
    apiGet("/api/manuscript"),
    apiGet("/api/characters"),
    apiGet("/api/factions").catch(() => []),
    loadEntries(),
  ]);
  data = { ...pl, lines: Array.isArray(pl?.lines) ? pl.lines : [] };
  manuscript = ms;
  characters = chars;
  factions = facs;
  entries = entryViews(own);
  const books = booksOf();
  const saved = readPref("fictaris_plotlines_book", books.map((b) => b.id), null);
  bookId = saved || (books.some((b) => b.id === manuscript.activeBookId) ? manuscript.activeBookId : books[0]?.id);
  draw();
}

function booksOf() {
  return Array.isArray(manuscript.books) && manuscript.books.length ? manuscript.books : [{ id: null, title: i18n("Книга") }];
}

function chaptersOfBook() {
  const first = booksOf()[0].id;
  return (manuscript.chapters || []).filter((c) => bookId === null || (c.bookId || first) === bookId);
}

function partOf(ch) {
  const folders = manuscript.folders || [];
  let f = folders.find((x) => x.id === ch.folderId);
  while (f && f.parentId) f = folders.find((x) => x.id === f.parentId);
  return f || null;
}

const charById = (id) => characters.find((c) => c.id === id);

// Кто в главе: список главы и упоминания в тексте.
const presentCache = new Map();
function presentIn(ch) {
  if (!presentCache.has(ch)) {
    const ids = new Set(ch.characterIds || []);
    for (const id of findMentionedIds(ch.content || "", characters)) ids.add(id);
    presentCache.set(ch, ids);
  }
  return presentCache.get(ch);
}

function sentences(ch) {
  return toReaderText(ch.content || "").replace(/\*\*|~~|==|<\/?u>|\*/g, "").split(/(?<=[.!?…])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

function clip(s, n = 90) {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

// Само собой: есть ли линия в главе и какую фразу показать.
function autoCell(line, ch) {
  if (line.kind === "character") {
    const c = charById(line.refId);
    if (!c || !presentIn(ch).has(c.id)) return null;
    const stem = (c.name || "").split(/\s+/)[0].slice(0, Math.max(3, (c.name || "").split(/\s+/)[0].length - 1));
    const s = stem && sentences(ch).find((x) => x.includes(stem));
    return s ? clip(s) : ch.synopsis ? clip(ch.synopsis) : i18n("есть в главе");
  }
  if (line.kind === "faction") {
    const f = factions.find((x) => x.id === line.refId);
    if (!f) return null;
    const members = new Set([f.leaderId, ...(f.memberIds || [])].filter(Boolean));
    const here = [...presentIn(ch)].filter((id) => members.has(id)).map((id) => charById(id)?.name?.split(/\s+/)[0]).filter(Boolean);
    const linked = linkedEntityIds(ch.content, "faction").has(f.id);
    if (!here.length && !linked) return null;
    return here.length ? here.join(", ") : i18n("упомянута в тексте");
  }
  if (line.kind === "entry") {
    return linkedEntityIds(ch.content, "entry").has(line.refId) ? i18n("упомянута в тексте") : null;
  }
  return null;
}

function lineTitle(line) {
  if (line.name) return line.name;
  if (line.kind === "character") return charById(line.refId)?.name || i18n("Удалено из мира");
  if (line.kind === "faction") return factions.find((f) => f.id === line.refId)?.name || i18n("Удалено из мира");
  if (line.kind === "entry") return entries.find((e) => e.id === line.refId)?.name || i18n("Удалено из мира");
  return i18n("Без названия");
}

function chapterShort(ch, i) {
  const m = /^(Глава|Chapter)\s+(\d+)/i.exec(ch.title || "");
  return m ? `${i18n("Гл.")} ${m[2]}` : (ch.title || "").split(/[.:]/)[0] || String(i + 1);
}

function chapterRest(ch) {
  const m = /^(?:Глава|Chapter)\s+\d+[.:]?\s*(.*)$/i.exec(ch.title || "");
  return m ? m[1] : (ch.title || "").split(/[.:]/).slice(1).join(".").trim();
}

// ── Отрисовка ──
function draw() {
  presentCache.clear();
  container.innerHTML = "";
  const pane = document.createElement("div");
  pane.className = "characters-pane pl-pane";
  pane.appendChild(buildToolbar());
  const body = document.createElement("div");
  body.className = "pl-body";
  const chs = chaptersOfBook();
  if (!chs.length) body.appendChild(buildEmptyState(i18n("В этой книге пока нет глав."), "route"));
  else if (!data.lines.length) {
    const empty = buildEmptyState(i18n("Линий пока нет. Добавьте персонажа – его линия заполнится сама по главам, где он есть."), "route");
    body.appendChild(empty);
  } else body.appendChild(buildGrid(chs));
  pane.appendChild(body);
  container.appendChild(pane);
}

function buildToolbar() {
  const bar = document.createElement("div");
  bar.className = "timeline-toolbar";
  bar.innerHTML = `<div class="timeline-heading"></div><div class="timeline-meta"></div>`;
  bar.querySelector(".timeline-heading").textContent = i18n("Сюжетные линии");
  bar.querySelector(".timeline-meta").textContent = data.lines.length ? i18nPlural(data.lines.length, ["{n} линия", "{n} линии", "{n} линий"]) : "";

  const books = booksOf();
  if (books.length > 1) {
    const sel = document.createElement("select");
    sel.className = "kin-kind-select";
    for (const b of books) {
      const o = document.createElement("option");
      o.value = b.id;
      o.textContent = b.title || i18n("Без названия");
      if (b.id === bookId) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => {
      bookId = sel.value;
      writePref("fictaris_plotlines_book", bookId);
      draw();
    });
    bar.appendChild(sel);
  }

  const st = document.createElement("select");
  st.className = "kin-kind-select";
  st.title = i18n("Шаблон структуры – такты над главами");
  const all = structures();
  st.innerHTML = `<option value="">${escapeHtml(i18n("Без структуры"))}</option>${Object.entries(all).map(([k, v]) => `<option value="${k}"${data.structure === k ? " selected" : ""}>${escapeHtml(v.name)}</option>`).join("")}`;
  st.addEventListener("change", () => {
    if (st.value) data.structure = st.value;
    else delete data.structure;
    persist();
    draw();
  });
  const spacer = document.createElement("div");
  spacer.style.flex = "1";
  const add = document.createElement("button");
  add.className = "btn characters-add-btn";
  add.textContent = i18n("+ Линия");
  add.addEventListener("click", () => openAddMenu(add));
  bar.append(st, spacer, add);
  return bar;
}

function openAddMenu(anchor) {
  const box = document.createElement("div");
  box.className = "pl-add";
  const used = new Set(data.lines.map((l) => `${l.kind}:${l.refId}`));
  const group = (title, items, kind) => {
    const free = items.filter((x) => x.name && !used.has(`${kind}:${x.id}`));
    if (!free.length) return;
    const sel = document.createElement("select");
    sel.className = "kin-kind-select";
    sel.innerHTML = `<option value="">${escapeHtml(title)}</option>${free.map((x) => `<option value="${escapeHtml(x.id)}">${escapeHtml(x.name)}</option>`).join("")}`;
    sel.addEventListener("change", () => {
      if (!sel.value) return;
      const ref = free.find((x) => x.id === sel.value);
      addLine({ kind, refId: ref.id, color: /^#[0-9a-f]{6}$/i.test(ref.color || "") ? ref.color : ref._sec?.color });
    });
    box.appendChild(sel);
  };
  group(i18n("Персонаж…"), characters, "character");
  group(i18n("Фракция…"), factions, "faction");
  group(i18n("Запись своего раздела…"), entries, "entry");
  const own = document.createElement("button");
  own.className = "btn";
  own.textContent = i18n("Своя линия – тема, загадка, любовная история…");
  own.addEventListener("click", () => {
    closeMenu();
    addLine({ kind: "custom", name: i18n("Новая линия") }, true);
  });
  box.appendChild(own);
  const r = anchor.getBoundingClientRect();
  openPopover(r.right - 300, r.bottom + 6, box, "pl-add-pop");
}

function addLine(fields, rename = false) {
  closeMenu();
  const line = { id: uid(), color: COLORS[data.lines.length % COLORS.length], cells: {}, ...fields };
  if (!line.color) line.color = COLORS[data.lines.length % COLORS.length];
  data.lines.push(line);
  persist();
  draw();
  if (rename) renameInline(line);
}

function buildGrid(chs) {
  const wrap = document.createElement("div");
  wrap.className = "pl-scroll";
  const grid = document.createElement("div");
  grid.className = "pl-grid";
  grid.style.gridTemplateColumns = `180px repeat(${chs.length}, 168px)`;

  // Части
  let row = 1;
  const parts = [];
  chs.forEach((ch, i) => {
    const p = partOf(ch);
    const last = parts[parts.length - 1];
    if (last && last.p === p) last.n++;
    else parts.push({ p, start: i, n: 1 });
  });
  if (parts.some((x) => x.p)) {
    for (const x of parts) {
      const el = document.createElement("div");
      el.className = "pl-part";
      el.style.gridRow = row;
      el.style.gridColumn = `${x.start + 2} / span ${x.n}`;
      el.textContent = x.p?.name || i18n("Вне частей");
      grid.appendChild(el);
    }
    row++;
  }
  // Такты структуры
  const st = structures()[data.structure];
  if (st) {
    const band = document.createElement("div");
    band.className = "pl-beats";
    band.style.gridRow = row;
    band.style.gridColumn = `2 / span ${chs.length}`;
    for (const [name, at] of st.beats) {
      const b = document.createElement("span");
      b.className = "pl-beat";
      b.style.left = `${Math.min(97, Math.max(3, at * 100))}%`;
      b.textContent = name;
      band.appendChild(b);
    }
    grid.appendChild(band);
    row++;
  }
  // Главы
  chs.forEach((ch, i) => {
    const h = document.createElement("button");
    h.className = "pl-colh";
    h.style.gridRow = row;
    h.style.gridColumn = i + 2;
    h.innerHTML = `<b></b><span></span>`;
    h.querySelector("b").textContent = chapterShort(ch, i);
    h.querySelector("span").textContent = chapterRest(ch);
    h.title = i18n("Открыть главу");
    h.addEventListener("click", () => document.dispatchEvent(new CustomEvent("fictaris:open-chapter", { detail: { id: ch.id } })));
    grid.appendChild(h);
  });
  row++;
  // Линии
  data.lines.forEach((line, li) => {
    const r = row + li;
    grid.appendChild(buildRowHead(line, r, li));
    chs.forEach((ch, ci) => grid.appendChild(buildCell(line, ch, r, ci + 2)));
  });
  wrap.appendChild(grid);
  return wrap;
}

function buildRowHead(line, r, index) {
  const head = document.createElement("div");
  head.className = "pl-rowh";
  head.dataset.line = line.id;
  head.style.gridRow = r;
  head.style.setProperty("--line-color", line.color || COLORS[0]);
  head.innerHTML = `<span class="pl-dot"></span><button class="pl-rowname"></button><button class="pl-rowmenu" aria-label="${escapeHtml(i18n("Линия: цвет, порядок, удалить"))}">${iconSvg("more", 13)}</button>`;
  const name = head.querySelector(".pl-rowname");
  name.textContent = lineTitle(line);
  name.title = line.kind === "custom" ? i18n("Переименовать") : i18n("Открыть");
  name.addEventListener("click", () => {
    if (line.kind === "character") return document.dispatchEvent(new CustomEvent("fictaris:open-entity", { detail: { type: "character", id: line.refId } }));
    if (line.kind === "faction") return document.dispatchEvent(new CustomEvent("fictaris:open-entity", { detail: { type: "faction", id: line.refId } }));
    if (line.kind === "entry") return document.dispatchEvent(new CustomEvent("fictaris:open-entity", { detail: { type: "entry", id: line.refId } }));
    renameInline(line);
  });
  head.querySelector(".pl-rowmenu").addEventListener("click", (e) => openLineMenu(e.currentTarget, line, index));
  return head;
}

// Название линии — на месте, полем ввода. У линии персонажа пустое
// название возвращает его имя.
function renameInline(line) {
  const name = container.querySelector(`[data-line="${line.id}"] .pl-rowname`);
  if (!name) return;
  const input = document.createElement("input");
  input.className = "pl-rename";
  input.value = lineTitle(line);
  name.replaceWith(input);
  input.focus();
  input.select();
  let cancelled = false;
  input.addEventListener("blur", () => {
    if (!cancelled) {
      const text = input.value.trim();
      if (text) line.name = text;
      else if (line.kind === "custom") line.name = i18n("Без названия");
      else delete line.name;
      persist();
    }
    draw();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") { cancelled = true; input.blur(); }
  });
}

function openLineMenu(anchor, line, index) {
  const box = document.createElement("div");
  box.className = "pl-line-menu";
  const colors = document.createElement("div");
  colors.className = "sec-new-colors";
  for (const c of COLORS) {
    const b = document.createElement("button");
    b.className = "sec-new-color" + (c === line.color ? " on" : "");
    b.style.background = c;
    b.addEventListener("click", () => { line.color = c; persist(); closeMenu(); draw(); });
    colors.appendChild(b);
  }
  box.appendChild(colors);
  const act = (label, fn, cls = "") => {
    const b = document.createElement("button");
    b.className = `context-menu-item ${cls}`;
    b.textContent = label;
    b.addEventListener("click", () => { closeMenu(); fn(); });
    box.appendChild(b);
  };
  if (index > 0) act(i18n("Выше"), () => move(index, -1));
  if (index < data.lines.length - 1) act(i18n("Ниже"), () => move(index, 1));
  act(i18n("Переименовать линию"), () => renameInline(line));
  act(i18n("Удалить линию"), () => {
    data.lines = data.lines.filter((l) => l !== line);
    persist();
    draw();
  }, "danger");
  const r = anchor.getBoundingClientRect();
  openPopover(r.left, r.bottom + 4, box, "pl-line-pop");
}

function move(index, delta) {
  const [line] = data.lines.splice(index, 1);
  data.lines.splice(index + delta, 0, line);
  persist();
  draw();
}

function buildCell(line, ch, r, c) {
  const own = line.cells?.[ch.id];
  const auto = own ? null : autoCell(line, ch);
  const cell = document.createElement("div");
  cell.style.gridRow = r;
  cell.style.gridColumn = c;
  cell.style.setProperty("--line-color", line.color || COLORS[0]);
  cell.tabIndex = 0;
  if (own || auto) {
    cell.className = "pl-cell" + (own ? "" : " auto");
    cell.textContent = own || auto;
    cell.title = own ? i18n("Щёлкните, чтобы изменить. Перетащите в другую главу") : i18n("Из текста главы – щёлкните, чтобы написать своё");
  } else {
    cell.className = "pl-empty";
    cell.title = i18n("Пусто – щёлкните, чтобы записать, что здесь происходит в этой линии");
  }
  if (own) {
    cell.draggable = true;
    cell.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/x-plotline-cell", JSON.stringify({ line: line.id, from: ch.id }));
      e.dataTransfer.effectAllowed = "move";
    });
  }
  cell.addEventListener("dragover", (e) => {
    if (e.dataTransfer.types.includes("text/x-plotline-cell")) {
      e.preventDefault();
      cell.classList.add("drop");
    }
  });
  cell.addEventListener("dragleave", () => cell.classList.remove("drop"));
  cell.addEventListener("drop", (e) => {
    e.preventDefault();
    const src = JSON.parse(e.dataTransfer.getData("text/x-plotline-cell") || "{}");
    if (src.line !== line.id || src.from === ch.id) return draw();
    const text = line.cells[src.from];
    const other = line.cells[ch.id];
    line.cells[ch.id] = text;
    if (other) line.cells[src.from] = other;
    else delete line.cells[src.from];
    persist();
    draw();
  });
  const edit = () => {
    const ta = document.createElement("textarea");
    ta.className = "pl-edit";
    ta.style.gridRow = r;
    ta.style.gridColumn = c;
    ta.style.setProperty("--line-color", line.color || COLORS[0]);
    ta.value = own || "";
    ta.placeholder = auto || i18n("Что происходит в этой линии в главе");
    cell.replaceWith(ta);
    ta.focus();
    let cancelled = false;
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { cancelled = true; ta.blur(); }
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ta.blur(); }
    });
    ta.addEventListener("blur", () => {
      if (!cancelled) {
        line.cells = line.cells || {};
        const text = ta.value.trim();
        if (text) line.cells[ch.id] = text;
        else delete line.cells[ch.id];
        persist();
      }
      draw();
    });
  };
  cell.addEventListener("click", edit);
  cell.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); edit(); } });
  return cell;
}
