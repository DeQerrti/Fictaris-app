import { apiGet, apiPost, uid } from "./api.js";
import { debounceSave } from "./save-badge.js";
import { escapeHtml } from "./chips.js";
import { LOCATION_TYPES, locationTypeInfo, iconSvg } from "./icons.js";

const FIELDS = [
  ["description", "Описание", "textarea"],
  ["notes", "Заметки", "textarea"],
  ["tags", "Теги (через запятую)", "input"],
];

let locations = [];
let activeId = null;
let container = null;
const save = debounceSave((list) => apiPost("/api/locations", list));

function persist() {
  save(locations);
}

function blank() {
  return {
    id: uid(),
    name: "Новая локация",
    type: "settlement",
    description: "", notes: "", tags: "",
  };
}

export async function renderLocations(root) {
  container = root;
  locations = await apiGet("/api/locations");
  draw();
}

function draw() {
  container.innerHTML = "";
  const view = document.createElement("div");
  view.className = "characters-view";

  const grid = document.createElement("div");
  grid.className = "characters-grid";

  if (!locations.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.style.gridColumn = "1 / -1";
    empty.textContent = "Локаций пока нет — добавь первую.";
    grid.appendChild(empty);
  }

  for (const loc of locations) {
    const [, , iconName, color] = locationTypeInfo(loc.type);
    const card = document.createElement("button");
    card.className = "char-card";
    card.innerHTML = `
      <div class="char-avatar" style="background:${color}">${iconSvg(iconName, 20)}</div>
      <div class="char-name">${escapeHtml(loc.name || "Без имени")}</div>
      <div class="char-role">${escapeHtml(locationTypeInfo(loc.type)[1])}</div>
    `;
    card.addEventListener("click", () => {
      activeId = loc.id;
      draw();
    });
    grid.appendChild(card);
  }

  const addCard = document.createElement("button");
  addCard.className = "char-card add-card";
  addCard.textContent = "+ Добавить локацию";
  addCard.addEventListener("click", () => {
    const loc = blank();
    locations.push(loc);
    activeId = loc.id;
    persist();
    draw();
  });
  grid.appendChild(addCard);

  view.appendChild(grid);

  const active = locations.find((l) => l.id === activeId);
  if (active) view.appendChild(buildDrawer(active));

  container.appendChild(view);
}

function buildDrawer(loc) {
  const drawer = document.createElement("div");
  drawer.className = "drawer";

  const nameField = document.createElement("input");
  nameField.value = loc.name;
  nameField.style.cssText =
    "background:none;border:none;color:var(--text);font-family:Fraunces,serif;font-size:1.3rem;font-weight:600;width:100%;";
  nameField.addEventListener("input", () => {
    loc.name = nameField.value;
    persist();
  });
  drawer.appendChild(nameField);

  const typeField = document.createElement("div");
  typeField.className = "field";
  typeField.style.marginTop = "14px";
  const typeLabel = document.createElement("label");
  typeLabel.textContent = "Тип";
  typeField.appendChild(typeLabel);
  const typeSelect = document.createElement("select");
  for (const [value, label] of LOCATION_TYPES) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    if (loc.type === value) opt.selected = true;
    typeSelect.appendChild(opt);
  }
  typeSelect.addEventListener("change", () => {
    loc.type = typeSelect.value;
    persist();
    draw();
  });
  typeField.appendChild(typeSelect);
  drawer.appendChild(typeField);

  for (const [key, label, kind] of FIELDS) {
    const field = document.createElement("div");
    field.className = "field";
    const lab = document.createElement("label");
    lab.textContent = label;
    field.appendChild(lab);
    const input = document.createElement(kind === "textarea" ? "textarea" : "input");
    input.value = loc[key] || "";
    input.addEventListener("input", () => {
      loc[key] = input.value;
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
    locations = locations.filter((x) => x.id !== loc.id);
    activeId = null;
    persist();
    draw();
  });
  actions.append(closeBtn, delBtn);
  drawer.appendChild(actions);

  return drawer;
}
