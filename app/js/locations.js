import { apiGet, apiPost, uid } from "./api.js";
import { debounceSave } from "./save-badge.js";
import { escapeHtml, buildEmptyState } from "./chips.js";
import { pushTrash } from "./trash.js";
import { LOCATION_TYPES, locationTypeInfo, factionTypeInfo, iconSvg } from "./icons.js";
import { loadTagsMap, buildTagsField, parseTags } from "./tags.js";
import { buildNameGeneratorButton } from "./name-generator.js";
import { avatarInnerHtml, buildAvatarsField } from "./avatars.js";
import { loadTemplates, saveTemplates, templateFor } from "./templates.js";
import { chooseTemplate } from "./template-choice.js";
import { openTemplateEditorModal } from "./template-editor-modal.js";
import { closeEntityModal } from "./entity-modal.js";
import { chapterLabel } from "./books.js";
import { drawingSvg } from "./map-draw.js";
import { i18n, i18nPlural } from "./i18n.js";
import {
  readPref, writePref, buildSegmented, buildEntityToolbar, buildOverviewSection, buildDossierList, buildDossierSplit,
  updateListRow, sectionHeading, buildNone, buildFact, buildFactText, buildSelect, buildNameInput, buildTemplateFields,
  buildLinkRow, iconLead, buildEventRow, openEntity, personAvatarHtml,
} from "./entity-view.js";

// ══════════════════════════════════════════════
//  ЛОКАЦИИ
//
//  «Обзор» — места карточками, сгруппированными по карте, типу или
//  вложенности; сверху карточки — кусок карты вокруг метки места.
//  «Атлас» — список слева, страница места справа: карта с подсвеченной
//  меткой, анкета, что здесь происходит (события таймлайна), кто здесь
//  бывает, чья это штаб-квартира, что внутри.
// ══════════════════════════════════════════════

const MODE_KEY = "fictaris_locations_mode";
const GROUP_KEY = "fictaris_locations_group";
const MODES = [
  ["overview", "Обзор", "Все места карточками"],
  ["atlas", "Атлас", "Список слева, страница места справа"],
];
const GROUPS = [
  ["map", "По карте"],
  ["type", "По типу"],
  ["nesting", "По вложенности"],
];

let locations = [];
let characters = [];
let timeline = [];
let factions = [];
let mapData = { maps: {} };
let manuscript = { chapters: [] };
let tagsMap = {};
let templates = [];
let activeId = null;
let container = null;
let inModal = false;
let query = "";
let mode = readPref(MODE_KEY, MODES.map(([k]) => k), "overview");
let groupBy = readPref(GROUP_KEY, GROUPS.map(([k]) => k), "map");
let bodyEl = null;
let metaEl = null;
const save = debounceSave((list) => apiPost("/api/locations", list));

function persist() {
  save(locations);
}

function addWithTemplate(templateId, parentId = null) {
  const loc = blank(templateId);
  loc.parentId = parentId;
  locations.push(loc);
  activeId = loc.id;
  if (!inModal) {
    mode = "atlas";
    writePref(MODE_KEY, mode);
  }
  persist();
  draw();
  const name = container.querySelector(".dossier-name");
  name?.focus();
  name?.select();
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
// фракции. Проверка циклов — только на выбор родителя (descendantIds
// ниже); сам обход дерева ещё и защищён на случай испорченных данных
// (импорт, ручная правка JSON) — см. orderedTree.

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

// Порядок обхода: сначала локация, сразу за ней — все её потомки.
// parentId, ссылающийся на несуществующую или удалённую локацию,
// трактуется как "нет родителя" — не теряем локацию из вида, а
// поднимаем её на верхний уровень.
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

function parentOf(loc) {
  return loc.parentId ? locations.find((l) => l.id === loc.parentId) || null : null;
}

export async function renderLocations(root, focusId) {
  container = root;
  inModal = root.classList.contains("entity-modal-body");
  [locations, characters, timeline, factions, mapData, manuscript, tagsMap, templates] = await Promise.all([
    apiGet("/api/locations"),
    apiGet("/api/characters"),
    apiGet("/api/timeline"),
    apiGet("/api/factions"),
    apiGet("/api/map"),
    apiGet("/api/manuscript"),
    loadTagsMap(),
    loadTemplates("locations"),
  ]);
  if (focusId && locations.some((l) => l.id === focusId)) {
    activeId = focusId;
    if (!inModal) {
      mode = "atlas";
      writePref(MODE_KEY, mode);
    }
  }
  draw();
}

// ── Что известно о месте ───────────────────────

function mapsInOrder() {
  const maps = mapData.maps || {};
  const ids = [...(mapData.rootIds || []), ...Object.keys(maps)];
  return [...new Set(ids)].map((id) => maps[id]).filter(Boolean);
}

function pinsOf(loc) {
  const pins = [];
  for (const m of mapsInOrder()) for (const pin of m.pins || []) if (pin.locationId === loc.id) pins.push({ map: m, pin });
  return pins;
}

function placeInfo(loc) {
  const events = timeline
    .filter((e) => (e.locationIds || []).includes(loc.id))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const hqOf = factions.filter((f) => f.headquartersId === loc.id);
  const pins = pinsOf(loc);
  // Кто здесь бывает: участники событий, главы и состав фракций со
  // штабом здесь, метки персонажей на вложенной карте этого места.
  const counts = new Map();
  const bump = (id) => counts.set(id, (counts.get(id) || 0) + 1);
  for (const e of events) (e.characterIds || []).forEach(bump);
  for (const f of hqOf) [f.leaderId, ...(f.memberIds || [])].filter(Boolean).forEach(bump);
  for (const { pin } of pins) {
    const inner = pin.linkedMapId && mapData.maps?.[pin.linkedMapId];
    for (const p of inner?.pins || []) if (p.characterId) bump(p.characterId);
  }
  const people = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => characters.find((c) => c.id === id))
    .filter(Boolean);
  const chapters = (manuscript.chapters || []).filter((ch) => (ch.locationIds || []).includes(loc.id));
  const children = locations.filter((l) => l.parentId === loc.id);
  return { events, hqOf, pins, people, chapters, children, parent: parentOf(loc) };
}

function matches(loc) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const typeLabel = i18n(locationTypeInfo(loc.type)[1]);
  return [loc.name, typeLabel, loc.tags, loc.description].some((s) => (s || "").toLowerCase().includes(q));
}

function tileHtml(loc, cls, size) {
  const [, , iconName, color] = locationTypeInfo(loc.type);
  return `<div class="${cls}" style="background:${color}">${avatarInnerHtml(loc, iconSvg(iconName, size))}</div>`;
}

function subtitle(loc) {
  const parent = parentOf(loc);
  const type = i18n(locationTypeInfo(loc.type)[1]);
  return parent ? `${type} · ${i18n("в составе: {name}", { name: parent.name || i18n("Без имени") })}` : type;
}

// Первая строка описания для карточки: поле description или первое
// заполненное многострочное поле шаблона.
function blurb(loc) {
  if ((loc.description || "").trim()) return loc.description;
  const f = (templateFor(templates, loc.templateId)?.fields || []).find((x) => x.type !== "input" && (loc[x.key] || "").trim());
  return f ? loc[f.key] : "";
}

function tagsHtml(entity) {
  return parseTags(entity.tags).map((t) => `<span class="cast-tag">${escapeHtml(t)}</span>`).join("");
}

function peopleHtml(list, max = 6) {
  return list.slice(0, max).map((c) => personAvatarHtml(c, "cast-avatar cast-avatar-xs")).join("");
}

// ── Отрисовка ──────────────────────────────────

function draw() {
  container.innerHTML = "";
  if (inModal) {
    const loc = locations.find((l) => l.id === activeId);
    if (loc) container.appendChild(buildPage(loc));
    return;
  }
  const pane = document.createElement("div");
  pane.className = "characters-pane";
  pane.appendChild(buildToolbar());
  bodyEl = document.createElement("div");
  bodyEl.className = "characters-body";
  pane.appendChild(bodyEl);
  container.appendChild(pane);
  drawBody();
}

// Только тело под шапкой — чтобы набор в поиске не терял фокус.
function drawBody() {
  const shown = locations.filter(matches).length;
  metaEl.textContent = shown === locations.length
    ? i18nPlural(locations.length, ["{n} место", "{n} места", "{n} мест"])
    : i18nPlural(locations.length, ["{shown} из {total} места", "{shown} из {total} мест", "{shown} из {total} мест"], { shown }, "total");
  bodyEl.innerHTML = "";
  bodyEl.appendChild(mode === "overview" ? buildOverview() : buildAtlas());
}

function buildToolbar() {
  const extra = mode === "overview"
    ? buildSegmented(GROUPS, groupBy, (key) => {
      groupBy = key;
      writePref(GROUP_KEY, groupBy);
      draw();
    })
    : null;
  const pickTemplate = (btn, forceMenu) =>
    chooseTemplate(templates, btn, (id) => addWithTemplate(id), { forceMenu, onCreateNew: addWithNewTemplate });
  const { bar, metaEl: meta } = buildEntityToolbar({
    title: i18n("Локации"),
    modes: MODES,
    mode,
    onMode: (key) => {
      mode = key;
      writePref(MODE_KEY, mode);
      draw();
    },
    extra,
    placeholder: i18n("Название, тип или тег…"),
    query,
    onSearch: (value) => {
      query = value;
      drawBody();
    },
    addLabel: i18n("+ Локация"),
    onAdd: (btn) => pickTemplate(btn, false),
    onAddMenu: (btn) => pickTemplate(btn, true),
  });
  metaEl = meta;
  return bar;
}

function openPage(id) {
  activeId = id;
  mode = "atlas";
  writePref(MODE_KEY, mode);
  draw();
}

function reorder(list) {
  locations = list;
  persist();
  drawBody();
}

// ── «Обзор» ────────────────────────────────────

function buildOverview() {
  const scroll = document.createElement("div");
  scroll.className = "cast-scroll";
  if (!locations.length) {
    scroll.appendChild(buildEmptyState(i18n("Локаций пока нет – добавь первую."), "pin"));
    return scroll;
  }
  const list = locations.filter(matches);
  if (!list.length) {
    scroll.appendChild(buildEmptyState(i18n("Ничего не нашлось."), "pin"));
    return scroll;
  }
  const dragState = { current: null };
  const addSection = (title, members) => {
    if (!members.length) return;
    scroll.appendChild(buildOverviewSection(title, members, {
      render: buildCard,
      onOpen: openPage,
      dragState,
      list: () => locations,
      onReorder: reorder,
      gridClass: "cast-grid loc-grid",
    }));
  };

  if (groupBy === "map") {
    // Место на нескольких картах — в группе первой из них, без повторов.
    const placed = new Set();
    for (const m of mapsInOrder()) {
      const members = list.filter((l) => !placed.has(l.id) && (m.pins || []).some((p) => p.locationId === l.id));
      members.forEach((l) => placed.add(l.id));
      addSection(m.name || i18n("Без названия"), members);
    }
    addSection(i18n("Не отмечены на карте"), list.filter((l) => !placed.has(l.id)));
  } else if (groupBy === "type") {
    for (const [type, label] of LOCATION_TYPES) {
      addSection(i18n(label), list.filter((l) => locationTypeInfo(l.type)[0] === type));
    }
  } else {
    // Верхний уровень с вложенными — своей группой (само место и всё,
    // что внутри, по порядку дерева); одиночки — общей группой.
    const tree = orderedTree();
    const shown = new Set(list.map((l) => l.id));
    const loose = [];
    for (const { loc, depth } of tree) {
      if (depth) continue;
      const ids = new Set([loc.id, ...descendantIds(loc.id)]);
      const members = tree.filter((x) => ids.has(x.loc.id) && shown.has(x.loc.id)).map((x) => x.loc);
      if (ids.size > 1) addSection(loc.name || i18n("Без имени"), members);
      else if (shown.has(loc.id)) loose.push(loc);
    }
    addSection(i18n("Отдельные места"), loose);
  }
  return scroll;
}

// Кусок карты над карточкой: вся карта вдвое крупнее рамки, сдвинута
// так, чтобы метка места стояла по центру; соседние метки — точками с
// подписью.
// Основа карты: загруженная картинка, нарисованная (map-draw.js) или
// рисунок поверх картинки. У одного рисунка размер задаёт aspect-ratio.
function mapBaseHtml(map) {
  const img = map.imageRelPath ? `<img src="/${map.imageRelPath}" alt="">` : "";
  const drawing = map.drawing ? `<div class="loc-drawing">${drawingSvg(map.drawing, { withSea: !map.imageRelPath })}</div>` : "";
  return img + drawing;
}

function mapAspect(map) {
  return !map.imageRelPath && map.drawing ? `aspect-ratio:${map.drawing.width}/${map.drawing.height};` : "";
}

function hasMapBase(map) {
  return Boolean(map.imageRelPath || map.drawing);
}

function miniMapHtml({ map, pin }) {
  const dots = (map.pins || []).map((p) => `
    <i class="${p === pin ? "on" : ""}" style="left:${p.x}%;top:${p.y}%">${p === pin ? "" : `<b>${escapeHtml(p.label || "")}</b>`}</i>
  `).join("");
  return `
    <div class="loc-minimap">
      <div class="loc-minimap-inner" style="${mapAspect(map)}transform:translate(-${pin.x}%,-${pin.y}%)">${mapBaseHtml(map)}${dots}</div>
      <span>${escapeHtml(map.name || "")}</span>
    </div>
  `;
}

function buildCard(loc) {
  const info = placeInfo(loc);
  const [, , iconName, color] = locationTypeInfo(loc.type);
  const text = blurb(loc);
  const stats = [
    info.events.length && i18nPlural(info.events.length, ["{n} событие", "{n} события", "{n} событий"]),
    info.chapters.length && i18nPlural(info.chapters.length, ["{n} глава", "{n} главы", "{n} глав"]),
  ].filter(Boolean).join(" · ");
  const card = document.createElement("button");
  card.className = "cast-card loc-card";
  card.innerHTML = `
    ${info.pins[0] && hasMapBase(info.pins[0].map)
      ? miniMapHtml(info.pins[0])
      : `<div class="loc-minimap loc-minimap-none" style="--type-color:${color}">${iconSvg(iconName, 32)}<span>${escapeHtml(i18n("не отмечено на карте"))}</span></div>`}
    <div class="loc-card-body">
      <div class="cast-card-head">
        ${tileHtml(loc, "cast-avatar cast-avatar-md", 18)}
        <div class="cast-card-title">
          <div class="cast-name">${escapeHtml(loc.name || i18n("Без имени"))}</div>
          <div class="cast-sub">${escapeHtml(subtitle(loc))}</div>
        </div>
      </div>
      ${text ? `<p class="loc-blurb">${escapeHtml(text)}</p>` : ""}
      ${info.hqOf.length ? `<div class="loc-hq">${iconSvg("shield", 13)}${escapeHtml(i18n("Штаб: {names}", { names: info.hqOf.map((f) => f.name).join(", ") }))}</div>` : ""}
      <div class="cast-card-foot">
        <div class="dossier-avatars">${peopleHtml(info.people, 5)}</div>
        <div class="cast-stat">${escapeHtml(stats || i18n("в сюжете не встречается"))}</div>
      </div>
    </div>
  `;
  return card;
}

// ── «Атлас» ────────────────────────────────────

function buildAtlas() {
  const shown = locations.filter(matches);
  if (!locations.some((l) => l.id === activeId)) activeId = (shown[0] || locations[0])?.id || null;
  const groups = LOCATION_TYPES.map(([type, label]) => ({
    title: i18n(label),
    items: shown.filter((l) => locationTypeInfo(l.type)[0] === type).map((l) => ({
      item: l,
      leadHtml: tileHtml(l, "cast-avatar cast-avatar-sm", 15),
      sub: parentOf(l)?.name || blurb(l),
    })),
  }));
  const list = buildDossierList(groups, activeId, {
    onPick: (id) => {
      activeId = id;
      drawBody();
    },
    dragState: { current: null },
    list: () => locations,
    onReorder: reorder,
    emptyText: i18n(locations.length ? "Ничего не нашлось." : "Локаций пока нет."),
  });
  const active = locations.find((l) => l.id === activeId);
  return buildDossierSplit(list, active ? buildPage(active) : buildEmptyState(i18n("Локаций пока нет – добавь первую."), "pin"));
}

function selectPlace(id) {
  activeId = id;
  if (inModal || mode !== "atlas") draw();
  else drawBody();
}

function buildPage(loc) {
  const info = placeInfo(loc);
  const page = document.createElement("div");
  page.className = "dossier";

  // ── Шапка
  const head = document.createElement("div");
  head.className = "dossier-head";
  const [, , iconName, color] = locationTypeInfo(loc.type);
  const tile = document.createElement("div");
  tile.className = "cast-avatar dossier-avatar";
  tile.style.background = color;
  tile.innerHTML = avatarInnerHtml(loc, iconSvg(iconName, 44));

  const titleCol = document.createElement("div");
  titleCol.className = "dossier-title";
  const nameRow = document.createElement("div");
  nameRow.className = "drawer-name-row";
  const onName = () => {
    updateListRow(bodyEl, loc.id, { name: loc.name });
    persist();
  };
  const nameField = buildNameInput(loc, onName);
  nameRow.append(nameField, buildNameGeneratorButton((name) => {
    nameField.value = name;
    loc.name = name;
    onName();
  }, "place"));
  const sub = document.createElement("div");
  sub.className = "dossier-subtitle";
  sub.textContent = subtitle(loc);
  titleCol.append(nameRow, sub);
  if (parseTags(loc.tags).length) {
    const tags = document.createElement("div");
    tags.className = "cast-tags";
    tags.innerHTML = tagsHtml(loc);
    titleCol.appendChild(tags);
  }

  const actions = document.createElement("div");
  actions.className = "dossier-actions";
  const delBtn = document.createElement("button");
  delBtn.className = "btn danger";
  delBtn.innerHTML = `${iconSvg("trash", 14)}<span>${escapeHtml(i18n("Удалить"))}</span>`;
  delBtn.addEventListener("click", async () => {
    await pushTrash("location", loc);
    locations = locations.filter((x) => x.id !== loc.id);
    // Дети удалённой локации не исчезают вместе с ней — поднимаются на
    // верхний уровень, а не остаются висеть на несуществующем parentId.
    for (const l of locations) if (l.parentId === loc.id) l.parentId = null;
    activeId = null;
    persist();
    if (inModal) closeEntityModal();
    else draw();
  });
  actions.appendChild(delBtn);
  head.append(tile, titleCol, actions);
  page.appendChild(head);

  // ── Сводка
  const facts = document.createElement("div");
  facts.className = "dossier-facts";
  facts.appendChild(buildFact(i18n("Тип"), buildSelect(LOCATION_TYPES.map(([v, l]) => [v, l]), locationTypeInfo(loc.type)[0], (value) => {
    loc.type = value;
    persist();
    draw();
  })));
  const excluded = descendantIds(loc.id);
  excluded.add(loc.id);
  const parentOptions = [["", "– верхний уровень –"], ...locations.filter((l) => !excluded.has(l.id)).map((l) => [l.id, l.name || i18n("Без имени")])];
  facts.appendChild(buildFact(i18n("Входит в"), buildSelect(parentOptions, loc.parentId || "", (value) => {
    loc.parentId = value || null;
    persist();
    draw();
  })));
  facts.appendChild(buildFactText(i18n("На карте"), [...new Set(info.pins.map((x) => x.map.name))].join(", ")));
  facts.appendChild(buildFactText(i18n("Внутри"), info.children.length ? i18nPlural(info.children.length, ["{n} место", "{n} места", "{n} мест"]) : ""));
  page.appendChild(facts);

  // ── Основная колонка и боковая
  const cols = document.createElement("div");
  cols.className = "dossier-cols";
  const main = document.createElement("div");
  main.className = "dossier-main";
  const side = document.createElement("aside");
  side.className = "dossier-side";

  main.appendChild(buildMapBlock(info));
  main.appendChild(sectionHeading(i18n("Анкета")));
  main.appendChild(buildTemplateFields(loc, templateFor(templates, loc.templateId)?.fields || [], [], () => persist()));

  main.appendChild(sectionHeading(i18n("Что здесь происходит")));
  for (const e of info.events) {
    const people = (e.characterIds || []).map((id) => characters.find((c) => c.id === id)).filter(Boolean);
    main.appendChild(buildEventRow(e, peopleHtml(people, 8)));
  }
  if (!info.events.length) main.appendChild(buildNone(i18n("Событий здесь пока нет")));

  main.appendChild(sectionHeading(i18n("Облик и метки")));
  main.appendChild(buildAvatarsField(loc, () => { persist(); draw(); }));
  main.appendChild(buildTagsField(tagsMap, loc.tags, (value) => {
    loc.tags = value;
    persist();
  }));

  side.appendChild(sectionHeading(i18n("Кто здесь бывает")));
  for (const c of info.people) {
    side.appendChild(buildLinkRow(personAvatarHtml(c), c.name || i18n("Без имени"), c.role || "", () => openEntity("character", c.id)));
  }
  if (!info.people.length) side.appendChild(buildNone(i18n("Пока никого")));

  side.appendChild(sectionHeading(i18n("Фракции")));
  for (const f of info.hqOf) {
    side.appendChild(buildLinkRow(iconLead(iconSvg(factionTypeInfo(f.type)[2], 13)), f.name || i18n("Без названия"), i18n("штаб-квартира"), () => openEntity("faction", f.id)));
  }
  if (!info.hqOf.length) side.appendChild(buildNone(i18n("Ничья не штаб-квартира")));

  side.appendChild(sectionHeading(i18n("Вложенность")));
  side.appendChild(info.parent
    ? buildLinkRow(iconLead(iconSvg("folder", 13)), info.parent.name || i18n("Без имени"), i18n("входит в"), () => selectPlace(info.parent.id))
    : buildLinkRow(iconLead(iconSvg("folder", 13)), i18n("Верхний уровень"), i18n("входит в")));
  for (const { pin } of info.pins) {
    const inner = pin.linkedMapId && mapData.maps?.[pin.linkedMapId];
    if (inner) side.appendChild(buildLinkRow(iconLead(iconSvg("map", 13)), inner.name || i18n("Без названия"), i18n("своя карта")));
  }
  for (const k of info.children) {
    side.appendChild(buildLinkRow(iconLead(iconSvg(locationTypeInfo(k.type)[2], 13)), k.name || i18n("Без имени"), i18n(locationTypeInfo(k.type)[1]), () => selectPlace(k.id)));
  }
  const addInside = document.createElement("button");
  addInside.className = "btn rel-mini-add";
  addInside.textContent = i18n("+ Место внутри");
  addInside.addEventListener("click", () => addWithTemplate(loc.templateId, loc.id));
  side.appendChild(addInside);

  side.appendChild(sectionHeading(i18n("Главы")));
  for (const ch of info.chapters) {
    side.appendChild(buildLinkRow(iconLead(iconSvg("manuscript", 13)), chapterLabel(ch, manuscript.books), "", () => openEntity("chapter", ch.id)));
  }
  if (!info.chapters.length) side.appendChild(buildNone(i18n("Не указано ни в одной главе")));

  cols.append(main, side);
  page.appendChild(cols);
  return page;
}

// Карта на странице места — вся, с подсвеченной меткой; соседние метки
// подписаны. Мест на нескольких картах — первая из них.
function buildMapBlock(info) {
  const wrap = document.createElement("div");
  const first = info.pins.find((x) => hasMapBase(x.map));
  if (!first) {
    wrap.className = "loc-map loc-map-none";
    wrap.innerHTML = `${iconSvg("map", 22)}<span>${escapeHtml(i18n("Место пока не отмечено ни на одной карте – метку ставят во вкладке «Карта»"))}</span>`;
    return wrap;
  }
  wrap.className = "loc-map";
  const dots = (first.map.pins || []).map((p) => `
    <i class="${p === first.pin ? "on" : ""}" style="left:${p.x}%;top:${p.y}%"><b>${escapeHtml(p.label || "")}</b></i>
  `).join("");
  wrap.innerHTML = `
    <div class="loc-map-inner" style="${mapAspect(first.map)}">${mapBaseHtml(first.map)}${dots}</div>
    <span class="loc-map-caption">${iconSvg("map", 13)}${escapeHtml(first.map.name || "")}</span>
  `;
  return wrap;
}
