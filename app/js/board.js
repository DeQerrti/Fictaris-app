import { apiGet, apiPost, uid } from "./api.js";
import { debounceSave } from "./save-badge.js";
import { pushTrash } from "./trash.js";
import { buildExportPngButton } from "./png-export.js";
import { openContextMenu, openPopover, closeMenu } from "./context-menu.js";
import { escapeHtml } from "./chips.js";
import { iconSvg, locationTypeInfo } from "./icons.js";
import { i18n } from "./i18n.js";

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
let container = null;
const save = debounceSave((d) => apiPost("/api/board", d));

function persist() {
  save(data);
}

// Формат на диске раньше был одной доской ({columns, cards, cardOrder}
// без обёртки) — заворачиваем в { boards: [...], activeBoardId } при
// первой загрузке, ничего не теряя из уже сохранённого.
function migrate(raw) {
  if (raw && Array.isArray(raw.boards) && raw.boards.length) {
    return { boards: raw.boards, activeBoardId: raw.activeBoardId || raw.boards[0].id };
  }
  const legacy = raw && raw.columns ? raw : { columns: [], cards: {}, cardOrder: {} };
  const first = { id: uid(), name: i18n("Доска 1"), ...legacy };
  return { boards: [first], activeBoardId: first.id };
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

function buildBoardSwitcher() {
  const bar = document.createElement("div");
  bar.className = "board-switcher-bar";

  const switchBtn = document.createElement("button");
  switchBtn.className = "btn board-switcher-current";
  switchBtn.textContent = board.name;
  switchBtn.title = i18n("Переключить доску");
  switchBtn.addEventListener("click", () => {
    const r = switchBtn.getBoundingClientRect();
    openPopover(r.left, r.bottom + 4, buildBoardSwitchList(), "board-switch-popover");
  });
  bar.appendChild(switchBtn);

  bar.appendChild(buildExportPngButton(() => container.querySelector(".board-view"), i18n("доска")));

  return bar;
}

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

export async function renderBoard(root) {
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
  data = migrate(rawBoard);
  board = data.boards.find((b) => b.id === data.activeBoardId) || data.boards[0];
  if (!board.columns.length) {
    Object.assign(board, defaultColumns());
  }
  persist();
  draw();
}

function draw() {
  container.innerHTML = "";
  const outer = document.createElement("div");
  outer.className = "board-outer";

  outer.appendChild(buildBoardSwitcher());

  const view = document.createElement("div");
  view.className = "board-view";

  for (const col of board.columns) {
    view.appendChild(buildColumn(col));
  }

  const addCol = document.createElement("button");
  addCol.className = "add-column";
  addCol.textContent = i18n("+ Колонка");
  addCol.addEventListener("click", () => {
    const col = { id: uid(), title: i18n("Новая колонка") };
    board.columns.push(col);
    board.cardOrder[col.id] = [];
    persist();
    draw();
  });
  view.appendChild(addCol);

  outer.appendChild(view);
  container.appendChild(outer);
}

let dragCardId = null;

function buildColumn(col) {
  const wrap = document.createElement("div");
  wrap.className = "board-column";

  const header = document.createElement("div");
  header.className = "board-column-header";

  const titleInput = document.createElement("input");
  titleInput.value = col.title;
  titleInput.className = "board-column-title";
  titleInput.addEventListener("input", () => {
    col.title = titleInput.value;
    persist();
  });
  header.appendChild(titleInput);

  const delBtn = document.createElement("button");
  delBtn.className = "board-column-del";
  delBtn.innerHTML = iconSvg("close", 12);
  delBtn.title = i18n("Удалить колонку");
  delBtn.addEventListener("click", () => {
    if (delBtn.dataset.confirm === "1") {
      const cardIds = board.cardOrder[col.id] || [];
      for (const id of cardIds) delete board.cards[id];
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
  header.appendChild(delBtn);

  wrap.appendChild(header);

  const list = document.createElement("div");
  list.className = "board-card-list";
  list.addEventListener("dragover", (e) => e.preventDefault());
  list.addEventListener("drop", (e) => {
    e.preventDefault();
    if (dragCardId === null) return;
    moveCard(dragCardId, col.id, board.cardOrder[col.id].length);
  });

  for (const cardId of board.cardOrder[col.id] || []) {
    const card = board.cards[cardId];
    if (!card) continue;
    list.appendChild(buildCard(card, col.id));
  }
  wrap.appendChild(list);

  const addCard = document.createElement("button");
  addCard.className = "add-chapter";
  addCard.textContent = i18n("+ Карточка");
  addCard.addEventListener("click", () => {
    const card = { id: uid(), title: i18n("Новая карточка"), notes: "", characterId: null, factionId: null, locationId: null, chapterId: null, labelColor: null };
    board.cards[card.id] = card;
    board.cardOrder[col.id].push(card.id);
    persist();
    draw();
  });
  wrap.appendChild(addCard);

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

async function deleteCard(card, colId) {
  await pushTrash("board-card", card);
  board.cardOrder[colId] = board.cardOrder[colId].filter((id) => id !== card.id);
  delete board.cards[card.id];
  persist();
  draw();
}

// Пункты «Цвет»/«Персонаж»/«Фракция»/«Удалить» — по ПКМ, а не постоянными
// виджетами на лицевой стороне карточки (как было раньше): раньше
// свотчи и выпадающий список персонажа отъедали половину карточки под
// собственно текст, а места для сути сцены оставалось на одну-две
// строки. Лицевая сторона теперь — заголовок и заметки на весь рост,
// а привязки — второстепенное действие, как в Trello/Obsidian.
// Невидимый <input type="color"> — открывает нативный (системный/
// Chromium) выбор цвета сразу по клику, без своего колесика/палитры:
// тот же приём, что скрытый <input type="file"> для загрузки картинки
// (avatars.js), только с color вместо file. onChange зовётся на каждое
// "input" (цвет уже виден на кнопке доски вживую, пока крутишь колесо),
// а не только по закрытию диалога.
function pickCustomColor(initialColor, onChange) {
  const input = document.createElement("input");
  input.type = "color";
  input.value = /^#[0-9a-f]{6}$/i.test(initialColor || "") ? initialColor : "#c9944a";
  input.style.position = "fixed";
  input.style.opacity = "0";
  input.style.pointerEvents = "none";
  document.body.appendChild(input);
  input.addEventListener("input", () => onChange(input.value));
  // change — диалог закрыли выбором; blur — закрыли как угодно ещё
  // (Esc, клик мимо) — оба раза подчищаем за собой инпут из DOM.
  input.addEventListener("change", () => input.remove());
  input.addEventListener("blur", () => setTimeout(() => input.remove(), 0));
  input.click();
}

function cardContextItems(card, colId) {
  // "Свой цвет…" показывает текущий выбор своим свотчем/галочкой,
  // только если он не совпадает ни с одним пресетом ниже — иначе тот
  // же цвет отмечался бы галочкой сразу в двух местах списка.
  const isPresetColor = LABEL_COLORS.includes(card.labelColor);
  const colorItems = [
    { label: i18n("Без метки"), swatch: "var(--panel-alt)", checked: !card.labelColor, action: () => { card.labelColor = null; persist(); draw(); } },
    ...LABEL_COLORS.map((color) => ({
      label: color, swatch: color, checked: card.labelColor === color,
      action: () => { card.labelColor = color; persist(); draw(); },
    })),
    { separator: true },
    {
      label: i18n("Свой цвет…"),
      swatch: !isPresetColor && card.labelColor ? card.labelColor : undefined,
      checked: !isPresetColor && !!card.labelColor,
      action: () => pickCustomColor(card.labelColor, (color) => { card.labelColor = color; persist(); draw(); }),
    },
  ];

  const characterItems = [
    { label: i18n("Без персонажа"), checked: !card.characterId, action: () => { card.characterId = null; persist(); draw(); } },
    ...characters.map((c) => ({
      label: escapeHtml(c.name), swatch: c.color || "#7c7157", checked: card.characterId === c.id,
      action: () => { card.characterId = c.id; persist(); draw(); },
    })),
  ];

  const factionItems = [
    { label: i18n("Без фракции"), checked: !card.factionId, action: () => { card.factionId = null; persist(); draw(); } },
    ...factions.map((f) => ({
      label: escapeHtml(f.name), checked: card.factionId === f.id,
      action: () => { card.factionId = f.id; persist(); draw(); },
    })),
  ];

  const locationItems = [
    { label: i18n("Без локации"), checked: !card.locationId, action: () => { card.locationId = null; persist(); draw(); } },
    ...locations.map((l) => {
      const [, , , color] = locationTypeInfo(l.type);
      return {
        label: escapeHtml(l.name || i18n("Без имени")), swatch: color, checked: card.locationId === l.id,
        action: () => { card.locationId = l.id; persist(); draw(); },
      };
    }),
  ];

  const chapterItems = [
    { label: i18n("Без главы"), checked: !card.chapterId, action: () => { card.chapterId = null; persist(); draw(); } },
    ...chapters.map((c) => ({
      label: escapeHtml(c.title || i18n("Без названия")), checked: card.chapterId === c.id,
      action: () => { card.chapterId = c.id; persist(); draw(); },
    })),
  ];

  return [
    { label: i18n("Цвет метки"), items: colorItems },
    { label: i18n("Связать с персонажем"), items: characterItems, disabled: !characters.length },
    { label: i18n("Связать с фракцией"), items: factionItems, disabled: !factions.length },
    { label: i18n("Связать с локацией"), items: locationItems, disabled: !locations.length },
    { label: i18n("Связать с главой"), items: chapterItems, disabled: !chapters.length },
    { separator: true },
    { label: i18n("Удалить карточку"), danger: true, action: () => deleteCard(card, colId) },
  ];
}

function buildCard(card, colId) {
  const el = document.createElement("div");
  el.className = "board-card";
  el.draggable = true;
  if (card.labelColor) el.style.borderLeft = `3px solid ${card.labelColor}`;
  el.addEventListener("dragstart", () => { dragCardId = card.id; });
  el.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragCardId === null || dragCardId === card.id) return;
    const index = board.cardOrder[colId].indexOf(card.id);
    moveCard(dragCardId, colId, index);
  });
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY, cardContextItems(card, colId));
  });

  // <textarea>, а не <input> — у input текст молча обрезается по краю
  // поля, не перенося слово на новую строку (в отличие от заметок ниже,
  // которые уже textarea). rows=1 + автоподгон высоты по scrollHeight —
  // однострочный вид, пока заголовок короткий, и сам растёт вниз, когда
  // не помещается, вместо потери текста.
  const titleInput = document.createElement("textarea");
  titleInput.className = "board-card-title";
  titleInput.rows = 1;
  titleInput.value = card.title;
  function autosizeTitle() {
    titleInput.style.height = "auto";
    titleInput.style.height = `${titleInput.scrollHeight}px`;
  }
  titleInput.addEventListener("input", () => {
    card.title = titleInput.value;
    persist();
    autosizeTitle();
  });
  // Enter завершает правку, а не переносит строку внутри заголовка —
  // перенос здесь только от нехватки места (word-wrap), не ручной.
  titleInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); titleInput.blur(); }
  });
  el.appendChild(titleInput);
  // scrollHeight у только что созданного, ещё не вставленного в живой
  // DOM элемента ничего не измеряет (нет раскладки) — откладываем
  // первый замер на следующий тик, когда draw() уже вставит карточку
  // в контейнер целиком.
  setTimeout(autosizeTitle, 0);

  // Лицевая сторона — в основном свободный текст: заметки растут на всё
  // оставшееся место карточки (flex, а не фиксированные rows), заголовок
  // и линки внизу — второстепенны.
  const notesArea = document.createElement("textarea");
  notesArea.className = "board-card-notes";
  notesArea.value = card.notes || "";
  notesArea.placeholder = i18n("Пиши здесь свободно – правый клик даёт цвет и связи…");
  notesArea.rows = 5;
  notesArea.addEventListener("input", () => {
    card.notes = notesArea.value;
    persist();
  });
  el.appendChild(notesArea);

  const chipsRow = document.createElement("div");
  chipsRow.className = "board-card-chips";
  const linkedChar = charById(card.characterId);
  if (linkedChar) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.style.background = linkedChar.color || "#7c7157";
    chip.textContent = linkedChar.name;
    chipsRow.appendChild(chip);
  }
  const linkedFaction = factionById(card.factionId);
  if (linkedFaction) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.style.background = "var(--panel-alt)";
    chip.style.color = "var(--text-dim)";
    chip.style.border = "1px solid var(--border)";
    chip.textContent = linkedFaction.name;
    chipsRow.appendChild(chip);
  }
  const linkedLocation = locationById(card.locationId);
  if (linkedLocation) {
    const [, , , color] = locationTypeInfo(linkedLocation.type);
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.style.background = color;
    chip.textContent = linkedLocation.name || i18n("Без имени");
    chipsRow.appendChild(chip);
  }
  const linkedChapter = chapterById(card.chapterId);
  if (linkedChapter) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.style.background = "var(--panel-alt)";
    chip.style.color = "var(--text-dim)";
    chip.style.border = "1px solid var(--border)";
    chip.textContent = linkedChapter.title || i18n("Без названия");
    chipsRow.appendChild(chip);
  }
  if (chipsRow.children.length) el.appendChild(chipsRow);

  const delBtn = document.createElement("button");
  delBtn.className = "board-card-del";
  delBtn.innerHTML = iconSvg("close", 12);
  delBtn.title = i18n("Удалить карточку");
  delBtn.addEventListener("click", () => deleteCard(card, colId));
  el.appendChild(delBtn);

  return el;
}
