import { apiGet, apiPost, uid } from "./api.js";
import { debounceSave } from "./save-badge.js";
import { escapeHtml, buildEmptyState } from "./chips.js";
import { iconSvg } from "./icons.js";
import { pushTrash, addTrashLinks } from "./trash.js";
import { detachEntry } from "./cascade.js";
import { loadTagsMap, buildTagsField, parseTags } from "./tags.js";
import { avatarInnerHtml, buildAvatarsField } from "./avatars.js";
import { loadTemplates, saveTemplates, templateFor } from "./templates.js";
import { chooseTemplate } from "./template-choice.js";
import { closeEntityModal } from "./entity-modal.js";
import { openPopover, closeMenu } from "./context-menu.js";
import { makeDialog } from "./a11y.js";
import { i18n, i18nPlural } from "./i18n.js";
import { linkedEntityIds } from "./text-format.js";
import {
  readPref, writePref, buildEntityToolbar, buildOverviewSection, buildDossierList, buildDossierSplit,
  updateListRow, sectionHeading, buildNone, buildNameInput, buildTemplateFields, buildLinkRow, iconLead, buildSecretToggle,
} from "./entity-view.js";

// ══════════════════════════════════════════════
//  СВОИ РАЗДЕЛЫ МИРА
//
//  «Магия», «Артефакты», «Виды существ» — разделы, которые заводит сам
//  автор. Устроены как Фракции: карточки («Обзор») и досье (список
//  слева, страница справа), анкета по шаблону, картинки, теги, «Тайна».
//  На запись можно сослаться в тексте главы: [[entry:id|слово]].
//
//  Данные — entries.json: { sections: [{ id, name, icon, color }],
//  entries: [{ id, sectionId, name, tags, templateId, images, ... }] }.
//  Шаблоны анкет раздела — site-settings.json → templates["section:<id>"].
//  На боковой панели каждый раздел — плитка в «Мире» (sidebar-overview.js).
// ══════════════════════════════════════════════

export const SECTION_ICONS = ["flame", "gem", "crown", "sword", "shield", "coin", "book", "globe", "lightbulb", "landmark", "door", "eye", "route", "network"];
export const SECTION_COLORS = ["#c9944a", "#a4483c", "#4f7d74", "#6a8fae", "#7d6a9e", "#9a9250", "#b5636b", "#5a8a5f"];

// Готовые разделы: название, значок, цвет и поля анкеты.
export function sectionPresets() {
  const f = (label, type = "textarea") => ({ key: `f_${uid()}`, label: i18n(label), type });
  return [
    { name: i18n("Магия"), icon: "flame", color: "#c9944a", fields: () => [f("Источник"), f("Цена"), f("Ограничения"), f("Кто владеет"), f("Как выглядит")] },
    { name: i18n("Артефакты"), icon: "gem", color: "#7d6a9e", fields: () => [f("Что это", "input"), f("Свойства"), f("Происхождение"), f("Где сейчас", "input"), f("Владелец", "input")] },
    { name: i18n("Виды существ"), icon: "eye", color: "#5a8a5f", fields: () => [f("Где обитают", "input"), f("Облик"), f("Повадки"), f("Опасность", "input"), f("Отношение к людям")] },
    { name: i18n("Государства"), icon: "crown", color: "#a4483c", fields: () => [f("Столица", "input"), f("Правитель", "input"), f("Строй", "input"), f("История", "richtext"), f("Соседи")] },
    { name: i18n("Религии"), icon: "landmark", color: "#9a9250", fields: () => [f("Божества"), f("Учение"), f("Обряды"), f("Священные места"), f("Ереси")] },
    { name: i18n("Языки"), icon: "book", color: "#6a8fae", fields: () => [f("Кто говорит", "input"), f("Звучание"), f("Письменность"), f("Словарь", "richtext")] },
    { name: i18n("Пустой раздел"), icon: "folder", color: "#7d6a9e", fields: () => [f("Описание"), f("Заметки")] },
  ];
}

export const sectionKind = (id) => `section:${id}`;

// Записи с разделом рядом (_sec) — для ссылок в тексте, поиска, подсказки «@».
// Записи удалённых разделов не попадают.
export function entryViews(data) {
  const byId = new Map((data?.sections || []).map((s) => [s.id, s]));
  return (data?.entries || []).filter((e) => byId.has(e.sectionId)).map((e) => ({ ...e, _sec: byId.get(e.sectionId) }));
}

const EMPTY = { sections: [], entries: [] };
export async function loadEntries() {
  const data = await apiGet("/api/entries").catch(() => EMPTY);
  return {
    sections: Array.isArray(data?.sections) ? data.sections : [],
    entries: Array.isArray(data?.entries) ? data.entries : [],
  };
}

// ── Новый раздел ──
// Окно поверх экрана: готовый раздел, название, значок, цвет. onCreated(section).
export function openNewSectionDialog(onCreated) {
  const presets = sectionPresets();
  let preset = presets[0];
  let icon = preset.icon;
  let color = preset.color;

  const backdrop = document.createElement("div");
  backdrop.className = "entity-modal-backdrop";
  const panel = document.createElement("div");
  panel.className = "entity-modal-panel sec-new";
  panel.innerHTML = `
    <h2 class="sec-new-title"></h2>
    <div class="sec-new-label" data-l="preset"></div><div class="sec-new-presets"></div>
    <label class="sec-new-label" for="secNewName" data-l="name"></label><input id="secNewName" class="sec-new-input" maxlength="40">
    <div class="sec-new-label" data-l="icon"></div><div class="sec-new-icons"></div>
    <div class="sec-new-label" data-l="color"></div><div class="sec-new-colors"></div>
    <div class="sec-new-fields"></div>
    <div class="sec-new-actions"><button class="btn" data-a="cancel"></button><button class="btn primary" data-a="ok"></button></div>`;
  panel.querySelector(".sec-new-title").textContent = i18n("Новый раздел мира");
  panel.querySelector('[data-l="preset"]').textContent = i18n("Начать с готового");
  panel.querySelector('[data-l="name"]').textContent = i18n("Название");
  panel.querySelector('[data-l="icon"]').textContent = i18n("Значок");
  panel.querySelector('[data-l="color"]').textContent = i18n("Цвет");
  panel.querySelector('[data-a="cancel"]').textContent = i18n("Отмена");
  panel.querySelector('[data-a="ok"]').textContent = i18n("Создать");
  const nameInput = panel.querySelector(".sec-new-input");
  const presetBox = panel.querySelector(".sec-new-presets");
  const iconBox = panel.querySelector(".sec-new-icons");
  const colorBox = panel.querySelector(".sec-new-colors");
  const fieldsNote = panel.querySelector(".sec-new-fields");

  const paint = () => {
    presetBox.innerHTML = "";
    for (const p of presets) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sec-new-chip" + (p === preset ? " on" : "");
      b.innerHTML = `${iconSvg(p.icon, 13)}<span></span>`;
      b.querySelector("span").textContent = p.name;
      b.addEventListener("click", () => {
        const autoName = !nameInput.value.trim() || presets.some((x) => x.name === nameInput.value.trim());
        preset = p;
        icon = p.icon;
        color = p.color;
        if (autoName) nameInput.value = p === presets[presets.length - 1] ? "" : p.name;
        paint();
      });
      presetBox.appendChild(b);
    }
    iconBox.innerHTML = "";
    for (const name of [...new Set([preset.icon, ...SECTION_ICONS])]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sec-new-icon" + (name === icon ? " on" : "");
      b.innerHTML = iconSvg(name, 16);
      b.addEventListener("click", () => { icon = name; paint(); });
      iconBox.appendChild(b);
    }
    colorBox.innerHTML = "";
    for (const c of SECTION_COLORS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sec-new-color" + (c === color ? " on" : "");
      b.style.background = c;
      b.title = c;
      b.addEventListener("click", () => { color = c; paint(); });
      colorBox.appendChild(b);
    }
    fieldsNote.textContent = i18n("Поля анкеты: {list}. Их можно поменять потом – «Поля анкеты» в разделе.", {
      list: preset.fields().map((x) => x.label).join(" · "),
    });
  };
  nameInput.value = preset.name;
  paint();

  const close = () => {
    backdrop.remove();
    release();
    document.removeEventListener("keydown", onKey);
  };
  const create = async () => {
    const name = nameInput.value.trim() || preset.name;
    const data = await loadEntries();
    const section = { id: uid(), name, icon, color };
    data.sections.push(section);
    await apiPost("/api/entries", data);
    await saveTemplates(sectionKind(section.id), [{ id: "default", name: i18n("По умолчанию"), fields: preset.fields() }]);
    close();
    document.dispatchEvent(new CustomEvent("fictaris:sections-changed"));
    onCreated?.(section);
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
    if (e.key === "Enter" && e.target === nameInput) create();
  };
  panel.querySelector('[data-a="cancel"]').addEventListener("click", close);
  panel.querySelector('[data-a="ok"]').addEventListener("click", create);
  backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) close(); });
  document.addEventListener("keydown", onKey);
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  const release = makeDialog(panel, i18n("Новый раздел мира"));
  nameInput.focus();
  nameInput.select();
}

// ── Раздел ──
const MODES = [
  ["overview", "Обзор", "Все записи карточками"],
  ["dossier", "Досье", "Список слева, страница записи справа"],
];

let data = { sections: [], entries: [] };
let section = null;
let templates = [];
let tagsMap = {};
let chapters = [];
let activeId = null;
let container = null;
let inModal = false;
let query = "";
let mode = "overview";
let bodyEl = null;
let metaEl = null;
const save = debounceSave((value) => apiPost("/api/entries", value));

function persist() {
  save(data);
}

const modeKey = () => `fictaris_section_mode:${section?.id}`;
const entriesHere = () => data.entries.filter((e) => e.sectionId === section.id);

// arg — id раздела или id записи (ссылка из текста, поиск, «Недавнее»).
export async function renderSection(root, arg) {
  container = root;
  inModal = root.classList.contains("entity-modal-body");
  const [loaded, tags, manuscript] = await Promise.all([loadEntries(), loadTagsMap(), apiGet("/api/manuscript").catch(() => ({ chapters: [] }))]);
  data = loaded;
  tagsMap = tags;
  chapters = manuscript.chapters || [];
  const entry = data.entries.find((e) => e.id === arg);
  section = data.sections.find((s) => s.id === (entry ? entry.sectionId : arg)) || null;
  if (!section) {
    root.replaceChildren(buildEmptyState(i18n("Такого раздела уже нет."), "folder"));
    return;
  }
  templates = await loadTemplates(sectionKind(section.id));
  if (!inModal) document.dispatchEvent(new CustomEvent("fictaris:section-shown", { detail: { id: section.id } }));
  mode = readPref(modeKey(), MODES.map(([k]) => k), "overview");
  query = "";
  if (entry) {
    activeId = entry.id;
    if (!inModal) mode = "dossier";
  } else if (!entriesHere().some((e) => e.id === activeId)) {
    activeId = null;
  }
  draw();
}

function blank(templateId) {
  return { id: uid(), sectionId: section.id, name: i18n("Новая запись"), tags: "", templateId: templateId || templates[0]?.id || "default" };
}

function addWithTemplate(templateId) {
  const e = blank(templateId);
  data.entries.push(e);
  activeId = e.id;
  if (!inModal) {
    mode = "dossier";
    writePref(modeKey(), mode);
  }
  persist();
  draw();
  const name = container.querySelector(".dossier-name");
  name?.focus();
  name?.select();
}

function matches(e) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const fields = templateFor(templates, e.templateId)?.fields || [];
  return [e.name, e.tags, ...fields.map((f) => e[f.key])].some((s) => String(s || "").toLowerCase().includes(q));
}

function tileHtml(e, cls, size) {
  return `<div class="${cls}" style="background:${section.color || "#7d6a9e"}">${avatarInnerHtml(e, iconSvg(section.icon || "folder", size))}</div>`;
}

// Подпись: первая заполненная строка анкеты.
function subtitle(e) {
  const f = (templateFor(templates, e.templateId)?.fields || []).find((x) => x.type === "input" && String(e[x.key] || "").trim());
  return f ? e[f.key] : section.name;
}

function blurb(e) {
  const f = (templateFor(templates, e.templateId)?.fields || []).find((x) => x.type !== "input" && x.type !== "date" && String(e[x.key] || "").trim());
  return f ? String(e[f.key]).replace(/^#+\s*/gm, "") : "";
}

function chaptersWith(e) {
  return chapters.filter((ch) => linkedEntityIds(ch.content, "entry").has(e.id));
}

function draw() {
  container.innerHTML = "";
  if (inModal) {
    const e = data.entries.find((x) => x.id === activeId);
    if (e) container.appendChild(buildPage(e));
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

function drawBody() {
  const all = entriesHere();
  const shown = all.filter(matches).length;
  metaEl.textContent = shown === all.length
    ? i18nPlural(all.length, ["{n} запись", "{n} записи", "{n} записей"])
    : i18nPlural(all.length, ["{shown} из {total} записи", "{shown} из {total} записей", "{shown} из {total} записей"], { shown }, "total");
  bodyEl.innerHTML = "";
  bodyEl.appendChild(mode === "overview" ? buildOverview() : buildDossierView());
}

function buildToolbar() {
  const pickTemplate = (btn, forceMenu) => chooseTemplate(templates, btn, addWithTemplate, { forceMenu });
  const more = document.createElement("button");
  more.className = "btn fe-icon-btn";
  more.innerHTML = iconSvg("more", 15);
  more.title = i18n("Раздел: название, значок, цвет, удалить");
  more.setAttribute("aria-label", more.title);
  more.addEventListener("click", () => openSectionMenu(more));
  const { bar, metaEl: meta } = buildEntityToolbar({
    title: section.name,
    fieldsKind: sectionKind(section.id),
    modes: MODES,
    mode,
    onMode: (key) => {
      mode = key;
      writePref(modeKey(), mode);
      draw();
    },
    extra: more,
    placeholder: i18n("Название, поле или тег…"),
    query,
    onSearch: (value) => {
      query = value;
      drawBody();
    },
    addLabel: i18n("+ Запись"),
    onAdd: (btn) => pickTemplate(btn, false),
    onAddMenu: (btn) => pickTemplate(btn, true),
  });
  metaEl = meta;
  return bar;
}

// Меню раздела: переименовать, значок и цвет, удалить (записи — в корзину).
function openSectionMenu(anchor) {
  const box = document.createElement("div");
  box.className = "sec-menu";
  box.innerHTML = `<label class="sec-new-label"></label><input class="sec-new-input"><div class="sec-new-label" data-l="icon"></div><div class="sec-new-icons"></div><div class="sec-new-colors"></div><button class="btn danger sec-del"></button>`;
  box.querySelector("label").textContent = i18n("Название раздела");
  box.querySelector('[data-l="icon"]').textContent = i18n("Значок и цвет");
  const input = box.querySelector("input");
  input.value = section.name;
  const commit = () => {
    const name = input.value.trim();
    if (!name || name === section.name) return;
    section.name = name;
    persist();
    document.dispatchEvent(new CustomEvent("fictaris:sections-changed"));
    const heading = container.querySelector(".timeline-heading");
    if (heading) heading.textContent = name;
  };
  input.addEventListener("change", commit);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { commit(); closeMenu(); } });
  const icons = box.querySelector(".sec-new-icons");
  const colors = box.querySelector(".sec-new-colors");
  const paint = () => {
    icons.innerHTML = "";
    for (const name of SECTION_ICONS) {
      const b = document.createElement("button");
      b.className = "sec-new-icon" + (name === section.icon ? " on" : "");
      b.innerHTML = iconSvg(name, 15);
      b.addEventListener("click", () => { section.icon = name; changed(); });
      icons.appendChild(b);
    }
    colors.innerHTML = "";
    for (const c of SECTION_COLORS) {
      const b = document.createElement("button");
      b.className = "sec-new-color" + (c === section.color ? " on" : "");
      b.style.background = c;
      b.addEventListener("click", () => { section.color = c; changed(); });
      colors.appendChild(b);
    }
  };
  const changed = () => {
    persist();
    paint();
    drawBody();
    document.dispatchEvent(new CustomEvent("fictaris:sections-changed"));
  };
  paint();
  const del = box.querySelector(".sec-del");
  const count = entriesHere().length;
  const label = count
    ? i18nPlural(count, ["Удалить раздел и {n} запись", "Удалить раздел и {n} записи", "Удалить раздел и {n} записей"])
    : i18n("Удалить раздел");
  del.textContent = label;
  del.addEventListener("click", async () => {
    if (del.dataset.confirm !== "1") {
      del.dataset.confirm = "1";
      del.textContent = count ? i18n("Точно? Записи уйдут в корзину") : i18n("Точно?");
      setTimeout(() => { del.dataset.confirm = ""; del.textContent = label; }, 3000);
      return;
    }
    closeMenu();
    await deleteSection();
  });
  const r = anchor.getBoundingClientRect();
  openPopover(r.left, r.bottom + 6, box, "sec-menu-pop");
  input.focus();
}

async function deleteSection() {
  await window.__flushPendingSaves?.();
  const gone = entriesHere();
  for (const e of gone) {
    const trashId = await pushTrash("entry", { ...e, sectionName: section.name });
    await addTrashLinks(trashId, await detachEntry(e.id));
  }
  data = await loadEntries();
  data.entries = data.entries.filter((e) => e.sectionId !== section.id);
  data.sections = data.sections.filter((s) => s.id !== section.id);
  await apiPost("/api/entries", data);
  document.dispatchEvent(new CustomEvent("fictaris:sections-changed"));
  document.dispatchEvent(new CustomEvent("fictaris:open-module", { detail: { module: "characters" } }));
}

function openPage(id) {
  activeId = id;
  mode = "dossier";
  writePref(modeKey(), mode);
  draw();
}

function reorder(list) {
  const others = data.entries.filter((e) => e.sectionId !== section.id);
  data.entries = [...others, ...list];
  persist();
  drawBody();
}

function buildOverview() {
  const scroll = document.createElement("div");
  scroll.className = "cast-scroll";
  const all = entriesHere();
  if (!all.length) {
    scroll.appendChild(buildEmptyState(i18n("В разделе пока пусто – добавь первую запись."), section.icon || "folder"));
    return scroll;
  }
  const list = all.filter(matches);
  if (!list.length) {
    scroll.appendChild(buildEmptyState(i18n("Ничего не нашлось."), section.icon || "folder"));
    return scroll;
  }
  const grid = buildOverviewSection("", list, {
    render: buildCard,
    onOpen: openPage,
    dragState: { current: null },
    list: entriesHere,
    onReorder: reorder,
    gridClass: "fac-grid",
  });
  grid.querySelector(".cast-section-head").remove();
  scroll.appendChild(grid);
  return scroll;
}

function buildCard(e) {
  const text = blurb(e);
  const inText = chaptersWith(e).length;
  const card = document.createElement("button");
  card.className = "cast-card fac-card";
  card.style.setProperty("--faction-color", section.color || "#7d6a9e");
  card.innerHTML = `
    <div class="cast-card-head">
      ${tileHtml(e, "cast-avatar cast-avatar-lg", 26)}
      <div class="cast-card-title">
        <div class="cast-name fac-name">${escapeHtml(e.name || i18n("Без названия"))}${e.secret ? `<span class="secret-mark">${iconSvg("eyeOff", 12)}</span>` : ""}</div>
        <div class="cast-sub">${escapeHtml(subtitle(e))}</div>
      </div>
    </div>
    ${text ? `<p class="fac-blurb">${escapeHtml(text)}</p>` : ""}
    <div class="cast-card-foot">
      <div class="cast-tags">${parseTags(e.tags).map((t) => `<span class="cast-tag">${escapeHtml(t)}</span>`).join("")}</div>
      <div class="cast-stat">${escapeHtml(inText ? i18nPlural(inText, ["в {n} главе", "в {n} главах", "в {n} главах"]) : i18n("в тексте не встречается"))}</div>
    </div>`;
  return card;
}

function buildDossierView() {
  const all = entriesHere();
  const shown = all.filter(matches);
  if (!all.some((e) => e.id === activeId)) activeId = (shown[0] || all[0])?.id || null;
  const groups = [{
    title: "",
    items: shown.map((e) => ({ item: e, leadHtml: tileHtml(e, "cast-avatar cast-avatar-sm", 15), sub: subtitle(e) })),
  }];
  const list = buildDossierList(groups, activeId, {
    onPick: (id) => {
      activeId = id;
      drawBody();
    },
    dragState: { current: null },
    list: entriesHere,
    onReorder: reorder,
    emptyText: i18n(all.length ? "Ничего не нашлось." : "В разделе пока пусто."),
  });
  const active = all.find((e) => e.id === activeId);
  return buildDossierSplit(list, active ? buildPage(active) : buildEmptyState(i18n("В разделе пока пусто – добавь первую запись."), section.icon || "folder"));
}

function buildPage(e) {
  const page = document.createElement("div");
  page.className = "dossier";

  const head = document.createElement("div");
  head.className = "dossier-head";
  const tile = document.createElement("div");
  tile.className = "cast-avatar dossier-avatar";
  tile.style.background = section.color || "#7d6a9e";
  tile.innerHTML = avatarInnerHtml(e, iconSvg(section.icon || "folder", 44));

  const titleCol = document.createElement("div");
  titleCol.className = "dossier-title";
  const nameField = buildNameInput(e, () => {
    if (bodyEl) updateListRow(bodyEl, e.id, { name: e.name });
    persist();
  });
  const sub = document.createElement("div");
  sub.className = "dossier-subtitle";
  sub.textContent = section.name;
  titleCol.append(nameField, sub);

  const actions = document.createElement("div");
  actions.className = "dossier-actions";
  const delBtn = document.createElement("button");
  delBtn.className = "btn danger";
  delBtn.innerHTML = `${iconSvg("trash", 14)}<span>${escapeHtml(i18n("Удалить"))}</span>`;
  delBtn.addEventListener("click", async () => {
    await window.__flushPendingSaves?.();
    const trashId = await pushTrash("entry", { ...e, sectionName: section.name });
    data.entries = data.entries.filter((x) => x.id !== e.id);
    activeId = null;
    await apiPost("/api/entries", data);
    await addTrashLinks(trashId, await detachEntry(e.id));
    if (inModal) closeEntityModal();
    else draw();
  });
  actions.append(buildSecretToggle(e, () => { persist(); if (bodyEl && !inModal) drawBody(); }), delBtn);
  head.append(tile, titleCol, actions);
  page.appendChild(head);

  const cols = document.createElement("div");
  cols.className = "dossier-cols";
  const main = document.createElement("div");
  main.className = "dossier-main";
  const side = document.createElement("aside");
  side.className = "dossier-side";

  main.appendChild(sectionHeading(i18n("Анкета")));
  const fields = templateFor(templates, e.templateId)?.fields || [];
  if (fields.length) main.appendChild(buildTemplateFields(e, fields, [], () => persist()));
  else main.appendChild(buildNone(i18n("Полей пока нет – добавь их в «Поля анкеты»")));

  main.appendChild(sectionHeading(i18n("Облик и метки")));
  main.appendChild(buildAvatarsField(e, () => { persist(); draw(); }));
  main.appendChild(buildTagsField(tagsMap, e.tags, (value) => {
    e.tags = value;
    persist();
  }));

  side.appendChild(sectionHeading(i18n("В тексте")));
  const inText = chaptersWith(e);
  for (const ch of inText) {
    side.appendChild(buildLinkRow(iconLead(iconSvg("manuscript", 13)), ch.title || i18n("Без названия"), "", () => {
      document.dispatchEvent(new CustomEvent("fictaris:open-chapter", { detail: { id: ch.id } }));
    }));
  }
  if (!inText.length) side.appendChild(buildNone(i18n("Ссылок из глав пока нет – выделите слово в главе → «Сделать ссылкой…»")));

  cols.append(main, side);
  page.appendChild(cols);
  return page;
}
