import { apiGet, apiPost, uid } from "./api.js";
import { debounceSave } from "./save-badge.js";
import { characterSelect } from "./chips.js";

let board = { columns: [], cards: {}, cardOrder: {} };
let characters = [];
let container = null;
const save = debounceSave((data) => apiPost("/api/board", data));

function persist() {
  save(board);
}

function defaultBoard() {
  const cols = ["Задумано", "В работе", "Готово"].map((title) => ({ id: uid(), title }));
  const cardOrder = {};
  for (const c of cols) cardOrder[c.id] = [];
  return { columns: cols, cards: {}, cardOrder };
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

  container.appendChild(view);
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
    const card = { id: uid(), title: "Новая карточка", characterId: null };
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
  delBtn.addEventListener("click", () => {
    board.cardOrder[colId] = board.cardOrder[colId].filter((id) => id !== card.id);
    delete board.cards[card.id];
    persist();
    draw();
  });
  el.appendChild(delBtn);

  return el;
}
