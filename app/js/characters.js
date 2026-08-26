import { apiGet, apiPost, uid } from "./api.js";
import { debounceSave } from "./save-badge.js";

const PALETTE = [
  "#c9944a", "#4f7d74", "#a4483c", "#7d6a9e",
  "#6a8fae", "#9a9250", "#b5636b", "#5a8a5f",
];

const FIELDS = [
  ["role", "Роль", "input"],
  ["age", "Возраст", "input"],
  ["appearance", "Внешность", "textarea"],
  ["personality", "Характер", "textarea"],
  ["motivation", "Мотивация", "textarea"],
  ["goal", "Цель", "textarea"],
  ["flaws", "Слабости", "textarea"],
  ["backstory", "Предыстория", "textarea"],
  ["tags", "Теги (через запятую)", "input"],
];

let characters = [];
let activeId = null;
let container = null;
const save = debounceSave((list) => apiPost("/api/characters", list));

function persist() {
  save(characters);
}

function blank() {
  return {
    id: uid(),
    name: "Новый персонаж",
    color: PALETTE[characters.length % PALETTE.length],
    role: "", age: "", appearance: "", personality: "",
    motivation: "", goal: "", flaws: "", backstory: "", tags: "",
  };
}

function initials(name) {
  return (name || "?").trim().slice(0, 1).toUpperCase();
}

export async function renderCharacters(root) {
  container = root;
  characters = await apiGet("/api/characters");
  draw();
}

function draw() {
  container.innerHTML = "";
  const view = document.createElement("div");
  view.className = "characters-view";

  const grid = document.createElement("div");
  grid.className = "characters-grid";

  if (!characters.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.style.gridColumn = "1 / -1";
    empty.textContent = "Персонажей пока нет — добавь первого.";
    grid.appendChild(empty);
  }

  for (const c of characters) {
    const card = document.createElement("button");
    card.className = "char-card";
    card.innerHTML = `
      <div class="char-avatar" style="background:${c.color}">${initials(c.name)}</div>
      <div class="char-name">${escapeHtml(c.name || "Без имени")}</div>
      <div class="char-role">${escapeHtml(c.role || "")}</div>
    `;
    card.addEventListener("click", () => {
      activeId = c.id;
      draw();
    });
    grid.appendChild(card);
  }

  const addCard = document.createElement("button");
  addCard.className = "char-card add-card";
  addCard.textContent = "+ Добавить персонажа";
  addCard.addEventListener("click", () => {
    const c = blank();
    characters.push(c);
    activeId = c.id;
    persist();
    draw();
  });
  grid.appendChild(addCard);

  view.appendChild(grid);

  const active = characters.find((c) => c.id === activeId);
  if (active) view.appendChild(buildDrawer(active));

  container.appendChild(view);
}

function buildDrawer(c) {
  const drawer = document.createElement("div");
  drawer.className = "drawer";

  const title = document.createElement("h2");
  const nameField = document.createElement("input");
  nameField.value = c.name;
  nameField.style.cssText =
    "background:none;border:none;color:var(--text);font-family:Fraunces,serif;font-size:1.3rem;font-weight:600;width:100%;";
  nameField.addEventListener("input", () => {
    c.name = nameField.value;
    updateCardLive();
    persist();
  });
  drawer.appendChild(nameField);

  const colorRow = document.createElement("div");
  colorRow.className = "color-row";
  colorRow.style.marginTop = "12px";
  for (const color of PALETTE) {
    const sw = document.createElement("div");
    sw.className = "swatch" + (c.color === color ? " selected" : "");
    sw.style.background = color;
    sw.addEventListener("click", () => {
      c.color = color;
      persist();
      draw();
    });
    colorRow.appendChild(sw);
  }
  drawer.appendChild(colorRow);

  for (const [key, label, kind] of FIELDS) {
    const field = document.createElement("div");
    field.className = "field";
    const lab = document.createElement("label");
    lab.textContent = label;
    field.appendChild(lab);
    const input = document.createElement(kind === "textarea" ? "textarea" : "input");
    input.value = c[key] || "";
    input.addEventListener("input", () => {
      c[key] = input.value;
      persist();
    });
    field.appendChild(input);
    drawer.appendChild(field);
  }

  const actions = document.createElement("div");
  actions.className = "drawer-actions";
  const closeBtn = document.createElement("button");
  closeBtn.className = "btn";
  closeBtn.textContent = "Закрыть";
  closeBtn.addEventListener("click", () => {
    activeId = null;
    draw();
  });
  const delBtn = document.createElement("button");
  delBtn.className = "btn danger";
  delBtn.textContent = "Удалить";
  delBtn.addEventListener("click", () => {
    characters = characters.filter((x) => x.id !== c.id);
    activeId = null;
    persist();
    draw();
  });
  actions.append(closeBtn, delBtn);
  drawer.appendChild(actions);

  function updateCardLive() {
    // Заголовок карточки в сетке слева обновляется только при полной
    // перерисовке — она недёшева на каждый keystroke, поэтому имя в
    // самой карточке подтягивается уже при следующем draw() (открытии/
    // закрытии дровера), а не посимвольно.
  }

  return drawer;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
