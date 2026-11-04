import { apiGet, apiPost, uid } from "./api.js";
import { debounceSave } from "./save-badge.js";
import { escapeHtml, characterSelect, buildEmptyState } from "./chips.js";
import { FACTION_TYPES, factionTypeInfo, locationTypeInfo, iconSvg } from "./icons.js";
import { pushTrash } from "./trash.js";
import { loadTagsMap, buildTagsField, parseTags } from "./tags.js";
import { avatarInnerHtml, buildAvatarsField } from "./avatars.js";
import { loadTemplates, saveTemplates, templateFor } from "./templates.js";
import { chooseTemplate } from "./template-choice.js";
import { openTemplateEditorModal } from "./template-editor-modal.js";
import { closeEntityModal } from "./entity-modal.js";
import { i18n, i18nPlural } from "./i18n.js";
import {
  readPref, writePref, buildEntityToolbar, buildOverviewSection, buildDossierList, buildDossierSplit,
  updateListRow, sectionHeading, buildNone, buildFact, buildFactText, buildSelect, buildNameInput, buildTemplateFields,
  buildLinkRow, iconLead, buildEventRow, openEntity, shortName, personAvatarHtml,
} from "./entity-view.js";

// ══════════════════════════════════════════════
//  ФРАКЦИИ
//
//  «Расклад сил» — фракции крупными карточками: идеология, глава,
//  состав, отношения с другими фракциями; ниже — кто ни к кому не
//  примкнул. «Досье» — список слева, страница фракции справа.
//
//  Отношения фракций — relations: { [id другой фракции]: статус }, у
//  обеих сторон одинаково (как пары у персонажей). Статус — "allies",
//  "enemies", "neutral" или свой текст («вассалы», «торговый союз»).
// ══════════════════════════════════════════════

const MODE_KEY = "fictaris_factions_mode";
const RELATION_STATUSES = [
  ["allies", "Союзники", "var(--color-8)"],
  ["enemies", "Враждуют", "var(--color-3)"],
  ["neutral", "Нейтрально", "var(--text-faint)"],
];
const CUSTOM_STATUS = "__custom__";
const MODES = [
  ["overview", "Расклад сил", "Все фракции рядом"],
  ["dossier", "Досье", "Список слева, страница фракции справа"],
];

let factions = [];
let characters = [];
let locations = [];
let timeline = [];
let mapData = { maps: {} };
let tagsMap = {};
let templates = [];
let activeId = null;
let container = null;
let inModal = false;
let query = "";
let mode = readPref(MODE_KEY, MODES.map(([k]) => k), "overview");
let bodyEl = null;
let metaEl = null;
const save = debounceSave((list) => apiPost("/api/factions", list));

function persist() {
  save(factions);
}

function addWithTemplate(templateId) {
  const f = blank(templateId);
  factions.push(f);
  activeId = f.id;
  if (!inModal) {
    mode = "dossier";
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
      await saveTemplates("factions", templates);
      addWithTemplate(fresh.id);
    },
  });
}

function blank(templateId) {
  return {
    id: uid(),
    name: i18n("Новая фракция"),
    type: "order",
    tags: "",
    leaderId: null,
    headquartersId: null,
    memberIds: [],
    templateId: templateId || templates[0]?.id || "default",
  };
}

export async function renderFactions(root, focusId) {
  container = root;
  inModal = root.classList.contains("entity-modal-body");
  [factions, characters, locations, timeline, mapData, tagsMap, templates] = await Promise.all([
    apiGet("/api/factions"),
    apiGet("/api/characters"),
    apiGet("/api/locations"),
    apiGet("/api/timeline"),
    apiGet("/api/map"),
    loadTagsMap(),
    loadTemplates("factions"),
  ]);
  if (focusId && factions.some((f) => f.id === focusId)) {
    activeId = focusId;
    if (!inModal) {
      mode = "dossier";
      writePref(MODE_KEY, mode);
    }
  }
  draw();
}

// ── Что известно о фракции ─────────────────────

// Глава — тоже в составе, даже если его нет в memberIds.
function memberIdsOf(f) {
  return [...new Set([f.leaderId, ...(f.memberIds || [])].filter(Boolean))];
}

function charById(id) {
  return characters.find((c) => c.id === id) || null;
}

function relationsOf(f) {
  return Object.entries(f.relations || {})
    .map(([id, status]) => ({ faction: factions.find((g) => g.id === id), status }))
    .filter((x) => x.faction && x.status);
}

// Ставит статус обеим сторонам сразу; пустой — убирает отношение.
function setRelation(a, b, status) {
  for (const [x, y] of [[a, b], [b, a]]) {
    if (status) {
      x.relations = { ...(x.relations || {}), [y.id]: status };
    } else if (x.relations) {
      delete x.relations[y.id];
      if (!Object.keys(x.relations).length) delete x.relations;
    }
  }
}

function statusLabel(status) {
  const preset = RELATION_STATUSES.find(([key]) => key === status);
  return preset ? i18n(preset[1]) : status;
}

function statusColor(status) {
  return RELATION_STATUSES.find(([key]) => key === status)?.[2] || "var(--accent)";
}

// Свои статусы, уже заведённые где-нибудь в мире, — в выпадающем
// списке рядом со стандартными, чтобы не набирать их заново.
function customStatuses() {
  const set = new Set();
  for (const f of factions) {
    for (const status of Object.values(f.relations || {})) {
      if (status && !RELATION_STATUSES.some(([key]) => key === status)) set.add(status);
    }
  }
  return [...set];
}

// События фракции: с участием её людей или в её штаб-квартире.
function eventsOf(f) {
  const ids = new Set(memberIdsOf(f));
  return timeline
    .filter((e) => (e.characterIds || []).some((id) => ids.has(id)) || (f.headquartersId && (e.locationIds || []).includes(f.headquartersId)))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function matches(f) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const typeLabel = i18n(factionTypeInfo(f.type)[1]);
  return [f.name, typeLabel, f.tags, f.description].some((s) => (s || "").toLowerCase().includes(q));
}

function tileHtml(f, cls, size) {
  const [, , iconName, color] = factionTypeInfo(f.type);
  return `<div class="${cls}" style="background:${color}">${avatarInnerHtml(f, iconSvg(iconName, size))}</div>`;
}

function subtitle(f) {
  const hq = locations.find((l) => l.id === f.headquartersId);
  const type = i18n(factionTypeInfo(f.type)[1]);
  return hq ? `${type} · ${hq.name || i18n("Без имени")}` : type;
}

function blurb(f) {
  if ((f.description || "").trim()) return f.description;
  const field = (templateFor(templates, f.templateId)?.fields || []).find((x) => x.type !== "input" && (f[x.key] || "").trim());
  return field ? f[field.key] : "";
}

function relationsHtml(list) {
  return list.map(({ faction, status }) => `
    <div class="fac-tie" style="--tie-color:${statusColor(status)}">
      <i></i><b>${escapeHtml(faction.name || i18n("Без названия"))}</b><span>${escapeHtml(statusLabel(status))}</span>
    </div>
  `).join("");
}

// ── Отрисовка ──────────────────────────────────

function draw() {
  container.innerHTML = "";
  if (inModal) {
    const f = factions.find((x) => x.id === activeId);
    if (f) container.appendChild(buildPage(f));
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
  const shown = factions.filter(matches).length;
  metaEl.textContent = shown === factions.length
    ? i18nPlural(factions.length, ["{n} фракция", "{n} фракции", "{n} фракций"])
    : i18nPlural(factions.length, ["{shown} из {total} фракции", "{shown} из {total} фракций", "{shown} из {total} фракций"], { shown }, "total");
  bodyEl.innerHTML = "";
  bodyEl.appendChild(mode === "overview" ? buildOverview() : buildDossierView());
}

function buildToolbar() {
  const pickTemplate = (btn, forceMenu) =>
    chooseTemplate(templates, btn, addWithTemplate, { forceMenu, onCreateNew: addWithNewTemplate });
  const { bar, metaEl: meta } = buildEntityToolbar({
    title: i18n("Фракции"),
    modes: MODES,
    mode,
    onMode: (key) => {
      mode = key;
      writePref(MODE_KEY, mode);
      draw();
    },
    placeholder: i18n("Название, тип или тег…"),
    query,
    onSearch: (value) => {
      query = value;
      drawBody();
    },
    addLabel: i18n("+ Фракция"),
    onAdd: (btn) => pickTemplate(btn, false),
    onAddMenu: (btn) => pickTemplate(btn, true),
  });
  metaEl = meta;
  return bar;
}

function openPage(id) {
  activeId = id;
  mode = "dossier";
  writePref(MODE_KEY, mode);
  draw();
}

function reorder(list) {
  factions = list;
  persist();
  drawBody();
}

// ── «Расклад сил» ──────────────────────────────

function buildOverview() {
  const scroll = document.createElement("div");
  scroll.className = "cast-scroll";
  if (!factions.length) {
    scroll.appendChild(buildEmptyState(i18n("Фракций пока нет – добавь первую."), "shield"));
    return scroll;
  }
  const list = factions.filter(matches);
  if (!list.length) scroll.appendChild(buildEmptyState(i18n("Ничего не нашлось."), "shield"));
  else {
    const grid = buildOverviewSection("", list, {
      render: buildCard,
      onOpen: openPage,
      dragState: { current: null },
      list: () => factions,
      onReorder: reorder,
      gridClass: "fac-grid",
    });
    grid.querySelector(".cast-section-head").remove();
    scroll.appendChild(grid);
  }

  // Кто ни к кому не примкнул — чтобы было видно, кого ещё можно
  // втянуть в расклад.
  const inAny = new Set(factions.flatMap(memberIdsOf));
  const outside = characters.filter((c) => !inAny.has(c.id));
  if (outside.length) {
    const sec = document.createElement("section");
    sec.className = "cast-section fac-outside";
    sec.innerHTML = `<div class="cast-section-head"><h3>${escapeHtml(i18n("Вне фракций"))}</h3><span>${outside.length}</span></div>`;
    const chips = document.createElement("div");
    chips.className = "fac-members";
    for (const c of outside) {
      const chip = document.createElement("button");
      chip.className = "fac-member";
      chip.innerHTML = `${personAvatarHtml(c)}${escapeHtml(c.name || i18n("Без имени"))}`;
      chip.addEventListener("click", () => openEntity("character", c.id));
      chips.appendChild(chip);
    }
    sec.appendChild(chips);
    scroll.appendChild(sec);
  }
  return scroll;
}

function buildCard(f) {
  const color = factionTypeInfo(f.type)[3];
  const leader = charById(f.leaderId);
  const members = memberIdsOf(f).map(charById).filter(Boolean);
  const relations = relationsOf(f);
  const text = blurb(f);
  const events = eventsOf(f);
  const card = document.createElement("button");
  card.className = "cast-card fac-card";
  card.style.setProperty("--faction-color", color);
  card.innerHTML = `
    <div class="cast-card-head">
      ${tileHtml(f, "cast-avatar cast-avatar-lg", 26)}
      <div class="cast-card-title">
        <div class="cast-name fac-name">${escapeHtml(f.name || i18n("Без имени"))}</div>
        <div class="cast-sub">${escapeHtml(subtitle(f))}</div>
      </div>
    </div>
    ${text ? `<p class="fac-blurb">${escapeHtml(text)}</p>` : ""}
    ${leader
      ? `<div class="fac-leader">${personAvatarHtml(leader, "cast-avatar")}<div><small>${escapeHtml(i18n("Глава"))}</small><b>${escapeHtml(leader.name || i18n("Без имени"))}</b>${leader.role ? `<span>${escapeHtml(leader.role)}</span>` : ""}</div></div>`
      : `<div class="fac-leader empty">${escapeHtml(i18n("Глава не назначен"))}</div>`}
    <div class="fac-label">${escapeHtml(i18n("Состав · {n}", { n: members.length }))}</div>
    <div class="fac-members">${members.map((c) => `<span class="fac-member">${personAvatarHtml(c)}${escapeHtml(shortName(c.name))}${c.id === f.leaderId ? `<em>${escapeHtml(i18n("глава"))}</em>` : ""}</span>`).join("") || `<span class="dossier-none">${escapeHtml(i18n("Никого"))}</span>`}</div>
    ${relations.length ? `<div class="fac-label">${escapeHtml(i18n("Отношения"))}</div>${relationsHtml(relations)}` : ""}
    <div class="cast-card-foot">
      <div class="cast-tags">${parseTags(f.tags).map((t) => `<span class="cast-tag">${escapeHtml(t)}</span>`).join("")}</div>
      <div class="cast-stat">${escapeHtml(events.length ? i18nPlural(events.length, ["{n} событие", "{n} события", "{n} событий"]) : i18n("в сюжете не встречается"))}</div>
    </div>
  `;
  return card;
}

// ── «Досье» ────────────────────────────────────

function buildDossierView() {
  const shown = factions.filter(matches);
  if (!factions.some((f) => f.id === activeId)) activeId = (shown[0] || factions[0])?.id || null;
  const groups = [{
    title: "",
    items: shown.map((f) => ({ item: f, leadHtml: tileHtml(f, "cast-avatar cast-avatar-sm", 15), sub: i18n(factionTypeInfo(f.type)[1]) })),
  }];
  const list = buildDossierList(groups, activeId, {
    onPick: (id) => {
      activeId = id;
      drawBody();
    },
    dragState: { current: null },
    list: () => factions,
    onReorder: reorder,
    emptyText: i18n(factions.length ? "Ничего не нашлось." : "Фракций пока нет."),
  });
  const active = factions.find((f) => f.id === activeId);
  return buildDossierSplit(list, active ? buildPage(active) : buildEmptyState(i18n("Фракций пока нет – добавь первую."), "shield"));
}

function selectFaction(id) {
  activeId = id;
  if (inModal || mode !== "dossier") draw();
  else drawBody();
}

function buildPage(f) {
  const page = document.createElement("div");
  page.className = "dossier";
  const members = memberIdsOf(f).map(charById).filter(Boolean);

  // ── Шапка
  const head = document.createElement("div");
  head.className = "dossier-head";
  const [, , iconName, color] = factionTypeInfo(f.type);
  const tile = document.createElement("div");
  tile.className = "cast-avatar dossier-avatar";
  tile.style.background = color;
  tile.innerHTML = avatarInnerHtml(f, iconSvg(iconName, 44));

  const titleCol = document.createElement("div");
  titleCol.className = "dossier-title";
  const nameField = buildNameInput(f, () => {
    updateListRow(bodyEl, f.id, { name: f.name });
    persist();
  });
  const sub = document.createElement("div");
  sub.className = "dossier-subtitle";
  sub.textContent = subtitle(f);
  titleCol.append(nameField, sub);
  if (parseTags(f.tags).length) {
    const tags = document.createElement("div");
    tags.className = "cast-tags";
    tags.innerHTML = parseTags(f.tags).map((t) => `<span class="cast-tag">${escapeHtml(t)}</span>`).join("");
    titleCol.appendChild(tags);
  }

  const actions = document.createElement("div");
  actions.className = "dossier-actions";
  const delBtn = document.createElement("button");
  delBtn.className = "btn danger";
  delBtn.innerHTML = `${iconSvg("trash", 14)}<span>${escapeHtml(i18n("Удалить"))}</span>`;
  delBtn.addEventListener("click", async () => {
    await pushTrash("faction", f);
    factions = factions.filter((x) => x.id !== f.id);
    for (const g of factions) setRelation(g, f, null);
    // Границы фракции на картах остаются, но без привязки к ней.
    let mapChanged = false;
    for (const m of Object.values(mapData.maps || {})) {
      for (const shape of m.drawing?.shapes || []) {
        if (shape.factionId === f.id) {
          delete shape.factionId;
          if (!shape.name) shape.name = f.name;
          mapChanged = true;
        }
      }
    }
    if (mapChanged) await apiPost("/api/map", mapData);
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
  facts.appendChild(buildFact(i18n("Тип"), buildSelect(FACTION_TYPES.map(([v, l]) => [v, l]), factionTypeInfo(f.type)[0], (value) => {
    f.type = value;
    persist();
    draw();
  })));
  const leaderSelect = characterSelect(characters, f.leaderId, i18n("Не назначен"));
  leaderSelect.addEventListener("change", () => {
    f.leaderId = leaderSelect.value || null;
    persist();
    draw();
  });
  facts.appendChild(buildFact(i18n("Глава"), leaderSelect));
  const hqOptions = [["", "Не указана"], ...locations.map((l) => [l.id, l.name || i18n("Без имени")])];
  facts.appendChild(buildFact(i18n("Штаб-квартира"), buildSelect(hqOptions, f.headquartersId || "", (value) => {
    f.headquartersId = value || null;
    persist();
    draw();
  })));
  facts.appendChild(buildFactText(i18n("Численность"), i18nPlural(members.length, ["{n} человек", "{n} человека", "{n} человек"])));
  page.appendChild(facts);

  // ── Основная колонка и боковая
  const cols = document.createElement("div");
  cols.className = "dossier-cols";
  const main = document.createElement("div");
  main.className = "dossier-main";
  const side = document.createElement("aside");
  side.className = "dossier-side";

  main.appendChild(sectionHeading(i18n("Анкета")));
  main.appendChild(buildTemplateFields(f, templateFor(templates, f.templateId)?.fields || [], [], () => persist()));

  main.appendChild(sectionHeading(i18n("В сюжете")));
  const events = eventsOf(f);
  for (const e of events) {
    const people = (e.characterIds || []).map(charById).filter(Boolean);
    main.appendChild(buildEventRow(e, people.map((c) => personAvatarHtml(c)).join("")));
  }
  if (!events.length) main.appendChild(buildNone(i18n("Событий с её людьми пока нет")));

  main.appendChild(sectionHeading(i18n("Облик и метки")));
  main.appendChild(buildAvatarsField(f, () => { persist(); draw(); }));
  main.appendChild(buildTagsField(tagsMap, f.tags, (value) => {
    f.tags = value;
    persist();
  }));

  side.appendChild(sectionHeading(i18n("Состав")));
  side.appendChild(buildMembers(f));

  side.appendChild(sectionHeading(i18n("Отношения с фракциями")));
  side.appendChild(buildRelations(f));

  side.appendChild(sectionHeading(i18n("Владения")));
  const hq = locations.find((l) => l.id === f.headquartersId);
  if (hq) {
    side.appendChild(buildLinkRow(iconLead(iconSvg(locationTypeInfo(hq.type)[2], 13)), hq.name || i18n("Без имени"), i18n("штаб-квартира"), () => openEntity("location", hq.id)));
  }
  // Земли на картах — границы областей, привязанные к фракции (map-draw.js).
  const lands = Object.values(mapData.maps || {})
    .filter((m) => (m.drawing?.shapes || []).some((x) => x.kind === "border" && x.factionId === f.id));
  for (const m of lands) {
    side.appendChild(buildLinkRow(iconLead(iconSvg("map", 13)), m.name || i18n("Без названия"), i18n("граница на карте")));
  }
  if (!hq && !lands.length) side.appendChild(buildNone(i18n("Ни штаб-квартиры, ни земель на картах")));

  cols.append(main, side);
  page.appendChild(cols);
  return page;
}

// Состав: глава отдельной пометкой (меняется в сводке), остальных можно
// убрать крестиком; ниже — выпадающий список, кого добавить.
function buildMembers(f) {
  const wrap = document.createElement("div");
  wrap.className = "fac-member-list";
  for (const id of memberIdsOf(f)) {
    const c = charById(id);
    if (!c) continue;
    const row = buildLinkRow(personAvatarHtml(c), c.name || i18n("Без имени"), id === f.leaderId ? i18n("глава") : c.role || "", () => openEntity("character", c.id));
    if (id !== f.leaderId) {
      const remove = document.createElement("span");
      remove.className = "fac-member-remove";
      remove.title = i18n("Убрать из состава");
      remove.innerHTML = iconSvg("close", 12);
      remove.addEventListener("click", (e) => {
        e.stopPropagation();
        f.memberIds = (f.memberIds || []).filter((x) => x !== id);
        persist();
        draw();
      });
      row.appendChild(remove);
    }
    wrap.appendChild(row);
  }
  const taken = new Set(memberIdsOf(f));
  const candidates = characters.filter((c) => !taken.has(c.id));
  if (candidates.length) {
    const add = characterSelect(candidates, null, i18n("+ Добавить в состав…"));
    add.className = "fac-member-add";
    add.addEventListener("change", () => {
      if (!add.value) return;
      f.memberIds = [...(f.memberIds || []), add.value];
      persist();
      draw();
    });
    wrap.appendChild(add);
  }
  return wrap;
}

// Отношения с другими фракциями: у каждой — статус из списка или свой;
// ниже — с кем ещё завести отношение.
function buildRelations(f) {
  const wrap = document.createElement("div");
  wrap.className = "fac-relations";
  const update = (g, status) => {
    setRelation(f, g, status);
    persist();
    draw();
  };
  for (const { faction: g, status } of relationsOf(f)) {
    const row = document.createElement("div");
    row.className = "fac-relation-row";
    row.style.setProperty("--tie-color", statusColor(status));
    const name = document.createElement("button");
    name.className = "fac-relation-name";
    name.innerHTML = `<i></i>${escapeHtml(g.name || i18n("Без названия"))}`;
    name.addEventListener("click", () => selectFaction(g.id));
    const remove = document.createElement("button");
    remove.className = "fac-member-remove";
    remove.title = i18n("Убрать отношение");
    remove.innerHTML = iconSvg("close", 12);
    remove.addEventListener("click", () => update(g, null));
    row.append(name, buildStatusControl(status, (value) => update(g, value)), remove);
    wrap.appendChild(row);
  }
  const taken = new Set(Object.keys(f.relations || {}));
  const others = factions.filter((g) => g.id !== f.id && !taken.has(g.id));
  if (others.length) {
    const add = buildSelect([["", "+ Отношение с фракцией…"], ...others.map((g) => [g.id, g.name || i18n("Без названия")])], "", (id) => {
      const g = factions.find((x) => x.id === id);
      if (g) update(g, "neutral");
    }, "fac-member-add");
    wrap.appendChild(add);
  } else if (factions.length < 2) {
    wrap.appendChild(buildNone(i18n("Других фракций пока нет")));
  }
  return wrap;
}

// Статус: стандартные, свои уже заведённые и «Свой статус…» — тогда
// вместо списка поле ввода; Enter или уход из поля сохраняет, Esc — отмена.
function buildStatusControl(value, onChange) {
  const options = [
    ...RELATION_STATUSES.map(([key, label]) => [key, label]),
    ...customStatuses().map((status) => [status, status]),
    [CUSTOM_STATUS, "Свой статус…"],
  ];
  const select = buildSelect(options, value, (picked) => {
    if (picked !== CUSTOM_STATUS) {
      onChange(picked);
      return;
    }
    const input = document.createElement("input");
    input.className = "fac-status-input";
    input.placeholder = i18n("Например: вассалы");
    select.replaceWith(input);
    input.focus();
    let done = false;
    const finish = (keep) => {
      if (done) return;
      done = true;
      const text = input.value.trim();
      if (keep && text) onChange(text);
      else draw();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
  }, "kin-kind-select fac-status-select");
  return select;
}
