import { apiGet, apiPost, uid } from "./api.js";
import { debounceSave } from "./save-badge.js";
import { pushTrash } from "./trash.js";
import { buildExportPngButton } from "./png-export.js";
import { openContextMenu } from "./context-menu.js";
import { escapeHtml } from "./chips.js";
import { i18n } from "./i18n.js";

const LABEL_COLORS = [
  "#c9944a", "#4f7d74", "#a4483c", "#7d6a9e",
  "#6a8fae", "#9a9250", "#b5636b", "#5a8a5f",
];

// Шаблоны структуры — только колонки, без карточек: наполнение всё
// равно у каждой рукописи своё, шаблон задаёт только скелет доски.
const TEMPLATES = [
  ["three_act", "Три акта", ["Завязка", "Развитие", "Развязка"]],
  ["hero_journey", "Путь героя", ["Обычный мир", "Зов к приключению", "Испытания", "Кризис", "Награда", "Возвращение"]],
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

function deleteBoard() {
  if (data.boards.length <= 1) return;
  data.boards = data.boards.filter((b) => b.id !== board.id);
  switchBoard(data.boards[0].id);
}

function buildBoardSwitcher() {
  const bar = document.createElement("div");
  bar.className = "board-switcher-bar";

  // Не нативный <select> — его выпадающий список рисует сама ОС/Chromium
  // своей собственной подсветкой выбранного пункта (обычно системным
  // синим), которую не перекрасить в цвета темы. Тот же переиспользуемый
  // список ПКМ (context-menu.js), что и везде в приложении, — и вид, и
  // подсветка совпадают с остальным интерфейсом.
  const switchBtn = document.createElement("button");
  switchBtn.className = "btn board-switcher-current";
  switchBtn.textContent = board.name;
  switchBtn.title = i18n("Переключить доску");
  switchBtn.addEventListener("click", () => {
    const r = switchBtn.getBoundingClientRect();
    openContextMenu(
      r.left,
      r.bottom + 4,
      data.boards.map((b) => ({
        label: b.name,
        checked: b.id === board.id,
        action: () => switchBoard(b.id),
      }))
    );
  });
  bar.appendChild(switchBtn);

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "board-switcher-rename";
  nameInput.value = board.name;
  nameInput.title = i18n("Название доски");
  nameInput.addEventListener("input", () => {
    board.name = nameInput.value;
    switchBtn.textContent = nameInput.value;
    persist();
  });
  bar.appendChild(nameInput);

  const addBtn = document.createElement("button");
  addBtn.className = "btn";
  addBtn.textContent = i18n("+ Доска");
  addBtn.addEventListener("click", addBoard);
  bar.appendChild(addBtn);

  if (data.boards.length > 1) {
    const delBtn = document.createElement("button");
    delBtn.className = "btn danger";
    delBtn.textContent = "🗑";
    delBtn.title = i18n("Удалить эту доску навсегда");
    delBtn.addEventListener("click", () => {
      if (delBtn.dataset.confirm === "1") {
        deleteBoard();
        return;
      }
      delBtn.dataset.confirm = "1";
      delBtn.textContent = i18n("Точно?");
      setTimeout(() => {
        delBtn.dataset.confirm = "";
        delBtn.textContent = "🗑";
      }, 3000);
    });
    bar.appendChild(delBtn);
  }

  return bar;
}

function charById(id) {
  return characters.find((c) => c.id === id);
}

function factionById(id) {
  return factions.find((f) => f.id === id);
}

export async function renderBoard(root) {
  container = root;
  const [rawBoard, chars, facs] = await Promise.all([apiGet("/api/board"), apiGet("/api/characters"), apiGet("/api/factions")]);
  characters = chars;
  factions = facs;
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
  outer.appendChild(buildTemplateBar());
  container.appendChild(outer);
}

function buildTemplateBar() {
  const bar = document.createElement("div");
  bar.className = "board-template-bar";

  const select = document.createElement("select");
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = i18n("Шаблон структуры…");
  select.appendChild(placeholder);
  for (const [value, label] of TEMPLATES) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = i18n(label);
    select.appendChild(opt);
  }
  bar.appendChild(select);

  const applyBtn = document.createElement("button");
  applyBtn.className = "btn";
  applyBtn.textContent = i18n("Применить");
  applyBtn.disabled = true;
  select.addEventListener("change", () => { applyBtn.disabled = !select.value; });
  applyBtn.addEventListener("click", () => {
    if (!select.value) return;
    if (applyBtn.dataset.confirm === "1") {
      const template = TEMPLATES.find((t) => t[0] === select.value);
      Object.assign(board, columnsFromTitles(template[2].map((t) => i18n(t))));
      persist();
      draw();
      return;
    }
    applyBtn.dataset.confirm = "1";
    // Шаблон — это не «переименовать колонки», а «начать доску заново»:
    // старые колонки уйдут вместе со всеми карточками внутри них, без
    // возможности восстановить (в отличие от удаления одной карточки —
    // то через pushTrash). Раньше текст предупреждал только про колонки,
    // и потерю карточек можно было принять за баг («применил шаблон — и
    // всё пропало, шаблоны не работают»), а не за то, что и
    // задумано.
    applyBtn.textContent = i18n("Удалит все карточки и колонки. Точно?");
    setTimeout(() => {
      applyBtn.dataset.confirm = "";
      applyBtn.textContent = i18n("Применить");
    }, 4000);
  });
  bar.appendChild(applyBtn);

  bar.appendChild(buildExportPngButton(() => container.querySelector(".board-view"), i18n("доска")));

  return bar;
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
  delBtn.textContent = "✕";
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
      delBtn.textContent = "✕";
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
    const card = { id: uid(), title: i18n("Новая карточка"), notes: "", characterId: null, factionId: null, labelColor: null };
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
function cardContextItems(card, colId) {
  const colorItems = [
    { label: i18n("Без метки"), swatch: "var(--panel-alt)", checked: !card.labelColor, action: () => { card.labelColor = null; persist(); draw(); } },
    ...LABEL_COLORS.map((color) => ({
      label: color, swatch: color, checked: card.labelColor === color,
      action: () => { card.labelColor = color; persist(); draw(); },
    })),
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

  return [
    { label: i18n("Цвет метки"), items: colorItems },
    { label: i18n("Связать с персонажем"), items: characterItems, disabled: !characters.length },
    { label: i18n("Связать с фракцией"), items: factionItems, disabled: !factions.length },
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

  const titleInput = document.createElement("input");
  titleInput.className = "board-card-title";
  titleInput.value = card.title;
  titleInput.addEventListener("input", () => {
    card.title = titleInput.value;
    persist();
  });
  el.appendChild(titleInput);

  // Лицевая сторона — в основном свободный текст: заметки растут на всё
  // оставшееся место карточки (flex, а не фиксированные rows), заголовок
  // и линки внизу — второстепенны.
  const notesArea = document.createElement("textarea");
  notesArea.className = "board-card-notes";
  notesArea.value = card.notes || "";
  notesArea.placeholder = i18n("Пиши здесь свободно — правый клик даёт цвет и связи…");
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
  if (chipsRow.children.length) el.appendChild(chipsRow);

  const delBtn = document.createElement("button");
  delBtn.className = "board-card-del";
  delBtn.textContent = "✕";
  delBtn.title = i18n("Удалить карточку");
  delBtn.addEventListener("click", () => deleteCard(card, colId));
  el.appendChild(delBtn);

  return el;
}
