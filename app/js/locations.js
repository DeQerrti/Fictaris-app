import { apiGet, apiPost, uid } from "./api.js";
import { debounceSave } from "./save-badge.js";
import { escapeHtml, centerGridIfSparse, buildEmptyState } from "./chips.js";
import { pushTrash } from "./trash.js";
import { LOCATION_TYPES, locationTypeInfo, iconSvg } from "./icons.js";
import { buildReverseLinks } from "./reverse-links.js";
import { loadTagsMap, buildTagsField } from "./tags.js";
import { buildNameGeneratorButton } from "./name-generator.js";
import { avatarInnerHtml, buildAvatarsField } from "./avatars.js";
import { loadTemplates, saveTemplates, templateFor, buildFieldHint } from "./templates.js";
import { openEntitySheet } from "./entity-sheet.js";
import { chooseTemplate } from "./template-choice.js";
import { openTemplateEditorModal } from "./template-editor-modal.js";
import { i18n } from "./i18n.js";

let locations = [];
let timeline = [];
let factions = [];
let mapData = { maps: {} };
let tagsMap = {};
let templates = [];
let activeId = null;
let container = null;
const save = debounceSave((list) => apiPost("/api/locations", list));

function persist() {
  save(locations);
}

function addWithTemplate(templateId) {
  const loc = blank(templateId);
  locations.push(loc);
  activeId = loc.id;
  persist();
  draw();
}

// "+ Новый шаблон…" в меню выбора — см. тот же приём в characters.js.
function addWithNewTemplate() {
  openTemplateEditorModal({
    initialFields: (templates[0]?.fields || []).map((f) => ({ ...f })),
    onSave: async ({ name, fields }) => {
      const fresh = { id: `t_${Date.now().toString(36)}`, name, fields };
      templates = [...templates, fresh];
      await saveTemplates("locations", templates);
      addWithTemplate(fresh.id);
    },
  });
}

function blank(templateId) {
  return {
    id: uid(),
    name: i18n("Новая локация"),
    type: "settlement",
    tags: "",
    parentId: null,
    templateId: templateId || templates[0]?.id || "default",
  };
}

// ── Вложенность (королевство → область → город и т.п.) ─────────
// parentId — обычная ссылка на другую локацию, как headquartersId у
// фракции. Проверка циклов — только на выбор родителя в дровере
// (descendantIds ниже); сам обход дерева ещё и защищён на случай
// испорченных данных (импорт, ручная правка JSON) — see orderedTree.

// Все потомки локации (рекурсивно) — чтобы нельзя было выбрать своего
// же потомка родителем и завести цикл.
function descendantIds(id) {
  const ids = new Set();
  function walk(pid) {
    for (const l of locations) {
      if (l.parentId === pid && !ids.has(l.id)) {
        ids.add(l.id);
        walk(l.id);
      }
    }
  }
  walk(id);
  return ids;
}

// Порядок обхода для сетки: сначала локация, сразу за ней — все её
// потомки (глубина в depth, красится отступом в CSS) — вместо плоского
// списка, где город и содержащее его королевство могли оказаться в
// разных концах сетки. parentId, ссылающийся на несуществующую или
// удалённую локацию, трактуется как "нет родителя" — не теряем
// локацию из вида, а поднимаем её на верхний уровень.
function orderedTree() {
  const byId = new Set(locations.map((l) => l.id));
  const byParent = new Map();
  for (const loc of locations) {
    const key = loc.parentId && byId.has(loc.parentId) ? loc.parentId : null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(loc);
  }
  const out = [];
  function walk(parentId, depth, path) {
    for (const loc of byParent.get(parentId) || []) {
      if (path.has(loc.id)) continue; // страховка от цикла в испорченных данных
      out.push({ loc, depth });
      walk(loc.id, depth + 1, new Set(path).add(loc.id));
    }
  }
  walk(null, 0, new Set());
  return out;
}

export async function renderLocations(root, focusId) {
  container = root;
  [locations, timeline, factions, mapData, tagsMap, templates] = await Promise.all([
    apiGet("/api/locations"),
    apiGet("/api/timeline"),
    apiGet("/api/factions"),
    apiGet("/api/map"),
    loadTagsMap(),
    loadTemplates("locations"),
  ]);
  if (focusId && locations.some((l) => l.id === focusId)) activeId = focusId;
  draw();
}

function reverseLinksFor(loc) {
  const eventRows = timeline
    .filter((e) => (e.locationIds || []).includes(loc.id))
    .map((e) => `${e.title}${e.date ? ` (${e.date})` : ""}`);

  const factionRows = factions
    .filter((f) => f.headquartersId === loc.id)
    .map((f) => i18n("{name} (штаб-квартира)", f));

  const pinRows = [];
  for (const m of Object.values(mapData.maps || {})) {
    for (const pin of m.pins || []) {
      if (pin.locationId === loc.id) pinRows.push(i18n("{label} (карта «{name}»)", { label: pin.label, name: m.name }));
    }
  }

  return buildReverseLinks([
    [i18n("Таймлайн"), eventRows],
    [i18n("Фракции"), factionRows],
    [i18n("Метки на карте"), pinRows],
  ]);
}

function draw() {
  container.innerHTML = "";
  const view = document.createElement("div");
  view.className = "characters-view";

  const grid = document.createElement("div");
  grid.className = "characters-grid";

  if (!locations.length) {
    const empty = buildEmptyState(i18n("Локаций пока нет — добавь первую."), "pin");
    empty.style.gridColumn = "1 / -1";
    grid.appendChild(empty);
  }

  for (const { loc, depth } of orderedTree()) {
    const [, , iconName, color] = locationTypeInfo(loc.type);
    const parent = loc.parentId && locations.find((l) => l.id === loc.parentId);
    const card = document.createElement("button");
    card.className = "char-card loc-card" + (depth ? " loc-child" : "");
    if (depth) card.style.setProperty("--loc-depth", depth);
    card.innerHTML = `
      <div class="char-avatar" style="background:${color}">${avatarInnerHtml(loc, iconSvg(iconName, 30))}</div>
      <div class="char-card-body">
        <div class="char-name">${escapeHtml(loc.name || i18n("Без имени"))}</div>
        <div class="char-role">${escapeHtml(i18n(locationTypeInfo(loc.type)[1]))}</div>
        ${parent ? `<div class="loc-parent-badge">${escapeHtml(i18n("в составе: {name}", { name: parent.name || i18n("Без имени") }))}</div>` : ""}
      </div>
    `;
    card.addEventListener("click", () => openSheet(loc));
    grid.appendChild(card);
  }

  const addCard = document.createElement("button");
  addCard.className = "char-card add-card";
  addCard.textContent = i18n("+ Добавить локацию");
  addCard.title = i18n("Правая кнопка — выбрать шаблон анкеты или завести новый");
  addCard.addEventListener("click", () => {
    chooseTemplate(templates, addCard, addWithTemplate, { onCreateNew: addWithNewTemplate });
  });
  addCard.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    chooseTemplate(templates, addCard, addWithTemplate, { forceMenu: true, onCreateNew: addWithNewTemplate });
  });
  grid.appendChild(addCard);

  view.appendChild(grid);

  const active = locations.find((l) => l.id === activeId);
  if (active) view.appendChild(buildDrawer(active));

  container.appendChild(view);
  centerGridIfSparse(grid);
}

// Дочерние локации — тем же приёмом, что buildFamilySection у детей
// персонажа (characters.js): просто список имён, без отдельной кнопки
// перехода — щёлкнуть по нужной проще прямо в сетке (она уже стоит
// рядом, отступом ниже).
function childrenSection(loc) {
  const kids = locations.filter((l) => l.parentId === loc.id);
  if (!kids.length) return null;
  const wrap = document.createElement("div");
  wrap.className = "sheet-fields";
  const row = document.createElement("div");
  row.className = "sheet-field";
  const lab = document.createElement("div");
  lab.className = "sheet-field-label";
  lab.textContent = i18n("Локации внутри");
  const val = document.createElement("div");
  val.className = "sheet-field-value";
  val.textContent = kids.map((k) => k.name || i18n("Без имени")).join(", ");
  row.append(lab, val);
  wrap.appendChild(row);
  return wrap;
}

function openSheet(loc) {
  const [, typeLabel, iconName, color] = locationTypeInfo(loc.type);
  const template = templateFor(templates, loc.templateId);
  const parent = loc.parentId && locations.find((l) => l.id === loc.parentId);
  openEntitySheet({
    entity: loc,
    avatarColor: color,
    avatarHtml: avatarInnerHtml(loc, iconSvg(iconName, 30)),
    title: loc.name || i18n("Без имени"),
    subtitle: i18n(typeLabel),
    fields: [
      ...(parent ? [{ label: i18n("Родительская локация"), value: parent.name }] : []),
      ...(template?.fields || []).map((f) => ({ label: f.label, value: loc[f.key], type: f.type })),
    ],
    extraSections: [childrenSection(loc), reverseLinksFor(loc)],
    onEdit: () => {
      activeId = loc.id;
      draw();
    },
  });
}

function buildDrawer(loc) {
  const drawer = document.createElement("div");
  drawer.className = "drawer";

  const nameRow = document.createElement("div");
  nameRow.className = "drawer-name-row";
  const nameField = document.createElement("input");
  nameField.value = loc.name;
  nameField.className = "drawer-name-field";
  nameField.addEventListener("input", () => {
    loc.name = nameField.value;
    persist();
  });
  nameRow.appendChild(nameField);
  nameRow.appendChild(
    buildNameGeneratorButton((name) => {
      nameField.value = name;
      loc.name = name;
      persist();
    }, "place")
  );
  drawer.appendChild(nameRow);

  const typeField = document.createElement("div");
  typeField.className = "field";
  typeField.style.marginTop = "14px";
  const typeLabel = document.createElement("label");
  typeLabel.textContent = i18n("Тип");
  typeField.appendChild(typeLabel);
  const typeSelect = document.createElement("select");
  for (const [value, label] of LOCATION_TYPES) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = i18n(label);
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

  const parentField = document.createElement("div");
  parentField.className = "field";
  const parentLabel = document.createElement("label");
  parentLabel.textContent = i18n("Родительская локация");
  parentField.appendChild(parentLabel);
  const parentSelect = document.createElement("select");
  const noneOpt = document.createElement("option");
  noneOpt.value = "";
  noneOpt.textContent = i18n("— нет (верхний уровень) —");
  parentSelect.appendChild(noneOpt);
  const excluded = descendantIds(loc.id);
  excluded.add(loc.id);
  for (const other of locations) {
    if (excluded.has(other.id)) continue;
    const opt = document.createElement("option");
    opt.value = other.id;
    opt.textContent = other.name || i18n("Без имени");
    if (loc.parentId === other.id) opt.selected = true;
    parentSelect.appendChild(opt);
  }
  parentSelect.addEventListener("change", () => {
    loc.parentId = parentSelect.value || null;
    persist();
    draw();
  });
  parentField.appendChild(parentSelect);
  drawer.appendChild(parentField);

  drawer.appendChild(buildAvatarsField(loc, () => { persist(); draw(); }));

  const template = templateFor(templates, loc.templateId);
  for (const f of template?.fields || []) {
    const field = document.createElement("div");
    field.className = "field";
    const lab = document.createElement("label");
    lab.textContent = f.label;
    field.appendChild(lab);
    const hint = buildFieldHint(f.type);
    if (hint) field.appendChild(hint);
    const input = document.createElement(f.type === "input" ? "input" : "textarea");
    input.value = loc[f.key] || "";
    input.addEventListener("input", () => {
      loc[f.key] = input.value;
      persist();
    });
    field.appendChild(input);
    drawer.appendChild(field);
  }

  drawer.appendChild(
    buildTagsField(tagsMap, loc.tags, (value) => {
      loc.tags = value;
      persist();
    })
  );

  const reverse = reverseLinksFor(loc);
  if (reverse) drawer.appendChild(reverse);

  const actions = document.createElement("div");
  actions.className = "drawer-actions";
  const closeBtn = document.createElement("button");
  closeBtn.className = "btn";
  closeBtn.textContent = i18n("Закрыть");
  closeBtn.addEventListener("click", () => {
    activeId = null;
    draw();
  });
  const delBtn = document.createElement("button");
  delBtn.className = "btn danger";
  delBtn.textContent = i18n("Удалить");
  delBtn.addEventListener("click", async () => {
    await pushTrash("location", loc);
    locations = locations.filter((x) => x.id !== loc.id);
    // Дети удалённой локации не исчезают вместе с ней — поднимаются на
    // верхний уровень, а не остаются висеть на несуществующем parentId.
    for (const l of locations) if (l.parentId === loc.id) l.parentId = null;
    activeId = null;
    persist();
    draw();
  });
  actions.append(closeBtn, delBtn);
  drawer.appendChild(actions);

  return drawer;
}
