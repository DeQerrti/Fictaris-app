import { escapeHtml, reorderById, attachCardDrag } from "./chips.js";
import { buildFieldHint } from "./templates.js";
import { avatarInnerHtml } from "./avatars.js";
import { i18n } from "./i18n.js";

// ══════════════════════════════════════════════
//  ОБЗОР И ДОСЬЕ
//
//  Общие детали вкладок «Персонажи», «Локации», «Фракции» — у каждой два
//  режима: обзор карточками и досье (список слева, страница справа).
//  Сами карточки и страницы у вкладок свои, здесь — то, что в них
//  одинаково: шапка, переключатели, сводка, поля анкеты, список.
// ══════════════════════════════════════════════

// Титулы не дают букву аватарке: у «Лорда Эдвина» и «Леди Миры» не
// должно быть одинаковое «Л».
const HONORIFICS = /^(лорд|леди|сир|сэр|король|королева|князь|княгиня|принц|принцесса|мастер|старый|старая|lord|lady|sir|king|queen|prince|princess|master|old)\s+/i;

export function shortName(name) {
  const rest = (name || "").trim().replace(HONORIFICS, "");
  return rest.split(/\s+/)[0] || (name || "").trim();
}

export function initials(name) {
  return (shortName(name) || "?").slice(0, 1).toUpperCase();
}

// Аватарка персонажа: картинка или буква на его цвете; cls — размер
// (cast-avatar, cast-avatar-lg/-sm/-xs).
export function personAvatarHtml(c, cls = "cast-avatar cast-avatar-xs") {
  return `<div class="${cls}" style="background:${c.color}" title="${escapeHtml(c.name || "")}">${avatarInnerHtml(c, escapeHtml(initials(c.name)))}</div>`;
}

// Режим и группировка — предпочтение этого устройства, не мира.
export function readPref(key, allowed, fallback) {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // приватное окно и т.п. — выбор просто не запомнится
  }
}

export function buildSegmented(options, value, onPick) {
  const seg = document.createElement("div");
  seg.className = "segmented";
  for (const [key, label, title] of options) {
    const btn = document.createElement("button");
    btn.className = "segmented-btn" + (key === value ? " active" : "");
    btn.textContent = i18n(label);
    if (title) btn.title = i18n(title);
    btn.addEventListener("click", () => onPick(key));
    seg.appendChild(btn);
  }
  return seg;
}

// Шапка вкладки: заголовок, счётчик, режимы, свои переключатели (extra),
// поиск и «+ Добавить». metaEl заполняет сама вкладка — счётчик зависит
// от поиска и перерисовывается вместе с телом, а не со всей шапкой.
export function buildEntityToolbar({ title, modes, mode, onMode, extra, placeholder, query, onSearch, addLabel, onAdd, onAddMenu }) {
  const bar = document.createElement("div");
  bar.className = "timeline-toolbar";

  const heading = document.createElement("div");
  heading.className = "timeline-heading";
  heading.textContent = title;

  const metaEl = document.createElement("div");
  metaEl.className = "timeline-meta";

  bar.append(heading, metaEl, buildSegmented(modes, mode, onMode));
  if (extra) bar.appendChild(extra);

  const spacer = document.createElement("div");
  spacer.style.flex = "1";

  const search = document.createElement("input");
  search.type = "search";
  search.className = "characters-search";
  search.placeholder = placeholder;
  search.value = query;
  search.addEventListener("input", () => onSearch(search.value));

  const addBtn = document.createElement("button");
  addBtn.className = "btn characters-add-btn";
  addBtn.textContent = addLabel;
  addBtn.title = i18n("Правая кнопка – выбрать шаблон анкеты или завести новый");
  addBtn.addEventListener("click", () => onAdd(addBtn));
  // Правая кнопка форсирует меню выбора шаблона, даже если он пока один —
  // иначе "+ Новый шаблон…" был бы недостижим, пока не заведён хотя бы
  // второй шаблон (см. комментарий в template-choice.js).
  addBtn.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    onAddMenu(addBtn);
  });

  bar.append(spacer, search, addBtn);
  return { bar, metaEl };
}

// Группа карточек обзора: заголовок со счётчиком и сетка; перетаскивание
// карточки меняет порядок в самом массиве данных (list), как и раньше в
// сетке.
export function buildOverviewSection(title, members, { render, onOpen, dragState, list, onReorder, gridClass = "cast-grid" }) {
  const sec = document.createElement("section");
  sec.className = "cast-section";
  sec.innerHTML = `<div class="cast-section-head"><h3>${escapeHtml(title)}</h3><span>${members.length}</span></div>`;
  const grid = document.createElement("div");
  grid.className = gridClass;
  for (const item of members) {
    const card = render(item);
    card.addEventListener("click", () => onOpen(item.id));
    attachCardDrag(card, item.id, dragState, (draggedId, targetId) => onReorder(reorderById(list(), draggedId, targetId)));
    grid.appendChild(card);
  }
  sec.appendChild(grid);
  return sec;
}

// Список досье слева: groups — [{ title, items: [{ item, leadHtml, sub, dead }] }].
export function buildDossierList(groups, activeId, { onPick, dragState, list, onReorder, emptyText }) {
  const el = document.createElement("div");
  el.className = "dossier-list";
  for (const g of groups) {
    if (!g.items.length) continue;
    if (g.title) {
      const head = document.createElement("div");
      head.className = "dossier-list-group";
      head.innerHTML = `${escapeHtml(g.title)}<span>${g.items.length}</span>`;
      el.appendChild(head);
    }
    for (const { item, leadHtml, sub, dead, nameSuffix = "" } of g.items) {
      const row = document.createElement("button");
      row.className = "dossier-row" + (item.id === activeId ? " active" : "") + (dead ? " dead" : "");
      row.dataset.id = item.id;
      row.innerHTML = `
        ${leadHtml}
        <div class="dossier-row-text">
          <div class="dossier-row-name">${escapeHtml(item.name || i18n("Без имени"))}${nameSuffix}</div>
          <div class="dossier-row-role">${escapeHtml(sub || "")}</div>
        </div>
      `;
      row.addEventListener("click", () => onPick(item.id));
      attachCardDrag(row, item.id, dragState, (draggedId, targetId) => onReorder(reorderById(list(), draggedId, targetId)));
      el.appendChild(row);
    }
  }
  if (!el.children.length) el.appendChild(buildNone(emptyText));
  return el;
}

// Имя и подзаголовок списка досье меняются при наборе сразу, без
// перерисовки всей вкладки.
export function updateListRow(root, id, { name, sub }) {
  const row = root?.querySelector(`.dossier-row[data-id="${CSS.escape(id)}"]`);
  if (!row) return;
  if (name !== undefined) row.querySelector(".dossier-row-name").firstChild.textContent = name || i18n("Без имени");
  if (sub !== undefined) row.querySelector(".dossier-row-role").textContent = sub;
}

// Многострочное поле досье растёт по тексту, а не прокручивается внутри.
export function autoGrow(textarea) {
  const fit = () => {
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight + 2}px`;
  };
  textarea.addEventListener("input", fit);
  requestAnimationFrame(fit);
}

export function sectionHeading(text) {
  const h = document.createElement("h4");
  h.className = "dossier-heading";
  h.textContent = text;
  return h;
}

export function buildNone(text) {
  const none = document.createElement("div");
  none.className = "dossier-none";
  none.textContent = text;
  return none;
}

export function buildFact(label, control) {
  const cell = document.createElement("label");
  cell.className = "dossier-fact";
  const span = document.createElement("span");
  span.textContent = label;
  cell.append(span, control);
  return cell;
}

export function buildFactText(label, text) {
  const value = document.createElement("div");
  value.className = "dossier-fact-value";
  value.textContent = text || "–";
  return buildFact(label, value);
}

// Выпадающий список: options — [[value, label]], подписи переводятся.
export function buildSelect(options, value, onChange, className = "kin-kind-select") {
  const select = document.createElement("select");
  select.className = className;
  for (const [key, label] of options) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = i18n(label);
    opt.selected = key === value;
    select.appendChild(opt);
  }
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

// Крупное имя в шапке досье; onInput — после каждой правки.
export function buildNameInput(entity, onInput) {
  const input = document.createElement("input");
  input.className = "dossier-name";
  input.value = entity.name || "";
  input.placeholder = i18n("Без имени");
  input.addEventListener("input", () => {
    entity.name = input.value;
    onInput();
  });
  return input;
}

// Поля шаблона анкеты сеткой; skip — ключи, что уже стоят в шапке/сводке.
export function buildTemplateFields(entity, fields, skip, onChange) {
  const grid = document.createElement("div");
  grid.className = "dossier-fields";
  for (const f of fields) {
    if (skip.includes(f.key)) continue;
    const field = document.createElement("label");
    field.className = "dossier-field";
    const lab = document.createElement("span");
    lab.className = "dossier-field-label";
    lab.textContent = f.label;
    field.appendChild(lab);
    const hint = buildFieldHint(f.type);
    if (hint) field.appendChild(hint);
    const input = document.createElement(f.type === "input" ? "input" : "textarea");
    input.value = entity[f.key] || "";
    input.placeholder = i18n("Не заполнено");
    if (f.type !== "input") {
      input.rows = 1;
      autoGrow(input);
    }
    input.addEventListener("input", () => {
      entity[f.key] = input.value;
      onChange(f.key);
    });
    field.appendChild(input);
    grid.appendChild(field);
  }
  return grid;
}

// Строка-ссылка в боковой колонке досье: lead — аватарка или иконка (HTML).
export function buildLinkRow(leadHtml, text, note, onClick) {
  const el = document.createElement(onClick ? "button" : "div");
  el.className = "dossier-link-row";
  el.innerHTML = `${leadHtml}<span class="dossier-link-text">${escapeHtml(text)}</span>${note ? `<small>${escapeHtml(note)}</small>` : ""}`;
  if (onClick) el.addEventListener("click", onClick);
  return el;
}

export function iconLead(svg) {
  return `<span class="dossier-row-icon">${svg}</span>`;
}

// Событие таймлайна строкой: дата слева, название, описание и участники.
export function buildEventRow(event, peopleHtml) {
  const el = document.createElement("div");
  el.className = "dossier-event";
  el.innerHTML = `
    <div class="dossier-event-date">${escapeHtml(event.date || "")}</div>
    <div class="dossier-event-body">
      <b>${escapeHtml(event.title || i18n("Без названия"))}</b>
      ${event.description ? `<p>${escapeHtml(event.description)}</p>` : ""}
      ${peopleHtml ? `<div class="dossier-avatars">${peopleHtml}</div>` : ""}
    </div>
  `;
  return el;
}

// Сплит досье: список слева, страница справа (detail — уже собранная).
export function buildDossierSplit(listEl, detailEl) {
  const split = document.createElement("div");
  split.className = "dossier-split";
  const detail = document.createElement("div");
  detail.className = "dossier-detail";
  detail.appendChild(detailEl);
  split.append(listEl, detail);
  return split;
}

export function openEntity(type, id) {
  if (type === "character") document.dispatchEvent(new CustomEvent("fictaris:open-character", { detail: { id } }));
  else if (type === "chapter") document.dispatchEvent(new CustomEvent("fictaris:open-chapter", { detail: { id } }));
  else document.dispatchEvent(new CustomEvent("fictaris:open-entity", { detail: { type, id } }));
}
