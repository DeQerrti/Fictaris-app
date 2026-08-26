import { apiGet, apiPost, uid } from "./api.js";
import { debounceSave } from "./save-badge.js";
import { escapeHtml, buildToggleGroup } from "./chips.js";
import { locationTypeInfo } from "./icons.js";
import { attachMentionAutocomplete } from "./mentions.js";
import { pushTrash } from "./trash.js";
import { buildExportPngButton } from "./png-export.js";
import { loadCalendar, absoluteDay, formatDate } from "./calendar.js";

let events = [];
let characters = [];
let locations = [];
let calendar = null;
let activeId = null;
let filterCharIds = new Set();
let filterLocIds = new Set();
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

export async function renderTimeline(root, focusId) {
  container = root;
  [events, characters, locations, calendar] = await Promise.all([
    apiGet("/api/timeline"),
    apiGet("/api/characters"),
    apiGet("/api/locations"),
    loadCalendar(),
  ]);
  if (focusId && events.some((e) => e.id === focusId)) activeId = focusId;
  draw();
}

function draw() {
  container.innerHTML = "";
  const view = document.createElement("div");
  view.className = "timeline-view";

  const listPane = document.createElement("div");
  listPane.className = "timeline-list-pane";
  const toolbar = document.createElement("div");
  toolbar.className = "timeline-toolbar";
  toolbar.appendChild(buildExportPngButton(() => container.querySelector(".timeline-list"), "таймлайн"));
  listPane.appendChild(toolbar);
  listPane.appendChild(buildFilterBar());
  listPane.appendChild(buildList());
  view.appendChild(listPane);

  const active = events.find((e) => e.id === activeId);
  if (active) view.appendChild(buildDrawer(active));

  container.appendChild(view);
}

function buildFilterBar() {
  const wrap = document.createElement("div");

  if (characters.length) {
    const bar = document.createElement("div");
    bar.className = "timeline-filter-bar";
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
    wrap.appendChild(bar);
  }

  if (locations.length) {
    const bar = document.createElement("div");
    bar.className = "timeline-filter-bar";
    for (const l of locations) {
      const chip = document.createElement("button");
      chip.className = "filter-chip" + (filterLocIds.has(l.id) ? " active" : "");
      chip.style.setProperty("--chip-color", locationTypeInfo(l.type)[3]);
      chip.textContent = l.name;
      chip.addEventListener("click", () => {
        if (filterLocIds.has(l.id)) filterLocIds.delete(l.id);
        else filterLocIds.add(l.id);
        draw();
      });
      bar.appendChild(chip);
    }
    wrap.appendChild(bar);
  }

  if (filterCharIds.size || filterLocIds.size) {
    const count = document.createElement("div");
    count.className = "filter-count";
    count.textContent = `${visibleEvents().length} из ${events.length} событий`;
    wrap.appendChild(count);
  }

  return wrap;
}

// Оба фильтра — персонажи и локации — сужают список одновременно
// (событие должно подходить под каждый выбранный фильтр по отдельности,
// а не под любой из них), иначе выбор локации без выбора персонажа не
// работал бы вовсе.
function visibleEvents() {
  const all = sorted();
  return all.filter((e) => {
    if (filterCharIds.size && !e.characterIds?.some((id) => filterCharIds.has(id))) return false;
    if (filterLocIds.size && !e.locationIds?.some((id) => filterLocIds.has(id))) return false;
    return true;
  });
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

// Свободный текст — поведение как было всегда: число внутри строки
// двигает событие по шкале (см. orderFromDate выше).
function buildFreeTextDateField(ev) {
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
  return dateField;
}

// Свой календарь (Настройки → Календарь) включён — три поля вместо
// текста, и порядок на шкале точный (absoluteDay), а не по эвристике.
// dateYear/dateMonth/dateDay хранятся отдельно от готовой строки ev.date,
// чтобы при повторном открытии карточки не разбирать её обратно.
function buildCalendarDateField(ev) {
  const dateField = document.createElement("div");
  dateField.className = "field";
  dateField.style.marginTop = "14px";
  const dateLabel = document.createElement("label");
  dateLabel.textContent = "Дата";
  dateField.appendChild(dateLabel);

  const row = document.createElement("div");
  row.className = "timeline-date-fields";

  const yearInput = document.createElement("input");
  yearInput.type = "number";
  yearInput.value = ev.dateYear ?? 0;

  const monthSelect = document.createElement("select");
  calendar.months.forEach((m, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = m.name;
    if ((ev.dateMonth ?? 0) === i) opt.selected = true;
    monthSelect.appendChild(opt);
  });

  const dayInput = document.createElement("input");
  dayInput.type = "number";
  dayInput.min = "1";
  dayInput.value = ev.dateDay ?? 1;

  function apply() {
    const monthIndex = Number(monthSelect.value);
    const maxDay = calendar.months[monthIndex]?.days || 30;
    const year = Number(yearInput.value) || 0;
    const day = Math.max(1, Math.min(maxDay, Number(dayInput.value) || 1));
    dayInput.max = String(maxDay);
    dayInput.value = day;

    ev.dateYear = year;
    ev.dateMonth = monthIndex;
    ev.dateDay = day;
    ev.date = formatDate(calendar, { year, month: monthIndex, day });
    ev.order = absoluteDay(calendar, year, monthIndex, day);
    persist();
  }

  yearInput.addEventListener("input", apply);
  monthSelect.addEventListener("change", apply);
  dayInput.addEventListener("input", apply);

  row.append(yearInput, monthSelect, dayInput);
  dateField.appendChild(row);
  return dateField;
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

  drawer.appendChild(calendar ? buildCalendarDateField(ev) : buildFreeTextDateField(ev));

  const descField = document.createElement("div");
  descField.className = "field";
  const descLabel = document.createElement("label");
  descLabel.textContent = "Описание";
  descField.appendChild(descLabel);
  const descArea = document.createElement("textarea");
  descArea.value = ev.description || "";
  descArea.addEventListener("input", () => { ev.description = descArea.value; persist(); });
  descField.appendChild(descArea);
  attachMentionAutocomplete(descArea, () => characters);
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
  delBtn.addEventListener("click", async () => {
    await pushTrash("timeline", ev);
    events = events.filter((x) => x.id !== ev.id);
    activeId = null;
    persist();
    draw();
  });
  actions.append(closeBtn, delBtn);
  drawer.appendChild(actions);

  return drawer;
}
