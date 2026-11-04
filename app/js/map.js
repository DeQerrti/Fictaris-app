import { apiGet, apiPost, uid } from "./api.js";
import { debounceSave } from "./save-badge.js";
import { characterSelect, escapeHtml, buildEmptyState } from "./chips.js";
import { locationTypeInfo, iconSvg } from "./icons.js";
import { prepareMapImage } from "./image-compress.js";
import { exportElementAsPng } from "./png-export.js";
import { i18n, i18nPlural } from "./i18n.js";
import { writePref, sectionHeading, buildNone, buildLinkRow, openEntity, personAvatarHtml } from "./entity-view.js";

// ══════════════════════════════════════════════
//  КАРТА
//
//  Экран «все карты» и одна карта: масштаб колесом и кнопками, сдвиг
//  перетаскиванием, метки остаются одного размера при любом масштабе и
//  двигаются мышью. Новая метка — двойной щелчок по карте или место из
//  списка «Не отмечены» (перетащить на карту или щёлкнуть, а потом по
//  карте). Щелчок по метке — карточка рядом с ней, «Изменить» — окно со
//  всеми полями метки.
// ══════════════════════════════════════════════

let map = { rootIds: [], maps: {} };
let characters = [];
let locations = [];
let factions = [];
let timeline = [];
let stack = []; // пусто — экран «все карты»; иначе путь от корневой карты до текущей
let activePinId = null; // выбранная метка — карточка рядом с ней
let editPinId = null; // метка, открытая в окне правки
let placingLocationId = null; // место из «Не отмечены», которое ставим щелчком
let query = "";
let container = null;
// Масштаб и сдвиг каждой карты — только на время работы, в данных не
// хранится: { zoom, x, y } в пикселях экрана.
const views = new Map();
let stageApi = null;

// Какие метки видно — предпочтение устройства.
const LAYERS_KEY = "fictaris_map_layers";
const LAYERS = [
  ["places", "Места"],
  ["people", "Персонажи"],
  ["other", "Прочие метки"],
  ["labels", "Подписи"],
];
function readLayers() {
  try {
    return { places: true, people: true, other: true, labels: true, ...JSON.parse(localStorage.getItem(LAYERS_KEY) || "{}") };
  } catch {
    return { places: true, people: true, other: true, labels: true };
  }
}
let layers = readLayers();
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
  [map, characters, locations, factions, timeline] = await Promise.all([
    apiGet("/api/map"),
    apiGet("/api/characters"),
    apiGet("/api/locations"),
    apiGet("/api/factions"),
    apiGet("/api/timeline"),
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
  pane.className = "characters-pane";
  pane.appendChild(buildToolbar());
  const body = document.createElement("div");
  body.className = "map-body";
  body.append(buildStage(), buildSide());
  pane.appendChild(body);
  view.appendChild(pane);

  const pin = currentMap()?.pins.find((p) => p.id === editPinId);
  if (pin) view.appendChild(buildDrawer(pin));

  // Окно правки метки — модальное (style.css, .drawer): клик по
  // затемнению вокруг него закрывает его.
  view.addEventListener("click", (e) => {
    if (e.target === view) { editPinId = null; draw(); }
  });

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
    const empty = buildEmptyState(i18n("Карт пока нет – загрузи изображение, чтобы создать первую."), "map");
    empty.style.gridColumn = "1 / -1";
    grid.appendChild(empty);
  }

  for (const id of map.rootIds) {
    const m = map.maps[id];
    if (!m) continue;
    const card = document.createElement("div");
    card.className = "entity-card map-home-card";

    const open = document.createElement("button");
    open.className = "map-home-open";
    open.innerHTML = `
      <div class="map-card-thumb"${m.imageRelPath ? ` style="background-image:url('/${m.imageRelPath}')"` : ""}>
        ${m.imageRelPath ? "" : iconSvg("map", 30)}
      </div>
      <div class="map-card-footer">
        <div class="char-name">${escapeHtml(m.name || i18n("Без названия"))}</div>
        <div class="char-role">${i18nPlural((m.pins || []).length, ["{n} метка", "{n} метки", "{n} меток"])}</div>
      </div>
    `;
    open.addEventListener("click", () => openMap([id]));
    card.appendChild(open);

    const delBtn = document.createElement("button");
    delBtn.className = "board-column-del";
    delBtn.innerHTML = iconSvg("close", 12);
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
        delBtn.innerHTML = iconSvg("close", 12);
        delBtn.title = i18n("Удалить карту со всеми вложенными под-картами");
      }, 3000);
    });
    card.appendChild(delBtn);

    grid.appendChild(card);
  }

  const addCard = document.createElement("button");
  addCard.className = "entity-card add-card";
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
    const path = await uploadMapImage(file);
    const id = uid();
    map.maps[id] = { id, name: i18n("Новая карта"), imageRelPath: path, pins: [] };
    map.rootIds.push(id);
    persist();
    openMap([id]);
  });
  input.click();
}

function openMap(path) {
  stack = path;
  activePinId = null;
  editPinId = null;
  placingLocationId = null;
  draw();
}

async function uploadMapImage(file) {
  const { base64, ext } = await prepareMapImage(file);
  const { path } = await apiPost("/api/map/image", { data: base64, ext });
  return path;
}

function pickImage(onPath) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (file) onPath(await uploadMapImage(file));
  });
  input.click();
}

function buildUploadPrompt() {
  const wrap = document.createElement("div");
  wrap.className = "empty-state map-upload";
  wrap.innerHTML = `<div class="empty-state-icon">${iconSvg("map", 28)}</div><p>${escapeHtml(i18n("У этой карты пока нет изображения."))}</p>`;
  const btn = document.createElement("button");
  btn.className = "btn characters-add-btn";
  btn.textContent = i18n("Загрузить изображение");
  btn.addEventListener("click", () => pickImage((path) => {
    currentMap().imageRelPath = path;
    persist();
    draw();
  }));
  wrap.appendChild(btn);
  return wrap;
}

// ── Шапка: путь по вложенным картам, счётчик, экспорт ──

function buildToolbar() {
  const bar = document.createElement("div");
  bar.className = "timeline-toolbar map-toolbar";

  const home = document.createElement("button");
  home.className = "btn";
  home.textContent = i18n("← Все карты");
  home.addEventListener("click", () => openMap([]));
  bar.appendChild(home);

  stack.forEach((id, i) => {
    const m = map.maps[id];
    if (!m) return;
    if (i) {
      const sep = document.createElement("span");
      sep.className = "map-breadcrumb-sep";
      sep.textContent = "›";
      bar.appendChild(sep);
    }
    const last = i === stack.length - 1;
    const btn = document.createElement("button");
    btn.className = last ? "map-breadcrumb active timeline-heading" : "map-breadcrumb";
    btn.textContent = m.name || i18n("Без названия");
    btn.title = last ? i18n("Переименовать") : "";
    btn.addEventListener("click", () => {
      if (last) renameCurrentMap(btn);
      else openMap(stack.slice(0, i + 1));
    });
    bar.appendChild(btn);
  });

  const cm = currentMap();
  const subMaps = (cm.pins || []).filter((p) => p.linkedMapId && map.maps[p.linkedMapId]).length;
  const meta = document.createElement("div");
  meta.className = "timeline-meta";
  meta.textContent = [
    i18nPlural((cm.pins || []).length, ["{n} метка", "{n} метки", "{n} меток"]),
    subMaps ? i18nPlural(subMaps, ["{n} под-карта", "{n} под-карты", "{n} под-карт"]) : "",
  ].filter(Boolean).join(" · ");
  bar.appendChild(meta);

  const spacer = document.createElement("div");
  spacer.style.flex = "1";
  bar.appendChild(spacer);

  if (cm.imageRelPath) {
    const exportBtn = document.createElement("button");
    exportBtn.className = "btn";
    exportBtn.innerHTML = `${iconSvg("download", 14)}<span>${escapeHtml(i18n("Экспорт в PNG"))}</span>`;
    exportBtn.addEventListener("click", async () => {
      exportBtn.disabled = true;
      try {
        await stageApi?.exportPng(cm.name || i18n("карта"));
      } catch (e) {
        alert(e.message);
      } finally {
        exportBtn.disabled = false;
      }
    });
    bar.appendChild(exportBtn);
  }
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

// ── Что за метка ───────────────────────────────

function pinKind(pin) {
  if (locById(pin.locationId)) return "places";
  if (charById(pin.characterId)) return "people";
  return "other";
}

function pinVisual(pin) {
  const loc = locById(pin.locationId);
  if (loc) return { color: locationTypeInfo(loc.type)[3], icon: locationTypeInfo(loc.type)[2] };
  const c = charById(pin.characterId);
  if (c) return { color: c.color || "#a4483c", icon: "user" };
  return { color: "#a4483c", icon: "pin" };
}

function pinSubtitle(pin) {
  const loc = locById(pin.locationId);
  if (loc) {
    const hq = factions.filter((f) => f.headquartersId === loc.id).map((f) => f.name);
    const type = i18n(locationTypeInfo(loc.type)[1]);
    return hq.length ? `${type} · ${i18n("штаб: {names}", { names: hq.join(", ") })}` : type;
  }
  const c = charById(pin.characterId);
  if (c) return c.role || i18n("Персонаж");
  return i18n("Метка");
}

function pinMatches(pin) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [pin.label, pin.note, locById(pin.locationId)?.name, charById(pin.characterId)?.name]
    .some((v) => (v || "").toLowerCase().includes(q));
}

// Места, которых нет ни на одной карте мира.
function unpinnedLocations() {
  const pinned = new Set();
  for (const m of Object.values(map.maps || {})) for (const p of m.pins || []) if (p.locationId) pinned.add(p.locationId);
  return locations.filter((l) => !pinned.has(l.id));
}

function addPin(x, y, fields = {}) {
  const pin = { id: uid(), x, y, label: i18n("Новая метка"), note: "", characterId: null, locationId: null, linkedMapId: null, ...fields };
  currentMap().pins.push(pin);
  activePinId = pin.id;
  placingLocationId = null;
  persist();
  draw();
}

function addLocationPin(locId, x, y) {
  const loc = locById(locId);
  if (!loc) return;
  addPin(x, y, { label: loc.name || i18n("Без имени"), locationId: loc.id });
}

// ── Холст: масштаб, сдвиг, метки ───────────────

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

function buildStage() {
  const cm = currentMap();
  const stage = document.createElement("div");
  stage.className = "map-stage" + (placingLocationId ? " placing" : "");
  stageApi = null;
  if (!cm.imageRelPath) {
    stage.appendChild(buildUploadPrompt());
    return stage;
  }

  const world = document.createElement("div");
  world.className = "map-world" + (layers.labels ? "" : " no-labels");
  const img = document.createElement("img");
  img.src = `/${cm.imageRelPath}`;
  img.draggable = false;
  img.alt = "";
  world.appendChild(img);

  const markers = new Map();
  for (const pin of cm.pins) {
    if (!layers[pinKind(pin)]) continue;
    const marker = buildPinMarker(pin);
    markers.set(pin.id, marker);
    world.appendChild(marker);
  }
  stage.appendChild(world);

  const popupHost = document.createElement("div");
  popupHost.className = "map-popup-host";
  stage.appendChild(popupHost);

  // Размер картинки известен только после загрузки — до этого вид не
  // посчитать (вписать, центр, место карточки).
  let size = null;
  let view = views.get(cm.id) || null;
  const apply = () => {
    if (!size || !view) return;
    world.style.width = `${size.w}px`;
    world.style.height = `${size.h}px`;
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
    world.style.setProperty("--inv", String(1 / view.zoom));
    zoomLabel.textContent = `${Math.round(view.zoom * 100)}%`;
    placePopup();
  };
  const fit = () => {
    if (!size) return;
    const r = stage.getBoundingClientRect();
    const zoom = Math.min(r.width / size.w, r.height / size.h) * 0.94;
    view = { zoom, x: (r.width - size.w * zoom) / 2, y: (r.height - size.h * zoom) / 2 };
    views.set(cm.id, view);
    apply();
  };
  const zoomAt = (factor, cx, cy) => {
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
    view.x = cx - ((cx - view.x) * zoom) / view.zoom;
    view.y = cy - ((cy - view.y) * zoom) / view.zoom;
    view.zoom = zoom;
    apply();
  };
  // Точка экрана → проценты картинки (так хранятся метки).
  const toPercent = (clientX, clientY) => {
    const r = stage.getBoundingClientRect();
    const x = ((clientX - r.left - view.x) / view.zoom / size.w) * 100;
    const y = ((clientY - r.top - view.y) / view.zoom / size.h) * 100;
    return { x: Math.min(100, Math.max(0, x)), y: Math.min(100, Math.max(0, y)) };
  };
  const onImage = (clientX, clientY) => {
    const p = toPercent(clientX, clientY);
    const r = stage.getBoundingClientRect();
    const rawX = (clientX - r.left - view.x) / view.zoom;
    const rawY = (clientY - r.top - view.y) / view.zoom;
    return rawX >= 0 && rawY >= 0 && rawX <= size.w && rawY <= size.h ? p : null;
  };

  function placePopup() {
    popupHost.innerHTML = "";
    const pin = cm.pins.find((p) => p.id === activePinId);
    if (!pin || !size || !view || !markers.has(pin.id)) return;
    const card = buildPinCard(pin);
    const px = view.x + (pin.x / 100) * size.w * view.zoom;
    const py = view.y + (pin.y / 100) * size.h * view.zoom;
    const r = stage.getBoundingClientRect();
    // Справа от метки, а у правого края — слева от неё.
    const right = px + 28 + 320 < r.width;
    card.style.left = `${right ? px + 28 : Math.max(8, px - 28 - 320)}px`;
    card.style.top = `${Math.min(Math.max(8, py - 60), Math.max(8, r.height - 260))}px`;
    popupHost.appendChild(card);
  }

  img.addEventListener("load", () => {
    size = { w: img.naturalWidth, h: img.naturalHeight };
    if (view) apply();
    else fit();
  });

  // Колесо — масштаб вокруг курсора.
  stage.addEventListener("wheel", (e) => {
    if (!view) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  // Сдвиг — перетаскиванием фона; два пальца — масштаб. Метки ловят
  // свои нажатия сами (buildPinMarker) и сюда не доходят.
  const pointers = new Map();
  let pan = null;
  let pinch = null;
  stage.addEventListener("pointerdown", (e) => {
    if (!view || e.target.closest(".map-marker, .map-popup, .map-zoom, .map-upload")) return;
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) pan = { x: e.clientX, y: e.clientY, moved: false };
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) };
      pan = null;
    }
  });
  stage.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const r = stage.getBoundingClientRect();
      zoomAt(dist / pinch.dist, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      pinch.dist = dist;
      return;
    }
    if (!pan) return;
    const dx = e.clientX - pan.x;
    const dy = e.clientY - pan.y;
    if (!pan.moved && Math.hypot(dx, dy) < 4) return;
    pan.moved = true;
    stage.classList.add("panning");
    view.x += dx;
    view.y += dy;
    pan.x = e.clientX;
    pan.y = e.clientY;
    apply();
  });
  const endPointer = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pan && !pan.moved && e.type === "pointerup") {
      // Простой щелчок по карте: ставим выбранное место или снимаем выбор.
      if (placingLocationId) {
        const p = onImage(e.clientX, e.clientY);
        if (p) addLocationPin(placingLocationId, p.x, p.y);
      } else if (activePinId) {
        activePinId = null;
        placePopup();
        markers.forEach((m) => m.classList.remove("active"));
      }
    }
    pan = null;
    stage.classList.remove("panning");
  };
  stage.addEventListener("pointerup", endPointer);
  stage.addEventListener("pointercancel", endPointer);

  // Двойной щелчок — новая метка там, где щёлкнули.
  stage.addEventListener("dblclick", (e) => {
    if (!view || e.target.closest(".map-marker, .map-popup, .map-zoom")) return;
    const p = onImage(e.clientX, e.clientY);
    if (p) addPin(p.x, p.y);
  });

  // Место из списка «Не отмечены» — перетаскиванием прямо на карту.
  stage.addEventListener("dragover", (e) => {
    if (e.dataTransfer.types.includes("application/x-fictaris-location")) e.preventDefault();
  });
  stage.addEventListener("drop", (e) => {
    const locId = e.dataTransfer.getData("application/x-fictaris-location");
    if (!locId || !view) return;
    e.preventDefault();
    const p = onImage(e.clientX, e.clientY);
    if (p) addLocationPin(locId, p.x, p.y);
  });

  // Метки: щелчок — выбрать, перетаскивание — передвинуть.
  for (const [id, marker] of markers) {
    const pin = cm.pins.find((p) => p.id === id);
    marker.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      marker.setPointerCapture(e.pointerId);
      const start = { x: e.clientX, y: e.clientY };
      let moved = false;
      const move = (ev) => {
        if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return;
        moved = true;
        marker.classList.add("dragging");
        const p = toPercent(ev.clientX, ev.clientY);
        pin.x = p.x;
        pin.y = p.y;
        marker.style.left = `${pin.x}%`;
        marker.style.top = `${pin.y}%`;
        placePopup();
      };
      const up = () => {
        marker.removeEventListener("pointermove", move);
        marker.removeEventListener("pointerup", up);
        marker.removeEventListener("pointercancel", up);
        marker.classList.remove("dragging");
        if (moved) {
          persist();
          return;
        }
        activePinId = pin.id;
        markers.forEach((m, mid) => m.classList.toggle("active", mid === pin.id));
        placePopup();
      };
      marker.addEventListener("pointermove", move);
      marker.addEventListener("pointerup", up);
      marker.addEventListener("pointercancel", up);
    });
    marker.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      editPinId = pin.id;
      draw();
    });
  }

  // Кнопки масштаба.
  const zoomBar = document.createElement("div");
  zoomBar.className = "map-zoom";
  const zoomBtn = (label, title, onClick) => {
    const b = document.createElement("button");
    b.innerHTML = label;
    b.title = title;
    b.addEventListener("click", onClick);
    return b;
  };
  const center = (factor) => {
    const r = stage.getBoundingClientRect();
    zoomAt(factor, r.width / 2, r.height / 2);
  };
  const zoomLabel = document.createElement("span");
  zoomBar.append(
    zoomBtn("−", i18n("Уменьшить"), () => center(1 / 1.25)),
    zoomLabel,
    zoomBtn("+", i18n("Увеличить"), () => center(1.25)),
    zoomBtn(iconSvg("focus", 14), i18n("Вписать"), fit),
  );
  stage.appendChild(zoomBar);

  const hint = document.createElement("div");
  hint.className = "map-hint";
  hint.textContent = placingLocationId
    ? i18n("Щёлкните по карте, чтобы отметить «{name}». Esc – отмена.", { name: locById(placingLocationId)?.name || "" })
    : i18n("Колесо – масштаб, перетаскивание – сдвиг, двойной щелчок – новая метка.");
  stage.appendChild(hint);

  stageApi = {
    centerOn(pin) {
      if (!size || !view) return;
      const r = stage.getBoundingClientRect();
      view.x = r.width / 2 - (pin.x / 100) * size.w * view.zoom;
      view.y = r.height / 2 - (pin.y / 100) * size.h * view.zoom;
      apply();
    },
    // PNG — в натуральную величину, без текущего масштаба и сдвига.
    async exportPng(name) {
      if (!size) return;
      const saved = { ...view };
      view = { zoom: 1, x: 0, y: 0 };
      apply();
      popupHost.innerHTML = "";
      try {
        const safeName = name.replace(/[^a-zA-Zа-яА-Я0-9_\- ]/g, "").trim() || "fictaris";
        await exportElementAsPng(world, `${safeName}.png`);
      } finally {
        view = saved;
        views.set(cm.id, view);
        apply();
      }
    },
  };
  return stage;
}

function buildPinMarker(pin) {
  const { color, icon } = pinVisual(pin);
  const marker = document.createElement("button");
  marker.className = "map-marker" + (pin.id === activePinId ? " active" : "");
  marker.style.left = `${pin.x}%`;
  marker.style.top = `${pin.y}%`;
  marker.style.setProperty("--pin-color", color);
  marker.title = pin.label || "";
  marker.innerHTML = `<span class="map-marker-dot">${iconSvg(icon, 16)}</span>${pin.label ? `<span class="map-marker-label">${escapeHtml(pin.label)}</span>` : ""}`;
  return marker;
}

// Карточка выбранной метки: что это, что здесь было, куда перейти.
function buildPinCard(pin) {
  const { color, icon } = pinVisual(pin);
  const loc = locById(pin.locationId);
  const person = charById(pin.characterId);
  const card = document.createElement("div");
  card.className = "map-popup";
  const text = pin.note || loc?.description || "";
  const events = loc ? timeline.filter((e) => (e.locationIds || []).includes(loc.id)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : [];
  card.innerHTML = `
    <div class="map-popup-head">
      ${person && !loc ? personAvatarHtml(person, "cast-avatar cast-avatar-md") : `<span class="cast-avatar cast-avatar-md" style="background:${color}">${iconSvg(icon, 18)}</span>`}
      <div><b>${escapeHtml(pin.label || i18n("Без названия"))}</b><small>${escapeHtml(pinSubtitle(pin))}</small></div>
    </div>
    ${text ? `<p>${escapeHtml(text)}</p>` : ""}
    ${events.length ? `<div class="map-popup-row">${iconSvg("clock", 13)}<span>${escapeHtml(events.map((e) => e.title).join(", "))}</span></div>` : ""}
  `;
  const actions = document.createElement("div");
  actions.className = "map-popup-actions";
  const btn = (label, onClick, primary) => {
    const b = document.createElement("button");
    b.className = "btn" + (primary ? " characters-add-btn" : "");
    b.textContent = label;
    b.addEventListener("click", onClick);
    actions.appendChild(b);
  };
  const inner = pin.linkedMapId && map.maps[pin.linkedMapId];
  if (inner) btn(i18n("Войти: «{name}» →", { name: inner.name || i18n("Без названия") }), () => openMap([...stack, inner.id]), true);
  if (loc) btn(i18n("Открыть место"), () => openEntity("location", loc.id));
  if (person) btn(i18n("Открыть персонажа"), () => openEntity("character", person.id));
  btn(i18n("Изменить"), () => {
    editPinId = pin.id;
    draw();
  });
  card.appendChild(actions);
  return card;
}

// ── Боковая панель ─────────────────────────────

function buildSide() {
  const cm = currentMap();
  const side = document.createElement("aside");
  side.className = "map-side";

  const search = document.createElement("input");
  search.type = "search";
  search.className = "characters-search";
  search.placeholder = i18n("Найти на карте…");
  search.value = query;
  search.addEventListener("input", () => {
    query = search.value;
    lists.replaceWith(lists = buildSideLists(cm));
  });
  side.appendChild(search);

  side.appendChild(sectionHeading(i18n("Слои")));
  const counts = { places: 0, people: 0, other: 0 };
  for (const p of cm.pins) counts[pinKind(p)]++;
  for (const [key, label] of LAYERS) {
    const row = document.createElement("label");
    row.className = "map-layer";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = layers[key];
    box.addEventListener("change", () => {
      layers = { ...layers, [key]: box.checked };
      writePref(LAYERS_KEY, JSON.stringify(layers));
      draw();
    });
    const name = document.createElement("span");
    name.textContent = i18n(label);
    row.append(box, name);
    if (key in counts) {
      const n = document.createElement("small");
      n.textContent = counts[key];
      row.appendChild(n);
    }
    side.appendChild(row);
  }

  let lists = buildSideLists(cm);
  side.appendChild(lists);

  if (cm.imageRelPath) {
    const replace = document.createElement("button");
    replace.className = "btn map-side-replace";
    replace.textContent = i18n("Заменить изображение…");
    replace.title = i18n("Метки останутся на тех же местах в процентах от картинки");
    replace.addEventListener("click", () => pickImage((path) => {
      cm.imageRelPath = path;
      views.delete(cm.id);
      persist();
      draw();
    }));
    side.appendChild(replace);
  }
  return side;
}

function buildSideLists(cm) {
  const wrap = document.createElement("div");
  const pins = cm.pins.filter(pinMatches);

  wrap.appendChild(sectionHeading(i18n("На этой карте")));
  for (const pin of pins) {
    const { color, icon } = pinVisual(pin);
    const lead = `<span class="cast-avatar cast-avatar-xs" style="background:${color}">${iconSvg(icon, 12)}</span>`;
    const row = buildLinkRow(lead, pin.label || i18n("Без названия"), pin.linkedMapId && map.maps[pin.linkedMapId] ? i18n("своя карта") : pinSubtitle(pin), () => {
      activePinId = pin.id;
      if (!layers[pinKind(pin)]) {
        layers = { ...layers, [pinKind(pin)]: true };
        writePref(LAYERS_KEY, JSON.stringify(layers));
      }
      draw();
      requestAnimationFrame(() => stageApi?.centerOn(pin));
    });
    if (pin.id === activePinId) row.classList.add("active");
    wrap.appendChild(row);
  }
  if (!pins.length) wrap.appendChild(buildNone(cm.pins.length ? i18n("Ничего не нашлось.") : i18n("Меток пока нет")));

  const q = query.trim().toLowerCase();
  const loose = unpinnedLocations().filter((l) => !q || (l.name || "").toLowerCase().includes(q));
  if (loose.length && cm.imageRelPath) {
    wrap.appendChild(sectionHeading(i18n("Не отмечены")));
    for (const l of loose) {
      const [, , icon, color] = locationTypeInfo(l.type);
      const lead = `<span class="cast-avatar cast-avatar-xs" style="background:${color}">${iconSvg(icon, 12)}</span>`;
      const row = buildLinkRow(lead, l.name || i18n("Без имени"), placingLocationId === l.id ? i18n("щёлкните по карте") : i18n("перетащите на карту"), () => {
        placingLocationId = placingLocationId === l.id ? null : l.id;
        draw();
      });
      row.classList.add("map-unpinned");
      if (placingLocationId === l.id) row.classList.add("active");
      row.draggable = true;
      row.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("application/x-fictaris-location", l.id);
        e.dataTransfer.effectAllowed = "copy";
      });
      wrap.appendChild(row);
    }
  }

  const inner = cm.pins.filter((p) => p.linkedMapId && map.maps[p.linkedMapId]);
  if (inner.length) {
    wrap.appendChild(sectionHeading(i18n("Вложенные карты")));
    for (const p of inner) {
      const m = map.maps[p.linkedMapId];
      wrap.appendChild(buildLinkRow(`<span class="dossier-row-icon">${iconSvg("map", 13)}</span>`, m.name || i18n("Без названия"),
        i18nPlural((m.pins || []).length, ["{n} метка", "{n} метки", "{n} меток"]), () => openMap([...stack, m.id])));
    }
  }
  return wrap;
}

// Esc — отменить постановку места или снять выбор метки.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !container?.isConnected || !stack.length || editPinId) return;
  if (placingLocationId || activePinId) {
    placingLocationId = null;
    activePinId = null;
    draw();
  }
});

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
    openBtn.addEventListener("click", () => openMap([...stack, pin.linkedMapId]));
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
      openMap([...stack, id]);
    });
    subField.appendChild(createBtn);
  }
  drawer.appendChild(subField);

  const actions = document.createElement("div");
  actions.className = "drawer-actions";
  const closeBtn = document.createElement("button");
  closeBtn.className = "btn";
  closeBtn.textContent = i18n("Закрыть");
  closeBtn.addEventListener("click", () => { editPinId = null; draw(); });
  const delBtn = document.createElement("button");
  delBtn.className = "btn danger";
  delBtn.textContent = i18n("Удалить метку");
  delBtn.addEventListener("click", () => {
    if (pin.linkedMapId) {
      for (const id of collectMapIds(pin.linkedMapId)) delete map.maps[id];
    }
    cm.pins = cm.pins.filter((p) => p.id !== pin.id);
    activePinId = null;
    editPinId = null;
    persist();
    draw();
  });
  actions.append(closeBtn, delBtn);
  drawer.appendChild(actions);

  return drawer;
}
