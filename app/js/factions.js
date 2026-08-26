import { apiGet, apiPost, uid } from "./api.js";
import { debounceSave } from "./save-badge.js";
import { escapeHtml, characterSelect, buildToggleGroup } from "./chips.js";
import { FACTION_TYPES, factionTypeInfo, iconSvg } from "./icons.js";
import { pushTrash } from "./trash.js";

let factions = [];
let characters = [];
let locations = [];
let activeId = null;
let container = null;
const save = debounceSave((list) => apiPost("/api/factions", list));

function persist() {
  save(factions);
}

function blank() {
  return {
    id: uid(),
    name: "Новая фракция",
    type: "order",
    description: "", notes: "", tags: "",
    leaderId: null,
    headquartersId: null,
    memberIds: [],
  };
}

export async function renderFactions(root) {
  container = root;
  [factions, characters, locations] = await Promise.all([
    apiGet("/api/factions"),
    apiGet("/api/characters"),
    apiGet("/api/locations"),
  ]);
  draw();
}

function draw() {
  container.innerHTML = "";
  const view = document.createElement("div");
  view.className = "characters-view";

  const grid = document.createElement("div");
  grid.className = "characters-grid";

  if (!factions.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.style.gridColumn = "1 / -1";
    empty.textContent = "Фракций пока нет — добавь первую.";
    grid.appendChild(empty);
  }

  for (const f of factions) {
    const [, typeLabel, iconName, color] = factionTypeInfo(f.type);
    const card = document.createElement("button");
    card.className = "char-card";
    card.innerHTML = `
      <div class="char-avatar" style="background:${color}">${iconSvg(iconName, 20)}</div>
      <div class="char-name">${escapeHtml(f.name || "Без имени")}</div>
      <div class="char-role">${escapeHtml(typeLabel)}</div>
    `;
    card.addEventListener("click", () => {
      activeId = f.id;
      draw();
    });
    grid.appendChild(card);
  }

  const addCard = document.createElement("button");
  addCard.className = "char-card add-card";
  addCard.textContent = "+ Добавить фракцию";
  addCard.addEventListener("click", () => {
    const f = blank();
    factions.push(f);
    activeId = f.id;
    persist();
    draw();
  });
  grid.appendChild(addCard);

  view.appendChild(grid);

  const active = factions.find((f) => f.id === activeId);
  if (active) view.appendChild(buildDrawer(active));

  container.appendChild(view);
}

function buildDrawer(f) {
  const drawer = document.createElement("div");
  drawer.className = "drawer";

  const nameField = document.createElement("input");
  nameField.value = f.name;
  nameField.style.cssText =
    "background:none;border:none;color:var(--text);font-family:Fraunces,serif;font-size:1.3rem;font-weight:600;width:100%;";
  nameField.addEventListener("input", () => { f.name = nameField.value; persist(); });
  drawer.appendChild(nameField);

  const typeField = document.createElement("div");
  typeField.className = "field";
  typeField.style.marginTop = "14px";
  const typeLabel = document.createElement("label");
  typeLabel.textContent = "Тип";
  typeField.appendChild(typeLabel);
  const typeSelect = document.createElement("select");
  for (const [value, label] of FACTION_TYPES) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    if (f.type === value) opt.selected = true;
    typeSelect.appendChild(opt);
  }
  typeSelect.addEventListener("change", () => { f.type = typeSelect.value; persist(); draw(); });
  typeField.appendChild(typeSelect);
  drawer.appendChild(typeField);

  const leaderField = document.createElement("div");
  leaderField.className = "field";
  const leaderLabel = document.createElement("label");
  leaderLabel.textContent = "Глава";
  leaderField.appendChild(leaderLabel);
  const leaderSelect = characterSelect(characters, f.leaderId, "Не назначен");
  leaderSelect.addEventListener("change", () => { f.leaderId = leaderSelect.value || null; persist(); });
  leaderField.appendChild(leaderSelect);
  drawer.appendChild(leaderField);

  const hqField = document.createElement("div");
  hqField.className = "field";
  const hqLabel = document.createElement("label");
  hqLabel.textContent = "Штаб-квартира";
  hqField.appendChild(hqLabel);
  const hqSelect = document.createElement("select");
  const noneOpt = document.createElement("option");
  noneOpt.value = "";
  noneOpt.textContent = "Не указана";
  hqSelect.appendChild(noneOpt);
  for (const l of locations) {
    const opt = document.createElement("option");
    opt.value = l.id;
    opt.textContent = l.name || "Без имени";
    if (f.headquartersId === l.id) opt.selected = true;
    hqSelect.appendChild(opt);
  }
  hqSelect.addEventListener("change", () => { f.headquartersId = hqSelect.value || null; persist(); });
  hqField.appendChild(hqSelect);
  drawer.appendChild(hqField);

  drawer.appendChild(buildToggleGroup("Состав", characters, f.memberIds || [], (ids) => {
    f.memberIds = ids;
    persist();
    draw();
  }));

  for (const [key, label] of [["description", "Описание / идеология"], ["notes", "Заметки"], ["tags", "Теги (через запятую)"]]) {
    const field = document.createElement("div");
    field.className = "field";
    const lab = document.createElement("label");
    lab.textContent = label;
    field.appendChild(lab);
    const kind = key === "tags" ? "input" : "textarea";
    const input = document.createElement(kind);
    input.value = f[key] || "";
    input.addEventListener("input", () => { f[key] = input.value; persist(); });
    field.appendChild(input);
    drawer.appendChild(field);
  }

  const actions = document.createElement("div");
  actions.className = "drawer-actions";
  const closeBtn = document.createElement("button");
  closeBtn.className = "btn";
  closeBtn.textContent = "Закрыть";
  closeBtn.addEventListener("click", () => { activeId = null; draw(); });
  const delBtn = document.createElement("button");
  delBtn.className = "btn danger";
  delBtn.textContent = "Удалить";
  delBtn.addEventListener("click", async () => {
    await pushTrash("faction", f);
    factions = factions.filter((x) => x.id !== f.id);
    activeId = null;
    persist();
    draw();
  });
  actions.append(closeBtn, delBtn);
  drawer.appendChild(actions);

  return drawer;
}
