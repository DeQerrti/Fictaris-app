import { apiGet, apiPost, uid } from "./api.js";
import { debounceSave } from "./save-badge.js";
import { characterSelect } from "./chips.js";
import { pushTrash } from "./trash.js";
import { buildExportPngButton } from "./png-export.js";

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

let board = { columns: [], cards: {}, cardOrder: {} };
let characters = [];
let container = null;
const save = debounceSave((data) => apiPost("/api/board", data));

function persist() {
  save(board);
}

function columnsFromTitles(titles) {
  const cols = titles.map((title) => ({ id: uid(), title }));
  const cardOrder = {};
  for (const c of cols) cardOrder[c.id] = [];
  return { columns: cols, cards: {}, cardOrder };
}

function defaultBoard() {
  return columnsFromTitles(["Задумано", "В работе", "Готово"]);
}

function charById(id) {
  return characters.find((c) => c.id === id);
}

export async function renderBoard(root) {
  container = root;
  [board, characters] = await Promise.all([apiGet("/api/board"), apiGet("/api/characters")]);
  if (!board.columns.length) {
    board = defaultBoard();
    persist();
  }
  draw();
}

function draw() {
  container.innerHTML = "";
  const outer = document.createElement("div");
  outer.className = "board-outer";

  const view = document.createElement("div");
  view.className = "board-view";

  for (const col of board.columns) {
    view.appendChild(buildColumn(col));
  }

  const addCol = document.createElement("button");
  addCol.className = "add-column";
  addCol.textContent = "+ Колонка";
  addCol.addEventListener("click", () => {
    const col = { id: uid(), title: "Новая колонка" };
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
  placeholder.textContent = "Шаблон структуры…";
  select.appendChild(placeholder);
  for (const [value, label] of TEMPLATES) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
  }
  bar.appendChild(select);

  const applyBtn = document.createElement("button");
  applyBtn.className = "btn";
  applyBtn.textContent = "Применить";
  applyBtn.disabled = true;
  select.addEventListener("change", () => { applyBtn.disabled = !select.value; });
  applyBtn.addEventListener("click", () => {
    if (!select.value) return;
    if (applyBtn.dataset.confirm === "1") {
      const template = TEMPLATES.find((t) => t[0] === select.value);
      board = columnsFromTitles(template[2]);
      persist();
      draw();
      return;
    }
    applyBtn.dataset.confirm = "1";
    applyBtn.textContent = "Заменит все колонки. Точно?";
    setTimeout(() => {
      applyBtn.dataset.confirm = "";
      applyBtn.textContent = "Применить";
    }, 4000);
  });
  bar.appendChild(applyBtn);

  bar.appendChild(buildExportPngButton(() => container.querySelector(".board-view"), "доска"));

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
  delBtn.title = "Удалить колонку";
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
    delBtn.textContent = "Точно?";
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
  addCard.textContent = "+ Карточка";
  addCard.addEventListener("click", () => {
    const card = { id: uid(), title: "Новая карточка", characterId: null, labelColor: null };
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

  const titleInput = document.createElement("input");
  titleInput.className = "board-card-title";
  titleInput.value = card.title;
  titleInput.addEventListener("input", () => {
    card.title = titleInput.value;
    persist();
  });
  el.appendChild(titleInput);

  const labelRow = document.createElement("div");
  labelRow.className = "card-label-row";
  const noneSwatch = document.createElement("div");
  noneSwatch.className = "swatch label-swatch" + (!card.labelColor ? " selected" : "");
  noneSwatch.style.background = "var(--panel-alt)";
  noneSwatch.title = "Без метки";
  noneSwatch.addEventListener("click", () => { card.labelColor = null; persist(); draw(); });
  labelRow.appendChild(noneSwatch);
  for (const color of LABEL_COLORS) {
    const sw = document.createElement("div");
    sw.className = "swatch label-swatch" + (card.labelColor === color ? " selected" : "");
    sw.style.background = color;
    sw.addEventListener("click", () => { card.labelColor = color; persist(); draw(); });
    labelRow.appendChild(sw);
  }
  el.appendChild(labelRow);

  if (characters.length) {
    const select = characterSelect(characters, card.characterId, "Без персонажа");
    select.className = "board-card-select";
    select.addEventListener("change", () => {
      card.characterId = select.value || null;
      persist();
      draw();
    });
    el.appendChild(select);
  }

  const linked = charById(card.characterId);
  if (linked) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.style.background = linked.color || "#7c7157";
    chip.style.marginTop = "6px";
    chip.style.display = "inline-block";
    chip.textContent = linked.name;
    el.appendChild(chip);
  }

  const delBtn = document.createElement("button");
  delBtn.className = "board-card-del";
  delBtn.textContent = "✕";
  delBtn.addEventListener("click", async () => {
    await pushTrash("board-card", card);
    board.cardOrder[colId] = board.cardOrder[colId].filter((id) => id !== card.id);
    delete board.cards[card.id];
    persist();
    draw();
  });
  el.appendChild(delBtn);

  return el;
}
