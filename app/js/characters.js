import { apiGet, apiPost, uid } from "./api.js";
import { flattenBoards, cardCharacterIds } from "./board-data.js";
import { debounceSave } from "./save-badge.js";
import { escapeHtml, characterSelect, buildEmptyState } from "./chips.js";
import { pushTrash } from "./trash.js";
import { loadTagsMap, buildTagsField, parseTags, stringifyTags } from "./tags.js";
import { buildNameGeneratorButton } from "./name-generator.js";
import { avatarInnerHtml, buildAvatarsField } from "./avatars.js";
import { iconSvg } from "./icons.js";
import { loadTemplates, saveTemplates, templateFor } from "./templates.js";
import { chooseTemplate } from "./template-choice.js";
import { openTemplateEditorModal } from "./template-editor-modal.js";
import { closeEntityModal } from "./entity-modal.js";
import { findMentionedIds } from "./mentions.js";
import { chapterLabel } from "./books.js";
import { i18n, i18nPlural } from "./i18n.js";
import {
  readPref, writePref, buildSegmented, buildEntityToolbar, buildOverviewSection, buildDossierList, buildDossierSplit,
  updateListRow, sectionHeading, buildNone, buildFact, buildFactText, buildSelect, buildNameInput, buildTemplateFields,
  buildLinkRow, iconLead, openEntity, shortName, initials, personAvatarHtml,
} from "./entity-view.js";
import {
  PARENT_KINDS, PARTNER_KINDS, GENDERS, parentKind, setParentKind, forgetParent, partnerKind, setPartnerKind, forgetPartner,
  isDead, relativesOf, familyComponents, surnameHouseName,
} from "./kinship.js";

// ══════════════════════════════════════════════
//  ПЕРСОНАЖИ
//
//  Два режима. «Состав» — все персонажи группами (по значимости, родам
//  или фракциям): главные крупными карточками с целью, мотивом и
//  отношениями, остальные — плашками с родством. «Досье» — список слева,
//  справа страница персонажа: вся анкета правится прямо на ней, рядом
//  отношения, семья и где он встречается в сюжете. Клик по карточке
//  «Состава» открывает её «Досье».
//
//  Значимость — по тегу «Роль в сюжете» (Протагонист, Второстепенный,
//  Массовка…); без него считаем сами: у кого больше сцен, событий и
//  связей — главные, умершие — в «Умершие и предки».
// ══════════════════════════════════════════════

const PALETTE = [
  "#c9944a", "#4f7d74", "#a4483c", "#7d6a9e",
  "#6a8fae", "#9a9250", "#b5636b", "#5a8a5f",
];

const MODE_KEY = "fictaris_characters_mode";
const GROUP_KEY = "fictaris_characters_group";
const MODES = [
  ["cast", "Состав", "Все персонажи группами"],
  ["dossier", "Досье", "Список слева, страница персонажа справа"],
];
const GROUPS = [
  ["importance", "По значимости"],
  ["house", "По родам"],
  ["faction", "По фракциям"],
];

// Значимость и судьба — не отдельные поля, а стандартные теги «Роль в
// сюжете» и «Статус» (tags.js): отметка в сводке досье ставит тот же тег,
// что и выбор в поле тегов.
const ROLE_TAGS = [
  ["Протагонист", "main"],
  ["Антагонист", "main"],
  ["Рассказчик", "main"],
  ["Второстепенный", "secondary"],
  ["Массовка", "minor"],
];
const STATUS_TAGS = ["Жив", "Погиб", "Пропал без вести", "Статус неизвестен"];
const TIERS = [
  ["main", "Главные"],
  ["secondary", "Второй план"],
  ["minor", "Эпизодические"],
  ["gone", "Умершие и предки"],
];
// Сколько «веса» в сюжете (главы ×2, события ×2, связи ×2, фракции,
// карточки доски, метки) нужно, чтобы без явной отметки считаться главным.
const MAIN_SCORE = 4;

let characters = [];
let relationships = [];
let tagsMap = {};
let timeline = [];
let factions = [];
let board = { cards: {} };
let mapData = { maps: {} };
let manuscript = { chapters: [] };
let templates = [];
let activeId = null;
let container = null;
let inModal = false;
let query = "";
let mode = readPref(MODE_KEY, MODES.map(([k]) => k), "cast");
let groupBy = readPref(GROUP_KEY, GROUPS.map(([k]) => k), "importance");
let plot = new Map();
let houseOf = new Map();
let houses = [];
let bodyEl = null;
let metaEl = null;
const save = debounceSave((list) => apiPost("/api/characters", list));
const saveRelationships = debounceSave((list) => apiPost("/api/relationships", list));

function persist() {
  save(characters);
}

function persistRelationships() {
  saveRelationships(relationships);
}

function addWithTemplate(templateId) {
  const c = blank(templateId);
  characters.push(c);
  activeId = c.id;
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

// "+ Новый шаблон…" в меню выбора (template-choice.js) — заводит
// шаблон на лету, не открывая «Поля анкеты», и сразу же
// создаёт карточку по нему. С полей первого имеющегося шаблона (или
// пустого списка, если шаблонов ещё вовсе нет) — та же отправная
// точка, что у кнопки "+ Шаблон" в самих Настройках.
function addWithNewTemplate() {
  openTemplateEditorModal({
    initialFields: (templates[0]?.fields || []).map((f) => ({ ...f })),
    onSave: async ({ name, fields }) => {
      const fresh = { id: `t_${Date.now().toString(36)}`, name, fields };
      templates = [...templates, fresh];
      await saveTemplates("characters", templates);
      addWithTemplate(fresh.id);
    },
  });
}

function blank(templateId) {
  return {
    id: uid(),
    name: i18n("Новый персонаж"),
    color: PALETTE[characters.length % PALETTE.length],
    tags: "",
    parentIds: [],
    templateId: templateId || templates[0]?.id || "default",
  };
}

export async function renderCharacters(root, focusId) {
  container = root;
  inModal = root.classList.contains("entity-modal-body");
  [characters, relationships, timeline, factions, board, mapData, manuscript, tagsMap, templates] = await Promise.all([
    apiGet("/api/characters"),
    apiGet("/api/relationships"),
    apiGet("/api/timeline"),
    apiGet("/api/factions"),
    apiGet("/api/board"),
    apiGet("/api/map"),
    apiGet("/api/manuscript"),
    loadTagsMap(),
    loadTemplates("characters"),
  ]);
  board = flattenBoards(board);
  if (focusId && characters.some((c) => c.id === focusId)) {
    activeId = focusId;
    if (!inModal) {
      mode = "dossier";
      writePref(MODE_KEY, mode);
    }
  }
  draw();
}

// ── Что о ком известно ─────────────────────────

// Где персонаж встречается и с кем связан — один проход на отрисовку,
// им пользуются и карточки «Состава», и колонка «В сюжете» в «Досье».
function computePlot() {
  const byId = new Map(characters.map((c) => [c.id, c]));
  const chapterIds = (manuscript.chapters || []).map((ch) => ({
    ch,
    ids: new Set([...findMentionedIds(ch.content || "", characters), ...(ch.characterIds || [])]),
  }));
  const cards = Object.values(board.cards || {});
  plot = new Map();
  for (const c of characters) {
    const rels = relationships
      .filter((r) => r.charA === c.id || r.charB === c.id)
      .map((r) => ({ rel: r, other: byId.get(r.charA === c.id ? r.charB : r.charA) }))
      .filter((x) => x.other);
    const chapters = chapterIds.filter((x) => x.ids.has(c.id)).map((x) => x.ch);
    const events = timeline.filter((e) => (e.characterIds || []).includes(c.id));
    const facs = factions
      .filter((f) => f.leaderId === c.id || (f.memberIds || []).includes(c.id))
      .map((f) => ({ faction: f, leader: f.leaderId === c.id }));
    const boardCards = cards.filter((card) => cardCharacterIds(card).includes(c.id));
    const pins = [];
    for (const m of Object.values(mapData.maps || {})) {
      for (const pin of m.pins || []) if (pin.characterId === c.id) pins.push({ pin, map: m });
    }
    const score = chapters.length * 2 + events.length * 2 + rels.length * 2 + facs.length + boardCards.length + pins.length;
    plot.set(c.id, { rels, chapters, events, facs, boardCards, pins, score });
  }
}

// Рода — те же, что в Родословной: связные компоненты по родителям и парам.
function computeHouses() {
  const hasChild = new Set();
  for (const c of characters) for (const p of c.parentIds || []) hasChild.add(p);
  const inTree = characters.filter((c) => (c.parentIds || []).length || hasChild.has(c.id) || (c.partnerIds || []).length);
  houses = familyComponents(inTree).map((list) => {
    const ids = new Set(list.map((c) => c.id));
    const eldest = list.find((c) => !(c.parentIds || []).some((p) => ids.has(p))) || list[0];
    return { list, name: surnameHouseName(list) || i18n("Род: {name}", { name: eldest?.name || i18n("Без имени") }) };
  });
  houseOf = new Map();
  for (const h of houses) for (const c of h.list) houseOf.set(c.id, h);
}

function autoTier(c) {
  return (plot.get(c.id)?.score || 0) >= MAIN_SCORE ? "main" : "secondary";
}

// Теги в данных бывают и с маленькой буквы («протагонист») — сверяем без
// учёта регистра.
function findTag(c, names) {
  const have = new Set(parseTags(c.tags).map((t) => t.toLowerCase()));
  return names.find((n) => have.has(n.toLowerCase())) || "";
}

// Из группы тегов остаётся не больше одного: выбрали «Массовка» —
// «Второстепенный» снимается.
function setExclusiveTag(c, names, value) {
  const lower = new Set(names.map((n) => n.toLowerCase()));
  const rest = parseTags(c.tags).filter((t) => !lower.has(t.toLowerCase()));
  c.tags = stringifyTags(value ? [...rest, value] : rest);
}

function tierOf(c) {
  const roleTag = findTag(c, ROLE_TAGS.map(([name]) => name));
  if (roleTag) return ROLE_TAGS.find(([name]) => name === roleTag)[1];
  if (isDead(c)) return "gone";
  return autoTier(c);
}

function matches(c) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [c.name, c.role, c.tags].some((s) => (s || "").toLowerCase().includes(q));
}

function ageText(c) {
  const age = (c.age || "").trim();
  if (!age || (isDead(c) && age.length <= 2)) return "";
  return /^\d+$/.test(age) ? i18nPlural(Number(age), ["{n} год", "{n} года", "{n} лет"]) : age;
}

function factionText(c) {
  return (plot.get(c.id)?.facs || [])
    .map((x) => (x.leader ? i18n("{name} – глава", { name: x.faction.name }) : x.faction.name))
    .join(", ");
}

function scoreColor(score) {
  return score >= 30 ? "var(--color-8)" : score <= -30 ? "var(--color-3)" : "var(--text-faint)";
}

function plotSummary(c) {
  const p = plot.get(c.id);
  const parts = [];
  if (p.chapters.length) parts.push(i18nPlural(p.chapters.length, ["{n} глава", "{n} главы", "{n} глав"]));
  if (p.events.length) parts.push(i18nPlural(p.events.length, ["{n} событие", "{n} события", "{n} событий"]));
  if (p.boardCards.length) parts.push(i18nPlural(p.boardCards.length, ["{n} карточка", "{n} карточки", "{n} карточек"]));
  return parts.join(" · ");
}

// Родня одной строкой для плашки: «Супруг(а): Ренар · Ребёнок: Лия».
function kinLine(c, max) {
  const rel = relativesOf(c.id, characters);
  if (!rel) return "";
  return [...rel.partners, ...rel.parents, ...rel.children, ...rel.siblings]
    .slice(0, max)
    .map((x) => `${x.label}: ${shortName(x.c.name)}`)
    .join(" · ");
}

function deadMark(c) {
  return isDead(c) ? ` <span class="cast-dagger" title="${escapeHtml(i18n("Умер(ла)"))}">†</span>` : "";
}

// ── Отрисовка ──────────────────────────────────

function draw() {
  computePlot();
  computeHouses();
  container.innerHTML = "";
  if (inModal) {
    const c = characters.find((x) => x.id === activeId);
    if (c) container.appendChild(buildDossier(c));
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
  const shown = characters.filter(matches).length;
  metaEl.textContent = shown === characters.length
    ? i18nPlural(characters.length, ["{n} персонаж", "{n} персонажа", "{n} персонажей"])
    : i18nPlural(characters.length, ["{shown} из {total} персонажа", "{shown} из {total} персонажей", "{shown} из {total} персонажей"], { shown }, "total");
  bodyEl.innerHTML = "";
  bodyEl.appendChild(mode === "cast" ? buildCast() : buildDossierView());
}

function buildToolbar() {
  const extra = mode === "cast"
    ? buildSegmented(GROUPS, groupBy, (key) => {
      groupBy = key;
      writePref(GROUP_KEY, groupBy);
      draw();
    })
    : null;
  const pickTemplate = (btn, forceMenu) =>
    chooseTemplate(templates, btn, addWithTemplate, { forceMenu, onCreateNew: addWithNewTemplate });
  const { bar, metaEl: meta } = buildEntityToolbar({
    title: i18n("Персонажи"),
    fieldsKind: "characters",
    modes: MODES,
    mode,
    onMode: (key) => {
      mode = key;
      writePref(MODE_KEY, mode);
      draw();
    },
    extra,
    placeholder: i18n("Имя, роль или тег…"),
    query,
    onSearch: (value) => {
      query = value;
      drawBody();
    },
    addLabel: i18n("+ Персонаж"),
    onAdd: (btn) => pickTemplate(btn, false),
    onAddMenu: (btn) => pickTemplate(btn, true),
  });
  metaEl = meta;
  return bar;
}

function openDossier(id) {
  activeId = id;
  mode = "dossier";
  writePref(MODE_KEY, mode);
  draw();
}

// ── «Состав» ───────────────────────────────────

function buildCast() {
  const scroll = document.createElement("div");
  scroll.className = "cast-scroll";
  if (!characters.length) {
    scroll.appendChild(buildEmptyState(i18n("Персонажей пока нет – добавь первого."), "user"));
    return scroll;
  }
  const list = characters.filter(matches);
  if (!list.length) {
    scroll.appendChild(buildEmptyState(i18n("Никого не нашлось."), "user"));
    return scroll;
  }

  const dragState = { current: null };
  const addSection = (title, members, render) => {
    if (!members.length) return;
    scroll.appendChild(buildOverviewSection(title, members, {
      render,
      onOpen: openDossier,
      dragState,
      list: () => characters,
      onReorder: reorder,
    }));
  };
  const byTier = (c) => (tierOf(c) === "main" ? buildMainCard(c) : buildPlainCard(c));

  if (groupBy === "importance") {
    for (const [key, label] of TIERS) {
      addSection(i18n(label), list.filter((c) => tierOf(c) === key), key === "main" ? buildMainCard : buildPlainCard);
    }
  } else if (groupBy === "house") {
    for (const h of houses) addSection(h.name, list.filter((c) => houseOf.get(c.id) === h), byTier);
    addSection(i18n("Вне родов"), list.filter((c) => !houseOf.has(c.id)), byTier);
  } else {
    const placed = new Set();
    for (const f of factions) {
      const ids = new Set([f.leaderId, ...(f.memberIds || [])].filter(Boolean));
      const members = list.filter((c) => ids.has(c.id));
      members.forEach((c) => placed.add(c.id));
      addSection(f.name || i18n("Без названия"), members, byTier);
    }
    addSection(i18n("Вне фракций"), list.filter((c) => !placed.has(c.id)), byTier);
  }
  return scroll;
}

// Суть персонажа на крупной карточке: цель, мотив, слабость — если в
// шаблоне таких полей нет, первые заполненные многострочные поля.
function summaryFields(c) {
  const fields = (templateFor(templates, c.templateId)?.fields || []).filter((f) => (c[f.key] || "").trim());
  const preferred = ["goal", "motivation", "flaws"].map((k) => fields.find((f) => f.key === k)).filter(Boolean);
  if (preferred.length) return preferred;
  return fields.filter((f) => f.type !== "input" && !["appearance", "backstory"].includes(f.key)).slice(0, 3);
}

function buildMainCard(c) {
  const p = plot.get(c.id);
  const sub = [ageText(c), houseOf.get(c.id)?.name, factionText(c)].filter(Boolean).join(" · ");
  const lines = summaryFields(c)
    .map((f) => `<div class="cast-line"><span>${escapeHtml(f.label)}</span><p>${escapeHtml(c[f.key])}</p></div>`)
    .join("");
  const rels = p.rels.slice(0, 4).map(({ rel, other }) => `
    <span class="cast-rel" style="--rel-color:${scoreColor(rel.score || 0)}"><i></i>${escapeHtml(shortName(other.name))}${rel.label ? `<em>${escapeHtml(rel.label)}</em>` : ""}</span>
  `).join("");
  const tags = parseTags(c.tags).slice(0, 3).map((t) => `<span class="cast-tag">${escapeHtml(t)}</span>`).join("");
  const card = document.createElement("button");
  card.className = "cast-card cast-card-main";
  card.innerHTML = `
    <div class="cast-card-head">
      ${personAvatarHtml(c, "cast-avatar cast-avatar-lg")}
      <div class="cast-card-title">
        <div class="cast-name">${escapeHtml(c.name || i18n("Без имени"))}${deadMark(c)}</div>
        ${c.role ? `<div class="cast-role">${escapeHtml(c.role)}</div>` : ""}
        ${sub ? `<div class="cast-sub">${escapeHtml(sub)}</div>` : ""}
      </div>
    </div>
    ${lines}
    ${rels ? `<div class="cast-rels">${rels}</div>` : ""}
    <div class="cast-card-foot">
      <div class="cast-tags">${tags}</div>
      <div class="cast-stat">${escapeHtml(plotSummary(c) || i18n("нигде не встречается"))}</div>
    </div>
  `;
  return card;
}

function buildPlainCard(c) {
  const kin = kinLine(c, 2);
  const card = document.createElement("button");
  card.className = "cast-card cast-card-plain" + (isDead(c) ? " dead" : "");
  card.innerHTML = `
    ${personAvatarHtml(c, "cast-avatar")}
    <div class="cast-card-title">
      <div class="cast-name-sm">${escapeHtml(c.name || i18n("Без имени"))}${deadMark(c)}</div>
      ${c.role ? `<div class="cast-role">${escapeHtml(c.role)}</div>` : ""}
      ${kin ? `<div class="cast-kin">${escapeHtml(kin)}</div>` : ""}
    </div>
  `;
  return card;
}

// ── «Досье» ────────────────────────────────────

function buildDossierView() {
  const shown = characters.filter(matches);
  if (!characters.some((c) => c.id === activeId)) activeId = (shown[0] || characters[0])?.id || null;
  const groups = TIERS.map(([key, label]) => ({
    title: i18n(label),
    items: shown.filter((c) => tierOf(c) === key).map((c) => ({
      item: c,
      leadHtml: personAvatarHtml(c, "cast-avatar cast-avatar-sm"),
      sub: c.role,
      dead: isDead(c),
      nameSuffix: deadMark(c),
    })),
  }));
  const list = buildDossierList(groups, activeId, {
    onPick: (id) => {
      activeId = id;
      drawBody();
    },
    dragState: { current: null },
    list: () => characters,
    onReorder: reorder,
    emptyText: i18n(characters.length ? "Никого не нашлось." : "Персонажей пока нет."),
  });
  const active = characters.find((c) => c.id === activeId);
  return buildDossierSplit(list, active ? buildDossier(active) : buildEmptyState(i18n("Персонажей пока нет – добавь первого."), "user"));
}

function reorder(list) {
  characters = list;
  persist();
  drawBody();
}

function buildDossier(c) {
  const page = document.createElement("div");
  page.className = "dossier";
  const template = templateFor(templates, c.templateId);
  const fields = template?.fields || [];
  const roleField = fields.find((f) => f.key === "role");
  const ageField = fields.find((f) => f.key === "age");

  // ── Шапка
  const head = document.createElement("div");
  head.className = "dossier-head";
  const avatar = document.createElement("div");
  avatar.className = "cast-avatar dossier-avatar";
  avatar.style.background = c.color;
  avatar.innerHTML = avatarInnerHtml(c, escapeHtml(initials(c.name)));

  const titleCol = document.createElement("div");
  titleCol.className = "dossier-title";
  const nameRow = document.createElement("div");
  nameRow.className = "drawer-name-row";
  // Имя и роль меняют строку в списке слева сразу, без перерисовки.
  const onName = () => {
    updateListRow(bodyEl, c.id, { name: c.name });
    if (!c.images?.[0]) avatar.textContent = initials(c.name);
    persist();
  };
  const nameField = buildNameInput(c, onName);
  nameRow.append(nameField, buildNameGeneratorButton((name) => {
    nameField.value = name;
    c.name = name;
    onName();
  }));
  titleCol.appendChild(nameRow);

  if (roleField) {
    const role = document.createElement("input");
    role.className = "dossier-role";
    role.value = c.role || "";
    role.placeholder = i18n("Роль в истории");
    role.addEventListener("input", () => {
      c.role = role.value;
      updateListRow(bodyEl, c.id, { sub: c.role });
      persist();
    });
    titleCol.appendChild(role);
  }
  const tagChips = parseTags(c.tags);
  if (tagChips.length) {
    const tags = document.createElement("div");
    tags.className = "cast-tags";
    tags.innerHTML = tagChips.map((t) => `<span class="cast-tag">${escapeHtml(t)}</span>`).join("");
    titleCol.appendChild(tags);
  }

  const actions = document.createElement("div");
  actions.className = "dossier-actions";
  const delBtn = document.createElement("button");
  delBtn.className = "btn danger";
  delBtn.innerHTML = `${iconSvg("trash", 14)}<span>${escapeHtml(i18n("Удалить"))}</span>`;
  delBtn.addEventListener("click", async () => {
    await pushTrash("character", c);
    characters = characters.filter((x) => x.id !== c.id);
    activeId = null;
    persist();
    if (inModal) closeEntityModal();
    else draw();
  });
  actions.appendChild(delBtn);
  head.append(avatar, titleCol, actions);
  page.appendChild(head);

  // ── Сводка
  page.appendChild(buildFacts(c, ageField));

  // ── Анкета и боковая колонка
  const cols = document.createElement("div");
  cols.className = "dossier-cols";
  const main = document.createElement("div");
  main.className = "dossier-main";
  const side = document.createElement("aside");
  side.className = "dossier-side";

  main.appendChild(sectionHeading(i18n("Анкета")));
  main.appendChild(buildTemplateFields(c, fields, ["role", "age"], () => persist()));

  main.appendChild(sectionHeading(i18n("Облик и метки")));
  const colorRow = document.createElement("div");
  colorRow.className = "color-row";
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
  main.appendChild(colorRow);
  main.appendChild(buildAvatarsField(c, () => { persist(); draw(); }));
  main.appendChild(buildTagsField(tagsMap, c.tags, (value) => {
    c.tags = value;
    persist();
  }));

  side.appendChild(sectionHeading(i18n("Отношения")));
  side.appendChild(buildRelationshipsField(c));
  side.appendChild(sectionHeading(i18n("Семья")));
  side.appendChild(buildFamily(c));
  side.appendChild(sectionHeading(i18n("В сюжете")));
  side.appendChild(buildAppearances(c));

  cols.append(main, side);
  page.appendChild(cols);
  return page;
}

function buildFacts(c, ageField) {
  const facts = document.createElement("div");
  facts.className = "dossier-facts";

  if (ageField) {
    const age = document.createElement("input");
    age.value = c.age || "";
    age.placeholder = "–";
    age.addEventListener("input", () => {
      c.age = age.value;
      persist();
    });
    facts.appendChild(buildFact(ageField.label, age));
  }

  // Пол — необязателен; нужен Родословной, чтобы писать «отец», «сестра»,
  // «мачеха», а не «родитель», «брат или сестра».
  facts.appendChild(buildFact(i18n("Пол"), buildSelect(GENDERS, c.gender || "", (value) => {
    if (value) c.gender = value;
    else delete c.gender;
    persist();
    drawDossierOnly(c);
  })));

  const roleNames = ROLE_TAGS.map(([name]) => name);
  const autoLabel = TIERS.find(([k]) => k === (isDead(c) ? "gone" : autoTier(c)))[1];
  const role = buildSelect(
    [["", i18n("Сам решит: {tier}", { tier: i18n(autoLabel).toLowerCase() })], ...roleNames.map((n) => [n, n])],
    findTag(c, roleNames),
    (value) => {
      setExclusiveTag(c, roleNames, value);
      persist();
      draw();
    },
  );
  role.title = i18n("Пока не выбрано, главными считаются те, у кого больше всего сцен, событий и связей");
  facts.appendChild(buildFact(i18n("Роль в сюжете"), role));

  facts.appendChild(buildFact(i18n("Статус"), buildSelect(
    [["", "не указан"], ...STATUS_TAGS.map((n) => [n, n])],
    findTag(c, STATUS_TAGS),
    (value) => {
      setExclusiveTag(c, STATUS_TAGS, value);
      persist();
      draw();
    },
  )));

  facts.appendChild(buildFactText(i18n("Род"), houseOf.get(c.id)?.name));
  facts.appendChild(buildFactText(i18n("Фракция"), factionText(c)));
  return facts;
}

// Перерисовать только страницу персонажа (например, сменился пол — и
// подписи родства вместе с ним: «свёкор» вместо «отец супруга»), не
// трогая список и фокус в поиске.
function drawDossierOnly(c) {
  if (inModal || mode !== "dossier") {
    draw();
    return;
  }
  const detail = bodyEl.querySelector(".dossier-detail");
  const scroll = detail.scrollTop;
  detail.innerHTML = "";
  detail.appendChild(buildDossier(c));
  detail.scrollTop = scroll;
}

function buildFamily(c) {
  const wrap = document.createElement("div");
  wrap.className = "dossier-family";
  const rel = relativesOf(c.id, characters);
  const groups = rel
    ? [rel.grandparents, rel.parents, rel.stepParents, rel.partners, rel.siblings, rel.children, rel.stepChildren, rel.grandchildren, rel.auntsUncles, rel.cousins, rel.nephews, rel.inLaws]
    : [];
  const kin = groups.flat();
  for (const x of kin) {
    wrap.appendChild(buildLinkRow(personAvatarHtml(x.c, "cast-avatar cast-avatar-xs"), x.c.name || i18n("Без имени"), x.label, () => {
      activeId = x.c.id;
      if (inModal) draw();
      else drawBody();
    }));
  }
  if (!kin.length) wrap.appendChild(buildNone(i18n("Родня не указана")));

  const edit = document.createElement("details");
  edit.className = "dossier-family-edit";
  const summary = document.createElement("summary");
  summary.textContent = i18n("Изменить родителей и пары");
  edit.append(summary, buildParentsField(c), buildPartnersField(c));
  wrap.appendChild(edit);
  return wrap;
}

function buildAppearances(c) {
  const p = plot.get(c.id);
  const wrap = document.createElement("div");
  wrap.className = "dossier-appearances";
  const row = (icon, text, note, onClick) => wrap.appendChild(buildLinkRow(iconLead(iconSvg(icon, 13)), text, note, onClick));
  for (const ch of p.chapters) row("manuscript", chapterLabel(ch, manuscript.books), "", () => openEntity("chapter", ch.id));
  for (const e of p.events) row("timeline", e.title || i18n("Без названия"), e.date || "");
  for (const x of p.facs) {
    row("factions", x.faction.name || i18n("Без названия"), x.leader ? i18n("глава") : "", () => openEntity("faction", x.faction.id));
  }
  for (const card of p.boardCards) row("board", card.title || i18n("Без названия"), "");
  for (const x of p.pins) row("map", x.pin.label || i18n("Метка"), x.map.name || "");
  if (!wrap.children.length) wrap.appendChild(buildNone(i18n("Пока нигде не встречается")));
  return wrap;
}

// Мини-редактор связей прямо в досье — та же коллекция
// relationships.json, что и редактор дуги во вкладке «Отношения»
// (graph.js, openRelEditor), просто отфильтрованная под текущего
// персонажа.
function buildRelationshipsField(c) {
  const wrap = document.createElement("div");
  wrap.className = "rel-mini-field";

  const list = document.createElement("div");
  list.className = "rel-mini-list";
  wrap.appendChild(list);

  function otherId(rel) {
    return rel.charA === c.id ? rel.charB : rel.charA;
  }

  function renderList() {
    list.innerHTML = "";
    const others = characters.filter((x) => x.id !== c.id);
    for (const rel of relationships.filter((r) => r.charA === c.id || r.charB === c.id)) {
      const row = document.createElement("div");
      row.className = "rel-row rel-mini-row";

      const top = document.createElement("div");
      top.className = "rel-row-top";
      const sel = characterSelect(others, otherId(rel));
      sel.addEventListener("change", () => {
        if (rel.charA === c.id) rel.charB = sel.value;
        else rel.charA = sel.value;
        persistRelationships();
      });
      const delBtn = document.createElement("button");
      delBtn.className = "btn danger";
      delBtn.innerHTML = iconSvg("close", 12);
      delBtn.title = i18n("Удалить связь");
      delBtn.addEventListener("click", async () => {
        await pushTrash("relationship", rel);
        relationships = relationships.filter((r) => r.id !== rel.id);
        persistRelationships();
        renderList();
      });
      top.append(sel, delBtn);
      row.appendChild(top);

      const labelInput = document.createElement("input");
      labelInput.className = "field-inline-control field-inline-control-bright rel-row-label";
      labelInput.placeholder = i18n("Метка (наставник, вражда…)");
      labelInput.value = rel.label || "";
      labelInput.addEventListener("input", () => { rel.label = labelInput.value; persistRelationships(); });
      row.appendChild(labelInput);

      const sliderRow = document.createElement("div");
      sliderRow.className = "rel-sliders";
      const scoreLabel = document.createElement("span");
      scoreLabel.className = "rel-score-label";
      scoreLabel.textContent = rel.score || 0;
      const slider = document.createElement("input");
      slider.type = "range";
      slider.className = "rel-slider";
      slider.min = -100;
      slider.max = 100;
      slider.value = rel.score || 0;
      slider.title = i18n("От вражды (−100) до близости (100)");
      slider.addEventListener("input", () => {
        rel.score = Number(slider.value);
        scoreLabel.textContent = rel.score;
        persistRelationships();
      });
      sliderRow.append(scoreLabel, slider);
      row.appendChild(sliderRow);

      list.appendChild(row);
    }
  }
  renderList();

  const addBtn = document.createElement("button");
  addBtn.className = "btn rel-mini-add";
  addBtn.textContent = i18n("+ Добавить связь");
  addBtn.addEventListener("click", () => {
    const other = characters.find((x) => x.id !== c.id);
    if (!other) return;
    relationships.push({ id: uid(), charA: c.id, charB: other.id, label: "", score: 0, note: "" });
    persistRelationships();
    renderList();
  });
  wrap.appendChild(addBtn);

  return wrap;
}

// Под выбранными фишками — строка «кто это»: у родителя родной /
// приёмный / предполагаемый, у пары — её вид (kinship.js). Состав строки
// меняется вместе с выбором, поэтому обе части перерисовываются своими
// локальными функциями, а не одним onChange наружу.
function buildKindRow(row, name, select) {
  const item = document.createElement("label");
  item.className = "parent-adopt-chip";
  const text = document.createElement("span");
  text.textContent = name || i18n("Без имени");
  item.append(text, select);
  row.appendChild(item);
}

function buildParentsField(c) {
  const field = document.createElement("div");
  field.className = "field";
  const label = document.createElement("label");
  label.textContent = i18n("Родители");
  field.appendChild(label);

  const chipsRow = document.createElement("div");
  chipsRow.className = "timeline-filter-bar";
  field.appendChild(chipsRow);

  const kindsRow = document.createElement("div");
  kindsRow.className = "parent-adopt-row";
  field.appendChild(kindsRow);

  function renderKinds() {
    kindsRow.innerHTML = "";
    for (const pid of c.parentIds || []) {
      const p = characters.find((x) => x.id === pid);
      if (!p) continue;
      buildKindRow(kindsRow, p.name, buildSelect(PARENT_KINDS, parentKind(c, pid), (kind) => {
        setParentKind(c, pid, kind);
        persist();
      }));
    }
  }

  function renderChips() {
    chipsRow.innerHTML = "";
    for (const other of characters.filter((x) => x.id !== c.id)) {
      const active = (c.parentIds || []).includes(other.id);
      const chip = document.createElement("button");
      chip.className = "filter-chip" + (active ? " active" : "");
      chip.style.setProperty("--chip-color", other.color || "#7c7157");
      chip.textContent = other.name || i18n("Без имени");
      chip.addEventListener("click", () => {
        if (active) forgetParent(c, other.id);
        else c.parentIds = [...(c.parentIds || []), other.id];
        persist();
        renderChips();
        renderKinds();
      });
      chipsRow.appendChild(chip);
    }
  }
  renderChips();
  renderKinds();

  return field;
}

// Пары — симметричная связь: добавили B партнёром A, у B тоже должен
// появиться A (и тот же вид пары), иначе family-tree.js не нарисует их
// как пару. Оба объекта — ссылки на элементы одного и того же characters,
// поэтому один persist() пишет обе стороны разом.
function buildPartnersField(c) {
  const field = document.createElement("div");
  field.className = "field";
  const label = document.createElement("label");
  label.textContent = i18n("Партнёры / супруги");
  field.appendChild(label);

  const row = document.createElement("div");
  row.className = "timeline-filter-bar";
  field.appendChild(row);

  const kindsRow = document.createElement("div");
  kindsRow.className = "parent-adopt-row";
  field.appendChild(kindsRow);

  function renderKinds() {
    kindsRow.innerHTML = "";
    for (const pid of c.partnerIds || []) {
      const other = characters.find((x) => x.id === pid);
      if (!other) continue;
      buildKindRow(kindsRow, other.name, buildSelect(PARTNER_KINDS, partnerKind(c, pid), (kind) => {
        setPartnerKind(c, other, kind);
        persist();
      }));
    }
  }

  function render() {
    row.innerHTML = "";
    for (const other of characters.filter((x) => x.id !== c.id)) {
      const active = (c.partnerIds || []).includes(other.id);
      const chip = document.createElement("button");
      chip.className = "filter-chip" + (active ? " active" : "");
      chip.style.setProperty("--chip-color", other.color || "#7c7157");
      chip.textContent = other.name || i18n("Без имени");
      chip.addEventListener("click", () => {
        if (active) {
          forgetPartner(c, other);
        } else {
          c.partnerIds = [...new Set([...(c.partnerIds || []), other.id])];
          other.partnerIds = [...new Set([...(other.partnerIds || []), c.id])];
        }
        persist();
        render();
        renderKinds();
      });
      row.appendChild(chip);
    }
    if (characters.length <= 1) {
      const none = document.createElement("span");
      none.className = "filter-count";
      none.textContent = i18n("пока нет");
      row.appendChild(none);
    }
  }
  render();
  renderKinds();

  return field;
}
