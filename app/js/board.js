import { apiGet, apiPost, uid } from "./api.js";
import { debounceSave } from "./save-badge.js";
import { pushTrash } from "./trash.js";
import { buildExportPngButton } from "./png-export.js";
import { openContextMenu, openPopover, closeMenu } from "./context-menu.js";
import { escapeHtml, buildToggleGroup } from "./chips.js";
import { iconSvg, locationTypeInfo } from "./icons.js";
import { i18n, i18nPlural } from "./i18n.js";
import { avatarInnerHtml } from "./avatars.js";
import { chapterLabel } from "./books.js";
import { migrateBoards, cardCharacterIds } from "./board-data.js";

const LABEL_COLORS = [
  "#c9944a", "#4f7d74", "#a4483c", "#7d6a9e",
  "#6a8fae", "#9a9250", "#b5636b", "#5a8a5f",
];

// Несколько досок в одном хранилище (например, отдельные книги в одном
// мире) — data.boards держит их все, board всегда указывает на
// активную (data.boards.find по data.activeBoardId). Весь остальной
// код файла как читал/писал board.columns/board.cards/board.cardOrder
// напрямую, так и продолжает — переключение досок только переставляет,
// на что указывает board, и меняет data.activeBoardId.
let data = { boards: [], activeBoardId: null };
let board = null;
let characters = [];
let factions = [];
let locations = [];
let chapters = [];
let books = []; // manuscript.books — ради подписи книги у главы (chapterLabel)
let container = null;
const save = debounceSave((d) => apiPost("/api/board", d));

function persist() {
  save(data);
}

function columnsFromTitles(titles) {
  const cols = titles.map((title) => ({ id: uid(), title }));
  const cardOrder = {};
  for (const c of cols) cardOrder[c.id] = [];
  return { columns: cols, cards: {}, cardOrder };
}

function defaultColumns() {
  return columnsFromTitles([i18n("Задумано"), i18n("В работе"), i18n("Готово")]);
}

function addBoard() {
  const b = { id: uid(), name: i18n("Новая доска"), ...defaultColumns() };
  data.boards.push(b);
  data.activeBoardId = b.id;
  board = b;
  persist();
  draw();
}

function switchBoard(id) {
  const b = data.boards.find((x) => x.id === id);
  if (!b) return;
  data.activeBoardId = id;
  board = b;
  persist();
  draw();
}

function deleteBoardById(id) {
  if (data.boards.length <= 1) return;
  const wasActive = board.id === id;
  data.boards = data.boards.filter((b) => b.id !== id);
  if (wasActive) switchBoard(data.boards[0].id);
  else { persist(); draw(); }
}

// Список досок с переименованием и удалением — карандаш/крестик не
// отдельными вечно видимыми кнопками рядом с переключателем (это и
// была вечно занимающая место двойная кнопка "Доска 1"/поле имени), а
// внутри самого выпадающего списка, у каждой строки — тем же приёмом,
// что и переключатель проектов (project-switcher.js, project-row):
// имя переключает доску по клику, две мелкие иконки рядом — правят её,
// не мешая друг другу (stopPropagation).
function buildBoardSwitchList() {
  const wrap = document.createElement("div");
  wrap.className = "board-switch-list";

  for (const b of data.boards) {
    const row = document.createElement("div");
    row.className = "board-switch-row" + (b.id === board.id ? " active" : "");

    const nameBtn = document.createElement("button");
    nameBtn.className = "board-switch-name";
    nameBtn.textContent = b.name;
    nameBtn.addEventListener("click", () => {
      closeMenu();
      switchBoard(b.id);
    });
    row.appendChild(nameBtn);

    const renameBtn = document.createElement("button");
    renameBtn.className = "board-switch-action";
    renameBtn.innerHTML = iconSvg("pencil", 13);
    renameBtn.title = i18n("Переименовать доску");
    renameBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const input = document.createElement("input");
      input.className = "board-switch-input";
      input.value = b.name;
      nameBtn.replaceWith(input);
      input.focus();
      input.select();
      const commit = () => {
        b.name = input.value.trim() || b.name;
        persist();
        closeMenu();
        draw();
      };
      input.addEventListener("click", (e2) => e2.stopPropagation());
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", (e2) => {
        if (e2.key === "Enter") input.blur();
        else if (e2.key === "Escape") { input.value = b.name; input.blur(); }
      });
    });
    row.appendChild(renameBtn);

    if (data.boards.length > 1) {
      const delBtn = document.createElement("button");
      delBtn.className = "board-switch-action";
      delBtn.innerHTML = iconSvg("close", 13);
      delBtn.title = i18n("Удалить эту доску навсегда");
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (delBtn.dataset.confirm === "1") {
          closeMenu();
          deleteBoardById(b.id);
          return;
        }
        delBtn.dataset.confirm = "1";
        delBtn.title = i18n("Точно?");
        setTimeout(() => {
          delBtn.dataset.confirm = "";
          delBtn.title = i18n("Удалить эту доску навсегда");
        }, 3000);
      });
      row.appendChild(delBtn);
    }

    wrap.appendChild(row);
  }

  const divider = document.createElement("div");
  divider.className = "board-switch-divider";
  wrap.appendChild(divider);

  const addBtn = document.createElement("button");
  addBtn.className = "board-switch-name";
  addBtn.textContent = i18n("+ Новая доска");
  addBtn.addEventListener("click", () => {
    closeMenu();
    addBoard();
  });
  wrap.appendChild(addBtn);

  return wrap;
}

// Тип карточки — что это за запись: сцена, идея, правка… Полоса сверху
// карточки — его цвет, если не выбран свой (labelColor).
const CARD_TYPES = [
  ["scene", "Сцена", "#4f7d74"],
  ["idea", "Идея", "#7d6a9e"],
  ["edit", "Правка", "#6a8fae"],
  ["research", "Исследование", "#9a9250"],
  ["mystery", "Тайна", "#b5636b"],
];

function typeInfo(card) {
  return CARD_TYPES.find(([k]) => k === card.type) || null;
}

function stripeColor(card) {
  return card.labelColor || typeInfo(card)?.[2] || null;
}

let activeCardId = null;
const filterCharIds = new Set();
const filterTypes = new Set();

function charById(id) {
  return characters.find((c) => c.id === id);
}

function factionById(id) {
  return factions.find((f) => f.id === id);
}

function locationById(id) {
  return locations.find((l) => l.id === id);
}

function chapterById(id) {
  return chapters.find((c) => c.id === id);
}

function columnOf(cardId) {
  return board.columns.find((col) => (board.cardOrder[col.id] || []).includes(cardId)) || null;
}

function visible(card) {
  if (filterCharIds.size && !cardCharacterIds(card).some((id) => filterCharIds.has(id))) return false;
  if (filterTypes.size && !filterTypes.has(card.type || "")) return false;
  return true;
}

export async function renderBoard(root, focusId) {
  container = root;
  const [rawBoard, chars, facs, locs, manuscriptData] = await Promise.all([
    apiGet("/api/board"),
    apiGet("/api/characters"),
    apiGet("/api/factions"),
    apiGet("/api/locations"),
    apiGet("/api/manuscript"),
  ]);
  characters = chars;
  factions = facs;
  locations = locs;
  chapters = manuscriptData.chapters || [];
  books = manuscriptData.books || [];
  data = migrateBoards(rawBoard);
  // Один персонаж на карточку (characterId) → список участников
  // (characterIds): сцена почти всегда про нескольких.
  for (const b of data.boards) {
    for (const card of Object.values(b.cards || {})) {
      if (card.characterId && !card.characterIds) card.characterIds = [card.characterId];
      delete card.characterId;
    }
  }
  board = data.boards.find((b) => b.id === data.activeBoardId) || data.boards[0];
  if (!board.columns.length) {
    Object.assign(board, defaultColumns());
  }
  activeCardId = focusId && board.cards[focusId] ? focusId : null;
  persist();
  draw();
}

function draw() {
  container.innerHTML = "";
  const outer = document.createElement("div");
  outer.className = "board-outer";

  outer.appendChild(buildToolbar());

  const view = document.createElement("div");
  view.className = "board-view";
  for (const col of board.columns) view.appendChild(buildColumn(col));

  const addCol = document.createElement("button");
  addCol.className = "add-column";
  addCol.textContent = i18n("+ Колонка");
  addCol.addEventListener("click", () => {
    const col = { id: uid(), title: i18n("Новая колонка") };
    board.columns.push(col);
    board.cardOrder[col.id] = [];
    persist();
    draw();
    container.querySelector(`.board-column[data-col-id="${col.id}"] .board-column-title`)?.select();
  });
  view.appendChild(addCol);
  outer.appendChild(view);

  const active = board.cards[activeCardId];
  if (active) outer.appendChild(buildCardEditor(active));
  // Клик по затемнению вокруг окна карточки закрывает его — как у всех
  // редакторов-модалок приложения (.drawer).
  outer.addEventListener("click", (e) => {
    if (e.target === outer && activeCardId) { activeCardId = null; draw(); }
  });

  container.appendChild(outer);
}

// ── Шапка ─────────────────────────────────────

function buildToolbar() {
  const bar = document.createElement("div");
  bar.className = "timeline-toolbar";

  const title = document.createElement("div");
  title.className = "timeline-heading";
  title.textContent = i18n("Доска");

  const switchBtn = document.createElement("button");
  switchBtn.className = "btn board-switcher-current";
  switchBtn.innerHTML = `<span>${escapeHtml(board.name)}</span>${iconSvg("chevron", 12)}`;
  switchBtn.title = i18n("Переключить доску");
  switchBtn.addEventListener("click", () => {
    const r = switchBtn.getBoundingClientRect();
    openPopover(r.left, r.bottom + 4, buildBoardSwitchList(), "board-switch-popover");
  });

  const meta = document.createElement("div");
  meta.className = "timeline-meta";
  const all = Object.values(board.cards);
  const shown = all.filter(visible).length;
  meta.textContent = shown === all.length
    ? i18nPlural(all.length, ["{n} карточка", "{n} карточки", "{n} карточек"])
    : i18nPlural(all.length, ["{shown} из {total} карточки", "{shown} из {total} карточек", "{shown} из {total} карточек"], { shown }, "total");

  const spacer = document.createElement("div");
  spacer.style.flex = "1";

  const filterBtn = document.createElement("button");
  const nFilters = filterCharIds.size + filterTypes.size;
  filterBtn.className = "btn" + (nFilters ? " accent" : "");
  filterBtn.innerHTML = `${iconSvg("filter", 14)}<span>${escapeHtml(i18n("Фильтр"))}</span>${nFilters ? `<span class="timeline-filter-badge">${nFilters}</span>` : ""}`;
  filterBtn.addEventListener("click", () => {
    const r = filterBtn.getBoundingClientRect();
    openFilterPopover(r.left, r.bottom + 6);
  });

  const exportBtn = buildExportPngButton(() => container.querySelector(".board-view"), i18n("доска"));

  const addBtn = document.createElement("button");
  addBtn.className = "btn accent";
  addBtn.textContent = i18n("+ Карточка");
  addBtn.addEventListener("click", () => {
    const card = addCardTo(board.columns[0].id, i18n("Новая карточка"));
    activeCardId = card.id;
    draw();
  });

  bar.append(title, switchBtn, meta, spacer, filterBtn, exportBtn, addBtn);
  return bar;
}

function openFilterPopover(x, y) {
  const wrap = document.createElement("div");
  wrap.className = "timeline-filter-popover";
  function fill() {
    wrap.innerHTML = "";
    const section = (label, items, selected, colorOf) => {
      if (!items.length) return;
      const t = document.createElement("div");
      t.className = "timeline-filter-label";
      t.textContent = label;
      const row = document.createElement("div");
      row.className = "timeline-filter-bar";
      for (const [id, name] of items) {
        const chip = document.createElement("button");
        chip.className = "filter-chip" + (selected.has(id) ? " active" : "");
        chip.style.setProperty("--chip-color", colorOf(id));
        chip.textContent = name;
        chip.addEventListener("click", () => {
          if (selected.has(id)) selected.delete(id);
          else selected.add(id);
          fill();
          draw();
        });
        row.appendChild(chip);
      }
      wrap.append(t, row);
    };
    section(i18n("Тип"), CARD_TYPES.map(([k, l]) => [k, i18n(l)]), filterTypes, (k) => CARD_TYPES.find(([x]) => x === k)[2]);
    section(i18n("Персонажи"), characters.map((c) => [c.id, c.name || i18n("Без имени")]), filterCharIds, (id) => charById(id)?.color || "#7c7157");
    const footer = document.createElement("div");
    footer.className = "timeline-filter-footer";
    const reset = document.createElement("button");
    reset.className = "btn";
    reset.textContent = i18n("Сбросить");
    reset.disabled = !filterCharIds.size && !filterTypes.size;
    reset.addEventListener("click", () => { filterCharIds.clear(); filterTypes.clear(); fill(); draw(); });
    footer.append(document.createElement("span"), reset);
    wrap.appendChild(footer);
  }
  fill();
  openPopover(x, y, wrap, "timeline-filter-menu");
}

// ── Колонки ───────────────────────────────────

let dragCardId = null;

function addCardTo(colId, title) {
  const card = { id: uid(), title, notes: "", type: null, characterIds: [], factionId: null, locationId: null, chapterId: null, labelColor: null, checklist: [] };
  board.cards[card.id] = card;
  board.cardOrder[colId] = [...(board.cardOrder[colId] || []), card.id];
  persist();
  return card;
}

function buildColumn(col) {
  const wrap = document.createElement("div");
  wrap.className = "board-column";
  wrap.dataset.colId = col.id;
  const ids = (board.cardOrder[col.id] || []).filter((id) => board.cards[id]);

  const header = document.createElement("div");
  header.className = "board-column-header";
  const titleInput = document.createElement("input");
  titleInput.value = col.title;
  titleInput.className = "board-column-title";
  titleInput.addEventListener("input", () => { col.title = titleInput.value; persist(); });
  titleInput.addEventListener("keydown", (e) => { if (e.key === "Enter") titleInput.blur(); });
  const count = document.createElement("span");
  count.className = "board-column-count";
  count.textContent = String(ids.length);
  const delBtn = document.createElement("button");
  delBtn.className = "board-column-del";
  delBtn.innerHTML = iconSvg("close", 12);
  delBtn.title = i18n("Удалить колонку");
  delBtn.addEventListener("click", () => {
    if (delBtn.dataset.confirm === "1") {
      for (const id of board.cardOrder[col.id] || []) delete board.cards[id];
      delete board.cardOrder[col.id];
      board.columns = board.columns.filter((c) => c.id !== col.id);
      persist();
      draw();
      return;
    }
    delBtn.dataset.confirm = "1";
    delBtn.textContent = i18n("Точно?");
    setTimeout(() => {
      delBtn.dataset.confirm = "";
      delBtn.innerHTML = iconSvg("close", 12);
    }, 3000);
  });
  header.append(titleInput, count, delBtn);
  wrap.appendChild(header);

  // Быстрый ввод сверху колонки: название и Enter — карточка готова,
  // поле остаётся в фокусе для следующей.
  const quick = document.createElement("input");
  quick.className = "board-quick-add";
  quick.placeholder = i18n("+ Добавить карточку…");
  quick.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !quick.value.trim()) return;
    addCardTo(col.id, quick.value.trim());
    draw();
    container.querySelector(`.board-column[data-col-id="${col.id}"] .board-quick-add`)?.focus();
  });
  wrap.appendChild(quick);

  const list = document.createElement("div");
  list.className = "board-card-list";
  list.addEventListener("dragover", (e) => e.preventDefault());
  list.addEventListener("drop", (e) => {
    e.preventDefault();
    if (dragCardId === null) return;
    moveCard(dragCardId, col.id, board.cardOrder[col.id].length);
  });
  for (const id of ids) {
    const card = board.cards[id];
    if (visible(card)) list.appendChild(buildCard(card, col.id));
  }
  wrap.appendChild(list);
  return wrap;
}

function moveCard(cardId, targetColId, index) {
  for (const colId of Object.keys(board.cardOrder)) {
    board.cardOrder[colId] = board.cardOrder[colId].filter((id) => id !== cardId);
  }
  board.cardOrder[targetColId].splice(index, 0, cardId);
  persist();
  draw();
}

async function deleteCard(card) {
  await pushTrash("board-card", card);
  for (const colId of Object.keys(board.cardOrder)) {
    board.cardOrder[colId] = board.cardOrder[colId].filter((id) => id !== card.id);
  }
  delete board.cards[card.id];
  if (activeCardId === card.id) activeCardId = null;
  persist();
  draw();
}

// Невидимый <input type="color"> — открывает нативный выбор цвета сразу
// по клику, без своего колесика/палитры (тот же приём, что скрытый
// <input type="file"> в avatars.js).
function pickCustomColor(initialColor, onChange) {
  const input = document.createElement("input");
  input.type = "color";
  input.value = /^#[0-9a-f]{6}$/i.test(initialColor || "") ? initialColor : "#c9944a";
  input.style.position = "fixed";
  input.style.opacity = "0";
  input.style.pointerEvents = "none";
  document.body.appendChild(input);
  input.addEventListener("input", () => onChange(input.value));
  input.addEventListener("change", () => input.remove());
  input.addEventListener("blur", () => setTimeout(() => input.remove(), 0));
  input.click();
}

// Правый клик — быстрые действия без открытия окна карточки.
function cardContextItems(card) {
  const col = columnOf(card.id);
  return [
    { label: i18n("Открыть"), action: () => { activeCardId = card.id; draw(); } },
    {
      label: i18n("Тип"),
      items: [
        { label: i18n("Без типа"), checked: !card.type, action: () => { card.type = null; persist(); draw(); } },
        ...CARD_TYPES.map(([k, l, color]) => ({ label: i18n(l), swatch: color, checked: card.type === k, action: () => { card.type = k; persist(); draw(); } })),
      ],
    },
    {
      label: i18n("Переместить в колонку"),
      items: board.columns.map((c) => ({
        label: escapeHtml(c.title || i18n("Без названия")),
        checked: col?.id === c.id,
        action: () => moveCard(card.id, c.id, (board.cardOrder[c.id] || []).length),
      })),
    },
    { separator: true },
    { label: i18n("Удалить карточку"), danger: true, action: () => deleteCard(card) },
  ];
}

// ── Карточка ──────────────────────────────────
// Плашка, а не форма: тип, название, начало заметки, связи и участники;
// правка — в окне по щелчку.
function buildCard(card, colId) {
  const el = document.createElement("div");
  el.className = "board-card";
  el.draggable = true;
  const stripe = stripeColor(card);
  const type = typeInfo(card);
  const who = cardCharacterIds(card).map(charById).filter(Boolean);
  const place = locationById(card.locationId);
  const faction = factionById(card.factionId);
  const chapter = chapterById(card.chapterId);
  const checklist = card.checklist || [];
  const done = checklist.filter((i) => i.done).length;

  const chips = [];
  if (place) {
    const [, , icon, color] = locationTypeInfo(place.type);
    chips.push(`<span class="chip chip-place" style="--chip-color:${color}">${iconSvg(icon, 11)}${escapeHtml(place.name || i18n("Без имени"))}</span>`);
  }
  if (chapter) chips.push(`<span class="board-link-chip">${iconSvg("book", 11)}${escapeHtml(chapterLabel(chapter, books))}</span>`);
  if (faction) chips.push(`<span class="board-link-chip">${iconSvg("shield", 11)}${escapeHtml(faction.name || i18n("Без имени"))}</span>`);

  el.innerHTML = `
    ${stripe || type ? `<div class="board-card-head">${stripe ? `<span class="board-card-stripe" style="background:${stripe}"></span>` : ""}${type ? `<span class="board-card-type">${escapeHtml(i18n(type[1]))}</span>` : ""}</div>` : ""}
    <div class="board-card-title">${escapeHtml(card.title || i18n("Без названия"))}</div>
    ${card.notes ? `<div class="board-card-notes">${escapeHtml(card.notes)}</div>` : ""}
    ${chips.length ? `<div class="board-card-chips">${chips.join("")}</div>` : ""}
    ${who.length || checklist.length ? `<div class="board-card-foot"><span class="board-card-who">${who.map((c) => `<span class="ms-avatar" style="width:22px;height:22px;background:${c.color || "#7c7157"}" title="${escapeHtml(c.name || "")}">${avatarInnerHtml(c, `<span>${escapeHtml((c.name || "?").trim().slice(0, 1).toUpperCase())}</span>`)}</span>`).join("")}</span>${checklist.length ? `<span class="board-card-check${done === checklist.length ? " done" : ""}">${iconSvg("check", 12)} ${done}/${checklist.length}</span>` : ""}</div>` : ""}`;

  el.addEventListener("click", () => { activeCardId = card.id; draw(); });
  el.addEventListener("dragstart", () => { dragCardId = card.id; });
  el.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); });
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragCardId === null || dragCardId === card.id) return;
    moveCard(dragCardId, colId, board.cardOrder[colId].indexOf(card.id));
  });
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY, cardContextItems(card));
  });
  return el;
}

// ── Окно карточки ─────────────────────────────

function fieldWithLabel(label, control) {
  const field = document.createElement("div");
  field.className = "field";
  const l = document.createElement("label");
  l.textContent = label;
  field.append(l, control);
  return field;
}

function selectOf(list, value, emptyLabel, labelOf, onChange) {
  const select = document.createElement("select");
  const none = document.createElement("option");
  none.value = "";
  none.textContent = emptyLabel;
  select.appendChild(none);
  for (const item of list) {
    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = labelOf(item);
    opt.selected = item.id === value;
    select.appendChild(opt);
  }
  select.addEventListener("change", () => onChange(select.value || null));
  return select;
}

function buildCardEditor(card) {
  const drawer = document.createElement("div");
  drawer.className = "drawer board-card-editor";

  const titleInput = document.createElement("input");
  titleInput.className = "drawer-name-field";
  titleInput.value = card.title;
  titleInput.addEventListener("input", () => { card.title = titleInput.value; persist(); });
  drawer.appendChild(titleInput);

  const typeRow = document.createElement("div");
  typeRow.className = "timeline-filter-bar";
  for (const [k, l, color] of [["", "Без типа", "#7c7157"], ...CARD_TYPES]) {
    const chip = document.createElement("button");
    chip.className = "filter-chip" + ((card.type || "") === k ? " active" : "");
    chip.style.setProperty("--chip-color", color);
    chip.textContent = i18n(l);
    chip.addEventListener("click", () => { card.type = k || null; persist(); draw(); });
    typeRow.appendChild(chip);
  }
  drawer.appendChild(fieldWithLabel(i18n("Тип"), typeRow));

  const colRow = document.createElement("div");
  colRow.className = "board-editor-row";
  const col = columnOf(card.id);
  colRow.appendChild(fieldWithLabel(i18n("Колонка"), selectOf(board.columns, col?.id, "–", (c) => c.title || i18n("Без названия"), (id) => {
    if (id) moveCard(card.id, id, (board.cardOrder[id] || []).length);
  })));
  const colorRow = document.createElement("div");
  colorRow.className = "color-row";
  for (const color of [null, ...LABEL_COLORS]) {
    const sw = document.createElement("div");
    sw.className = "swatch" + ((card.labelColor || null) === color ? " selected" : "") + (color ? "" : " swatch-none");
    sw.style.background = color || "var(--panel-alt)";
    sw.title = color ? color : i18n("Цвет типа");
    sw.addEventListener("click", () => { card.labelColor = color; persist(); draw(); });
    colorRow.appendChild(sw);
  }
  const custom = document.createElement("div");
  custom.className = "swatch swatch-custom" + (card.labelColor && !LABEL_COLORS.includes(card.labelColor) ? " selected" : "");
  custom.style.background = card.labelColor && !LABEL_COLORS.includes(card.labelColor) ? card.labelColor : "conic-gradient(#c9944a, #4f7d74, #7d6a9e, #a4483c, #c9944a)";
  custom.title = i18n("Свой цвет…");
  custom.addEventListener("click", () => pickCustomColor(card.labelColor, (c) => { card.labelColor = c; persist(); draw(); }));
  colorRow.appendChild(custom);
  colRow.appendChild(fieldWithLabel(i18n("Цвет метки"), colorRow));
  drawer.appendChild(colRow);

  const notes = document.createElement("textarea");
  notes.value = card.notes || "";
  notes.placeholder = i18n("Подробности, мысли, что не забыть…");
  notes.addEventListener("input", () => { card.notes = notes.value; persist(); });
  drawer.appendChild(fieldWithLabel(i18n("Заметки"), notes));

  drawer.appendChild(buildToggleGroup(i18n("Участники"), characters, cardCharacterIds(card), (ids) => {
    card.characterIds = ids;
    persist();
    draw();
  }));

  const links = document.createElement("div");
  links.className = "board-editor-row";
  links.appendChild(fieldWithLabel(i18n("Локация"), selectOf(locations, card.locationId, i18n("Без локации"), (l) => l.name || i18n("Без имени"), (id) => { card.locationId = id; persist(); draw(); })));
  links.appendChild(fieldWithLabel(i18n("Глава"), selectOf(chapters, card.chapterId, i18n("Без главы"), (c) => chapterLabel(c, books), (id) => { card.chapterId = id; persist(); draw(); })));
  links.appendChild(fieldWithLabel(i18n("Фракция"), selectOf(factions, card.factionId, i18n("Без фракции"), (f) => f.name || i18n("Без имени"), (id) => { card.factionId = id; persist(); draw(); })));
  drawer.appendChild(links);

  // Чек-лист — что сделать по этой карточке; на лицевой стороне — «2/5».
  const check = document.createElement("div");
  check.className = "board-checklist";
  const items = card.checklist || [];
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "board-check-row";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = !!item.done;
    box.addEventListener("change", () => { item.done = box.checked; persist(); draw(); });
    const text = document.createElement("input");
    text.className = "board-check-text" + (item.done ? " done" : "");
    text.value = item.text || "";
    text.addEventListener("input", () => { item.text = text.value; persist(); });
    const del = document.createElement("button");
    del.className = "ms-remove";
    del.innerHTML = iconSvg("close", 11);
    del.title = i18n("Удалить пункт");
    del.addEventListener("click", () => { card.checklist = items.filter((x) => x !== item); persist(); draw(); });
    row.append(box, text, del);
    check.appendChild(row);
  }
  const addItem = document.createElement("input");
  addItem.className = "board-quick-add";
  addItem.placeholder = i18n("+ Пункт – Enter добавит");
  addItem.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !addItem.value.trim()) return;
    card.checklist = [...items, { id: uid(), text: addItem.value.trim(), done: false }];
    persist();
    draw();
    container.querySelector(".board-checklist .board-quick-add")?.focus();
  });
  check.appendChild(addItem);
  drawer.appendChild(fieldWithLabel(i18n("Чек-лист"), check));

  const actions = document.createElement("div");
  actions.className = "drawer-actions";
  const closeBtn = document.createElement("button");
  closeBtn.className = "btn";
  closeBtn.textContent = i18n("Закрыть");
  closeBtn.addEventListener("click", () => { activeCardId = null; draw(); });
  const delBtn = document.createElement("button");
  delBtn.className = "btn danger";
  delBtn.textContent = i18n("Удалить");
  delBtn.addEventListener("click", () => deleteCard(card));
  actions.append(closeBtn, delBtn);
  drawer.appendChild(actions);
  return drawer;
}
