import { apiGet, apiPost, uid } from "./api.js";
import { debounceSave } from "./save-badge.js";
import { escapeHtml } from "./chips.js";
import { locationTypeInfo } from "./icons.js";

let events = [];
let characters = [];
let locations = [];
let activeId = null;
let filterCharIds = new Set();
let container = null;
const save = debounceSave((list) => apiPost("/api/timeline", list));

function persist() {
  save(events);
}

function sorted() {
  return [...events].sort((a, b) => a.order - b.order);
}

function blank() {
  const maxOrder = events.reduce((m, e) => Math.max(m, e.order), 0);
  return {
    id: uid(),
    order: maxOrder + 1,
    date: "",
    title: "Новое событие",
    description: "",
    characterIds: [],
    locationIds: [],
  };
}

// Число внутри свободного текста даты определяет позицию на шкале —
// пока событие не переставили руками (drag-and-drop ниже считает
// order уже сам, через среднее соседей, и с этого момента побеждает
// он: иначе правка даты после ручной перестановки отменяла бы её).
function orderFromDate(text) {
  const m = /-?\d+(\.\d+)?/.exec(text || "");
  return m ? parseFloat(m[0]) : null;
}

function charById(id) {
  return characters.find((c) => c.id === id);
}
function locById(id) {
  return locations.find((l) => l.id === id);
}

export async function renderTimeline(root) {
  container = root;
  [events, characters, locations] = await Promise.all([
    apiGet("/api/timeline"),
    apiGet("/api/characters"),
    apiGet("/api/locations"),
  ]);
  draw();
}

function draw() {
  container.innerHTML = "";
  const view = document.createElement("div");
  view.className = "timeline-view";

  const listPane = document.createElement("div");
  listPane.className = "timeline-list-pane";
  listPane.appendChild(buildFilterBar());
  listPane.appendChild(buildList());
  view.appendChild(listPane);

  const active = events.find((e) => e.id === activeId);
  if (active) view.appendChild(buildDrawer(active));

  container.appendChild(view);
}

function buildFilterBar() {
  const bar = document.createElement("div");
  bar.className = "timeline-filter-bar";
  if (!characters.length) return bar;

  for (const c of characters) {
    const chip = document.createElement("button");
    chip.className = "filter-chip" + (filterCharIds.has(c.id) ? " active" : "");
    chip.style.setProperty("--chip-color", c.color || "#7c7157");
    chip.textContent = c.name;
    chip.addEventListener("click", () => {
      if (filterCharIds.has(c.id)) filterCharIds.delete(c.id);
      else filterCharIds.add(c.id);
      draw();
    });
    bar.appendChild(chip);
  }

  if (filterCharIds.size) {
    const shown = events.filter((e) => e.characterIds?.some((id) => filterCharIds.has(id))).length;
    const count = document.createElement("span");
    count.className = "filter-count";
    count.textContent = `${shown} из ${events.length} событий`;
    bar.appendChild(count);
  }

  return bar;
}

function visibleEvents() {
  const all = sorted();
  if (!filterCharIds.size) return all;
  return all.filter((e) => e.characterIds?.some((id) => filterCharIds.has(id)));
}

function buildList() {
  const list = document.createElement("div");
  list.className = "timeline-list";

  const items = visibleEvents();
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = events.length ? "Нет событий с таким фильтром." : "Событий пока нет — добавь первое.";
    list.appendChild(empty);
  }

  let dragId = null;

  for (const ev of items) {
    const item = document.createElement("div");
    item.className = "timeline-item" + (ev.id === activeId ? " active" : "");
    item.draggable = true;

    const chips = [
      ...(ev.characterIds || []).map((id) => charById(id)).filter(Boolean).map((c) =>
        `<span class="chip" style="background:${c.color || "#7c7157"}">${escapeHtml(c.name)}</span>`
      ),
      ...(ev.locationIds || []).map((id) => locById(id)).filter(Boolean).map((l) =>
        `<span class="chip" style="background:${locationTypeInfo(l.type)[3]}">${escapeHtml(l.name)}</span>`
      ),
    ].join("");

    item.innerHTML = `
      <div class="timeline-date">${escapeHtml(ev.date || "—")}</div>
      <div class="timeline-title">${escapeHtml(ev.title || "Без названия")}</div>
      <div class="timeline-chips">${chips}</div>
    `;

    item.addEventListener("click", () => { activeId = ev.id; draw(); });

    item.addEventListener("dragstart", () => { dragId = ev.id; });
    item.addEventListener("dragover", (e) => e.preventDefault());
    item.addEventListener("drop", (e) => {
      e.preventDefault();
      if (dragId === null || dragId === ev.id) return;
      reorder(dragId, ev.id, items);
    });

    list.appendChild(item);
  }

  const addBtn = document.createElement("button");
  addBtn.className = "add-chapter";
  addBtn.textContent = "+ Событие";
  addBtn.addEventListener("click", () => {
    const ev = blank();
    events.push(ev);
    activeId = ev.id;
    persist();
    draw();
  });
  list.appendChild(addBtn);

  return list;
}

// Новый order — среднее между соседями в текущем видимом (отсортированном
// и, может быть, отфильтрованном) порядке. Не полная перенумерация —
// тогда правка даты у любого другого события не расходилась бы с
// ручной перестановкой.
function reorder(draggedId, targetId, orderedList) {
  const dragged = events.find((e) => e.id === draggedId);
  const targetIndex = orderedList.findIndex((e) => e.id === targetId);
  const before = orderedList[targetIndex - 1];
  const target = orderedList[targetIndex];
  const newOrder = before ? (before.order + target.order) / 2 : target.order - 1;
  dragged.order = newOrder;
  persist();
  draw();
}

function buildDrawer(ev) {
  const drawer = document.createElement("div");
  drawer.className = "drawer";

  const titleInput = document.createElement("input");
  titleInput.value = ev.title;
  titleInput.style.cssText =
    "background:none;border:none;color:var(--text);font-family:Fraunces,serif;font-size:1.3rem;font-weight:600;width:100%;";
  titleInput.addEventListener("input", () => { ev.title = titleInput.value; persist(); });
  drawer.appendChild(titleInput);

  const dateField = document.createElement("div");
  dateField.className = "field";
  dateField.style.marginTop = "14px";
  const dateLabel = document.createElement("label");
  dateLabel.textContent = "Дата";
  dateField.appendChild(dateLabel);
  const dateInput = document.createElement("input");
  dateInput.value = ev.date || "";
  dateInput.placeholder = "например: год 214, день третий";
  dateInput.addEventListener("input", () => {
    ev.date = dateInput.value;
    const n = orderFromDate(ev.date);
    if (n !== null) ev.order = n;
    persist();
  });
  dateField.appendChild(dateInput);
  drawer.appendChild(dateField);

  const descField = document.createElement("div");
  descField.className = "field";
  const descLabel = document.createElement("label");
  descLabel.textContent = "Описание";
  descField.appendChild(descLabel);
  const descArea = document.createElement("textarea");
  descArea.value = ev.description || "";
  descArea.addEventListener("input", () => { ev.description = descArea.value; persist(); });
  descField.appendChild(descArea);
  drawer.appendChild(descField);

  drawer.appendChild(buildToggleGroup("Персонажи", characters, ev.characterIds || [], (ids) => {
    ev.characterIds = ids;
    persist();
    draw();
  }));

  drawer.appendChild(buildToggleGroup(
    "Локации",
    locations,
    ev.locationIds || [],
    (ids) => { ev.locationIds = ids; persist(); draw(); },
    (l) => locationTypeInfo(l.type)[3]
  ));

  const actions = document.createElement("div");
  actions.className = "drawer-actions";
  const closeBtn = document.createElement("button");
  closeBtn.className = "btn";
  closeBtn.textContent = "Закрыть";
  closeBtn.addEventListener("click", () => { activeId = null; draw(); });
  const delBtn = document.createElement("button");
  delBtn.className = "btn danger";
  delBtn.textContent = "Удалить";
  delBtn.addEventListener("click", () => {
    events = events.filter((x) => x.id !== ev.id);
    activeId = null;
    persist();
    draw();
  });
  actions.append(closeBtn, delBtn);
  drawer.appendChild(actions);

  return drawer;
}

function buildToggleGroup(label, items, selectedIds, onChange, colorOf = (c) => c.color || "#7c7157") {
  const field = document.createElement("div");
  field.className = "field";
  const lab = document.createElement("label");
  lab.textContent = label;
  field.appendChild(lab);

  const row = document.createElement("div");
  row.className = "timeline-filter-bar";
  row.style.marginBottom = "0";
  for (const it of items) {
    const chip = document.createElement("button");
    const active = selectedIds.includes(it.id);
    chip.className = "filter-chip" + (active ? " active" : "");
    chip.style.setProperty("--chip-color", colorOf(it));
    chip.textContent = it.name;
    chip.addEventListener("click", () => {
      const next = active ? selectedIds.filter((id) => id !== it.id) : [...selectedIds, it.id];
      onChange(next);
    });
    row.appendChild(chip);
  }
  if (!items.length) {
    const none = document.createElement("span");
    none.className = "filter-count";
    none.textContent = "пока нет";
    row.appendChild(none);
  }
  field.appendChild(row);
  return field;
}
