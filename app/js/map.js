import { apiGet, apiPost, uid } from "./api.js";
import { debounceSave } from "./save-badge.js";
import { characterSelect, escapeHtml } from "./chips.js";
import { locationTypeInfo, iconSvg } from "./icons.js";
import { compressImage } from "./image-compress.js";
import { buildExportPngButton } from "./png-export.js";
import { i18n } from "./i18n.js";

let map = { rootIds: [], maps: {} };
let characters = [];
let locations = [];
let stack = []; // пусто — экран «все карты»; иначе путь от корневой карты до текущей
let activePinId = null;
let container = null;
const save = debounceSave((data) => apiPost("/api/map", data));

function persist() {
  save(map);
}

function currentMap() {
  return map.maps[stack[stack.length - 1]];
}

function charById(id) {
  return characters.find((c) => c.id === id);
}
function locById(id) {
  return locations.find((l) => l.id === id);
}

// Рекурсивно собирает id этой карты и всех вложенных под-карт,
// доступных через метки-порталы, — чтобы удалить их все разом вместе
// с родительской меткой или корневой картой, а не оставить осиротевшие
// карты в файле.
function collectMapIds(mapId, acc = new Set()) {
  if (acc.has(mapId)) return acc;
  acc.add(mapId);
  const m = map.maps[mapId];
  if (!m) return acc;
  for (const pin of m.pins) {
    if (pin.linkedMapId) collectMapIds(pin.linkedMapId, acc);
  }
  return acc;
}

export async function renderMap(root) {
  container = root;
  [map, characters, locations] = await Promise.all([
    apiGet("/api/map"),
    apiGet("/api/characters"),
    apiGet("/api/locations"),
  ]);
  // Совместимость со старой формой { rootId } на случай, если где-то
  // остался map.json, записанный до перехода на несколько карт.
  if (!Array.isArray(map.rootIds)) map.rootIds = map.rootId ? [map.rootId] : [];
  if (stack.length && !map.maps[stack[stack.length - 1]]) stack = [];
  draw();
}

function draw() {
  container.innerHTML = "";

  if (!stack.length) {
    container.appendChild(buildMapsHome());
    return;
  }

  const view = document.createElement("div");
  view.className = "map-view";

  const pane = document.createElement("div");
  pane.className = "map-pane";
  pane.appendChild(buildBreadcrumbs());
  pane.appendChild(buildCanvas());
  view.appendChild(pane);

  const pin = currentMap()?.pins.find((p) => p.id === activePinId);
  if (pin) view.appendChild(buildDrawer(pin));

  container.appendChild(view);
}

// Несколько независимых карт верхнего уровня — экран-витрина, с
// которого входишь в одну из них; вложенные под-карты живут только
// внутри своего дерева и здесь не перечисляются.
function buildMapsHome() {
  const view = document.createElement("div");
  view.className = "characters-view";
  const grid = document.createElement("div");
  grid.className = "characters-grid";

  if (!map.rootIds.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.style.gridColumn = "1 / -1";
    empty.textContent = i18n("Карт пока нет — загрузи изображение, чтобы создать первую.");
    grid.appendChild(empty);
  }

  for (const id of map.rootIds) {
    const m = map.maps[id];
    if (!m) continue;
    const card = document.createElement("div");
    card.className = "char-card map-home-card";

    const open = document.createElement("button");
    open.className = "map-home-open";
    open.innerHTML = `
      <div class="char-avatar" style="background:#6a8fae">${iconSvg("pin", 20)}</div>
      <div class="char-name">${escapeHtml(m.name || i18n("Без названия"))}</div>
      <div class="char-role">${i18n("{n} меток", { n: (m.pins || []).length })}</div>
    `;
    open.addEventListener("click", () => {
      stack = [id];
      activePinId = null;
      draw();
    });
    card.appendChild(open);

    const delBtn = document.createElement("button");
    delBtn.className = "board-column-del";
    delBtn.textContent = "✕";
    delBtn.title = i18n("Удалить карту со всеми вложенными под-картами");
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (delBtn.dataset.confirm === "1") {
        for (const mid of collectMapIds(id)) delete map.maps[mid];
        map.rootIds = map.rootIds.filter((r) => r !== id);
        persist();
        draw();
        return;
      }
      delBtn.dataset.confirm = "1";
      delBtn.textContent = "?";
      delBtn.title = i18n("Удалит карту со всем вложенным. Точно?");
      setTimeout(() => {
        delBtn.dataset.confirm = "";
        delBtn.textContent = "✕";
      }, 3000);
    });
    card.appendChild(delBtn);

    grid.appendChild(card);
  }

  const addCard = document.createElement("button");
  addCard.className = "char-card add-card";
  addCard.textContent = i18n("+ Новая карта");
  addCard.addEventListener("click", createRootMap);
  grid.appendChild(addCard);

  view.appendChild(grid);
  return view;
}

function createRootMap() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    const path = await uploadCompressed(file);
    const id = uid();
    map.maps[id] = { id, name: i18n("Новая карта"), imageRelPath: path, pins: [] };
    map.rootIds.push(id);
    persist();
    stack = [id];
    activePinId = null;
    draw();
  });
  input.click();
}

async function uploadCompressed(file) {
  const base64 = await compressImage(file);
  const ext = /png/i.test(file.type) ? "png" : "jpg";
  const { path } = await apiPost("/api/map/image", { data: base64, ext });
  return path;
}

function buildUploadPrompt() {
  const wrap = document.createElement("div");
  wrap.className = "empty-state map-upload";
  wrap.innerHTML = `<p>${i18n("У этой под-карты пока нет изображения.")}</p>`;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    currentMap().imageRelPath = await uploadCompressed(file);
    persist();
    draw();
  });
  wrap.appendChild(input);
  return wrap;
}

function buildBreadcrumbs() {
  const bar = document.createElement("div");
  bar.className = "map-breadcrumbs";

  const home = document.createElement("button");
  home.className = "map-breadcrumb";
  home.textContent = i18n("← Все карты");
  home.addEventListener("click", () => { stack = []; activePinId = null; draw(); });
  bar.appendChild(home);

  stack.forEach((id, i) => {
    const m = map.maps[id];
    if (!m) return;
    const sep = document.createElement("span");
    sep.className = "map-breadcrumb-sep";
    sep.textContent = "›";
    bar.appendChild(sep);

    const btn = document.createElement("button");
    btn.className = "map-breadcrumb" + (i === stack.length - 1 ? " active" : "");
    btn.textContent = m.name;
    btn.addEventListener("click", () => {
      if (i === stack.length - 1) {
        renameCurrentMap(btn);
        return;
      }
      stack = stack.slice(0, i + 1);
      activePinId = null;
      draw();
    });
    bar.appendChild(btn);
  });
  bar.appendChild(buildExportPngButton(() => container.querySelector(".map-canvas-wrap"), currentMap()?.name || i18n("карта")));
  return bar;
}

function renameCurrentMap(btn) {
  const input = document.createElement("input");
  input.className = "map-breadcrumb-edit";
  input.value = currentMap().name;
  const finish = () => {
    currentMap().name = input.value.trim() || currentMap().name;
    persist();
    draw();
  };
  input.addEventListener("blur", finish);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
  btn.replaceWith(input);
  input.focus();
  input.select();
}

function buildCanvas() {
  const cm = currentMap();
  const wrap = document.createElement("div");
  wrap.className = "map-canvas-wrap";

  if (!cm.imageRelPath) {
    wrap.appendChild(buildUploadPrompt());
    return wrap;
  }

  const frame = document.createElement("div");
  frame.className = "map-canvas";

  const img = document.createElement("img");
  img.src = `/${cm.imageRelPath}`;
  img.draggable = false;
  frame.appendChild(img);

  frame.addEventListener("click", (e) => {
    if (e.target !== img) return;
    const rect = img.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    const pin = { id: uid(), x, y, label: i18n("Новая метка"), note: "", characterId: null, locationId: null, linkedMapId: null };
    cm.pins.push(pin);
    activePinId = pin.id;
    persist();
    draw();
  });

  for (const pin of cm.pins) {
    frame.appendChild(buildPinMarker(pin));
  }

  wrap.appendChild(frame);
  return wrap;
}

function pinVisual(pin) {
  const loc = locById(pin.locationId);
  if (loc) return { color: locationTypeInfo(loc.type)[3], icon: locationTypeInfo(loc.type)[2] };
  const c = charById(pin.characterId);
  if (c) return { color: c.color || "#a4483c", icon: "pin" };
  return { color: "#a4483c", icon: "pin" };
}

function buildPinMarker(pin) {
  const { color, icon } = pinVisual(pin);
  const marker = document.createElement("button");
  marker.className = "map-pin" + (pin.id === activePinId ? " active" : "");
  marker.style.left = `${pin.x}%`;
  marker.style.top = `${pin.y}%`;
  marker.style.color = color;
  marker.innerHTML = iconSvg(icon, 22);
  marker.title = pin.label || "";
  marker.addEventListener("click", (e) => {
    e.stopPropagation();
    activePinId = pin.id;
    draw();
  });
  return marker;
}

function buildDrawer(pin) {
  const cm = currentMap();
  const drawer = document.createElement("div");
  drawer.className = "drawer";

  const labelInput = document.createElement("input");
  labelInput.value = pin.label;
  labelInput.className = "drawer-name-field drawer-name-field-sm";
  labelInput.addEventListener("input", () => { pin.label = labelInput.value; persist(); draw(); });
  drawer.appendChild(labelInput);

  const noteField = document.createElement("div");
  noteField.className = "field";
  noteField.style.marginTop = "14px";
  const noteLabel = document.createElement("label");
  noteLabel.textContent = i18n("Заметка");
  noteField.appendChild(noteLabel);
  const noteArea = document.createElement("textarea");
  noteArea.value = pin.note || "";
  noteArea.addEventListener("input", () => { pin.note = noteArea.value; persist(); });
  noteField.appendChild(noteArea);
  drawer.appendChild(noteField);

  const charField = document.createElement("div");
  charField.className = "field";
  const charLabel = document.createElement("label");
  charLabel.textContent = i18n("Персонаж");
  charField.appendChild(charLabel);
  const charSelect = characterSelect(characters, pin.characterId, i18n("Не привязан"));
  charSelect.addEventListener("change", () => { pin.characterId = charSelect.value || null; persist(); draw(); });
  charField.appendChild(charSelect);
  drawer.appendChild(charField);

  const locField = document.createElement("div");
  locField.className = "field";
  const locLabel = document.createElement("label");
  locLabel.textContent = i18n("Локация");
  locField.appendChild(locLabel);
  const locSelect = document.createElement("select");
  const noneOpt = document.createElement("option");
  noneOpt.value = "";
  noneOpt.textContent = i18n("Не привязана");
  locSelect.appendChild(noneOpt);
  for (const l of locations) {
    const opt = document.createElement("option");
    opt.value = l.id;
    opt.textContent = l.name || i18n("Без имени");
    if (pin.locationId === l.id) opt.selected = true;
    locSelect.appendChild(opt);
  }
  locSelect.addEventListener("change", () => { pin.locationId = locSelect.value || null; persist(); draw(); });
  locField.appendChild(locSelect);
  drawer.appendChild(locField);

  const subField = document.createElement("div");
  subField.className = "field";
  const subLabel = document.createElement("label");
  subLabel.textContent = i18n("Под-карта");
  subField.appendChild(subLabel);
  if (pin.linkedMapId && map.maps[pin.linkedMapId]) {
    const openBtn = document.createElement("button");
    openBtn.className = "btn";
    openBtn.textContent = i18n("Открыть под-карту →");
    openBtn.addEventListener("click", () => {
      stack.push(pin.linkedMapId);
      activePinId = null;
      draw();
    });
    subField.appendChild(openBtn);

    const unlinkBtn = document.createElement("button");
    unlinkBtn.className = "btn danger";
    unlinkBtn.textContent = i18n("Удалить под-карту");
    unlinkBtn.style.marginLeft = "8px";
    unlinkBtn.addEventListener("click", () => {
      if (unlinkBtn.dataset.confirm === "1") {
        for (const id of collectMapIds(pin.linkedMapId)) delete map.maps[id];
        pin.linkedMapId = null;
        persist();
        draw();
        return;
      }
      unlinkBtn.dataset.confirm = "1";
      unlinkBtn.textContent = i18n("Точно? Со всем вложенным");
      setTimeout(() => { unlinkBtn.dataset.confirm = ""; unlinkBtn.textContent = i18n("Удалить под-карту"); }, 3000);
    });
    subField.appendChild(unlinkBtn);
  } else {
    const createBtn = document.createElement("button");
    createBtn.className = "btn";
    createBtn.textContent = i18n("+ Создать под-карту");
    createBtn.addEventListener("click", () => {
      const id = uid();
      map.maps[id] = { id, name: i18n("Новая карта"), imageRelPath: null, pins: [] };
      pin.linkedMapId = id;
      persist();
      stack.push(id);
      activePinId = null;
      draw();
    });
    subField.appendChild(createBtn);
  }
  drawer.appendChild(subField);

  const actions = document.createElement("div");
  actions.className = "drawer-actions";
  const closeBtn = document.createElement("button");
  closeBtn.className = "btn";
  closeBtn.textContent = i18n("Закрыть");
  closeBtn.addEventListener("click", () => { activePinId = null; draw(); });
  const delBtn = document.createElement("button");
  delBtn.className = "btn danger";
  delBtn.textContent = i18n("Удалить метку");
  delBtn.addEventListener("click", () => {
    if (pin.linkedMapId) {
      for (const id of collectMapIds(pin.linkedMapId)) delete map.maps[id];
    }
    cm.pins = cm.pins.filter((p) => p.id !== pin.id);
    activePinId = null;
    persist();
    draw();
  });
  actions.append(closeBtn, delBtn);
  drawer.appendChild(actions);

  return drawer;
}
