import { apiGet, apiPost, uid } from "./api.js";
import { debounceSave } from "./save-badge.js";
import { escapeHtml, buildToggleGroup, buildEmptyState } from "./chips.js";
import { locationTypeInfo, iconSvg } from "./icons.js";
import { attachMentionAutocomplete, attachMentionContextMenu } from "./mentions.js";
import { pushTrash } from "./trash.js";
import { buildExportPngButton } from "./png-export.js";
import { loadCalendar, absoluteDay, formatDate, yearLength } from "./calendar.js";
import { openPopover } from "./context-menu.js";
import { openCalendarPanel } from "./world-panels.js";
import { avatarInnerHtml } from "./avatars.js";
import { i18n, i18nPlural } from "./i18n.js";

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
    title: i18n("Новое событие"),
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

// ── Два режима ───────────────────────────────────
// «Летопись» — вертикальная ось: события по порядку, сгруппированные по
// годам, между группами — сколько лет прошло. «Шкала» — время слева
// направо, у каждого персонажа своя дорожка, годы без событий сжаты в
// узкий разрыв. Выбор — предпочтение этого устройства, а не часть мира,
// поэтому localStorage, а не site-settings.json.
const MODE_KEY = "fictaris_timeline_mode";
const MODES = [
  ["chronicle", "Летопись", "Вертикальная ось с группами по годам"],
  ["lanes", "Шкала", "Время слева направо, дорожка у каждого персонажа"],
];

function readMode() {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return MODES.some(([key]) => key === v) ? v : "chronicle";
  } catch {
    return "chronicle";
  }
}

function writeMode(mode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // приватное окно и т.п. — режим просто не запомнится
  }
}

let mode = readMode();

// ── Время события ────────────────────────────────
// { year, frac } — frac ∈ [0, 1) доля года, или null, если в дате есть год,
// но нет ничего точнее. Свой календарь (Настройки → Календарь) даёт
// точный день; без него — год из текста даты плюс сезон, если он назван.
// Нет числа в дате вовсе — null: такие события идут в «Без даты».
const SEASONS = [
  [/зим|winter/i, 0.04],
  [/весн|spring/i, 0.29],
  [/лет(?:о|а|у|ом)(?![а-яё])|summer/i, 0.54],
  [/осен|autumn|fall/i, 0.79],
];

function eventTime(ev) {
  if (calendar && Number.isFinite(ev.dateYear)) {
    const start = absoluteDay(calendar, ev.dateYear, 0, 1);
    const day = absoluteDay(calendar, ev.dateYear, ev.dateMonth ?? 0, ev.dateDay ?? 1);
    return { year: ev.dateYear, frac: (day - start) / yearLength(calendar) };
  }
  const m = /-?\d+/.exec(ev.date || "");
  if (!m) return null;
  const season = SEASONS.find(([re]) => re.test(ev.date));
  return { year: Number(m[0]), frac: season ? season[1] : null };
}

function yearLabel(year) {
  const era = calendar?.eraLabel || i18n("год");
  return `${era.charAt(0).toUpperCase()}${era.slice(1)} ${year}`;
}

// Оба фильтра — персонажи и локации — сужают список одновременно
// (событие должно подходить под каждый выбранный фильтр по отдельности,
// а не под любой из них), иначе выбор локации без выбора персонажа не
// работал бы вовсе.
function visibleEvents() {
  return sorted().filter((e) => {
    if (filterCharIds.size && !e.characterIds?.some((id) => filterCharIds.has(id))) return false;
    if (filterLocIds.size && !e.locationIds?.some((id) => filterLocIds.has(id))) return false;
    return true;
  });
}

function draw() {
  container.innerHTML = "";
  const view = document.createElement("div");
  view.className = "timeline-view";

  const pane = document.createElement("div");
  pane.className = "timeline-pane";
  pane.appendChild(buildToolbar());
  const items = visibleEvents();
  if (!items.length) {
    // Иконка — только для честно пустого таймлайна, не для "отфильтровали
    // всё подчистую": та временная (снял фильтр — событий полно), а
    // иконка нужна ровно для "здесь пока правда нечего показывать".
    const empty = events.length
      ? buildEmptyState(i18n("Нет событий с таким фильтром."))
      : buildEmptyState(i18n("Событий пока нет – добавь первое."), "clock");
    empty.classList.add("timeline-empty");
    pane.appendChild(empty);
  } else {
    pane.appendChild(mode === "lanes" ? buildLanes(items) : buildChronicle(items));
  }
  view.appendChild(pane);

  const active = events.find((e) => e.id === activeId);
  if (active) view.appendChild(buildDrawer(active));

  // Дровер теперь модальное окно по центру экрана (style.css, .drawer) —
  // клик по затемнению вокруг него (не по самой панели) закрывает его,
  // как и у обычных модалок в приложении.
  view.addEventListener("click", (e) => {
    if (e.target === view) { activeId = null; draw(); }
  });

  container.appendChild(view);
}

function addEvent() {
  const ev = blank();
  events.push(ev);
  activeId = ev.id;
  persist();
  draw();
}

function buildToolbar() {
  const bar = document.createElement("div");
  bar.className = "timeline-toolbar";

  const title = document.createElement("div");
  title.className = "timeline-heading";
  title.textContent = i18n("Таймлайн");
  const meta = document.createElement("div");
  meta.className = "timeline-meta";
  const years = events.map(eventTime).filter(Boolean).map((t) => t.year);
  const count = i18nPlural(events.length, ["{n} событие", "{n} события", "{n} событий"]);
  meta.textContent = years.length
    ? `${count} · ${Math.min(...years)}–${Math.max(...years)}`
    : count;
  const spacer = document.createElement("div");
  spacer.style.flex = "1";

  const switcher = document.createElement("div");
  switcher.className = "segmented";
  for (const [key, label, hint] of MODES) {
    const btn = document.createElement("button");
    btn.className = "segmented-btn" + (mode === key ? " active" : "");
    btn.textContent = i18n(label);
    btn.title = i18n(hint);
    btn.addEventListener("click", () => {
      if (mode === key) return;
      mode = key;
      writeMode(key);
      draw();
    });
    switcher.appendChild(btn);
  }

  const filterBtn = document.createElement("button");
  const active = filterCharIds.size + filterLocIds.size;
  filterBtn.className = "btn" + (active ? " accent" : "");
  filterBtn.innerHTML = `${iconSvg("filter", 14)}<span>${escapeHtml(i18n("Фильтр"))}</span>${active ? `<span class="timeline-filter-badge">${active}</span>` : ""}`;
  filterBtn.addEventListener("click", () => {
    const r = filterBtn.getBoundingClientRect();
    openFilterPopover(r.left, r.bottom + 6);
  });

  const exportBtn = buildExportPngButton(() => container.querySelector(".timeline-export-target"), i18n("таймлайн"));

  // Свой календарь — данные мира, правится здесь же, боковой панелью.
  const calendarBtn = document.createElement("button");
  calendarBtn.className = "btn";
  calendarBtn.innerHTML = `${iconSvg("clock", 14)}<span>${escapeHtml(i18n("Календарь мира"))}</span>`;
  calendarBtn.title = i18n("Свои месяцы и длина года для таймлайна");
  calendarBtn.addEventListener("click", () => openCalendarPanel());

  const addBtn = document.createElement("button");
  addBtn.className = "btn accent";
  addBtn.textContent = i18n("+ Событие");
  addBtn.addEventListener("click", addEvent);

  bar.append(title, meta, spacer, switcher, filterBtn, calendarBtn, exportBtn, addBtn);
  return bar;
}

// Фильтр — во всплывающем окне по кнопке, а не стеной фишек над
// событиями: с ростом проекта стена росла бы и выталкивала сам таймлайн
// вниз. Окно перерисовывается на месте после каждого щелчка — выбор
// виден сразу, а таймлайн под ним уже отфильтрован.
function openFilterPopover(x, y) {
  const wrap = document.createElement("div");
  wrap.className = "timeline-filter-popover";

  function fill() {
    wrap.innerHTML = "";
    const section = (label, list, selected, colorOf, iconOf) => {
      if (!list.length) return;
      const title = document.createElement("div");
      title.className = "timeline-filter-label";
      title.textContent = label;
      const row = document.createElement("div");
      row.className = "timeline-filter-bar";
      for (const item of list) {
        const chip = document.createElement("button");
        chip.className = "filter-chip" + (selected.has(item.id) ? " active" : "");
        chip.style.setProperty("--chip-color", colorOf(item));
        const icon = iconOf?.(item);
        chip.innerHTML = `${icon ? iconSvg(icon, 11) : ""}<span>${escapeHtml(item.name || i18n("Без имени"))}</span>`;
        chip.addEventListener("click", () => {
          if (selected.has(item.id)) selected.delete(item.id);
          else selected.add(item.id);
          fill();
          draw();
        });
        row.appendChild(chip);
      }
      wrap.append(title, row);
    };
    section(i18n("Персонажи"), characters, filterCharIds, (c) => c.color || "#7c7157");
    section(i18n("Места"), locations, filterLocIds, (l) => locationTypeInfo(l.type)[3], (l) => locationTypeInfo(l.type)[2]);

    const footer = document.createElement("div");
    footer.className = "timeline-filter-footer";
    const shown = document.createElement("span");
    shown.className = "filter-count";
    shown.textContent = i18nPlural(events.length, ["{shown} из {total} события", "{shown} из {total} событий", "{shown} из {total} событий"], { shown: visibleEvents().length }, "total");
    const reset = document.createElement("button");
    reset.className = "btn";
    reset.textContent = i18n("Сбросить");
    reset.disabled = !filterCharIds.size && !filterLocIds.size;
    reset.addEventListener("click", () => {
      filterCharIds.clear();
      filterLocIds.clear();
      fill();
      draw();
    });
    footer.append(shown, reset);
    wrap.appendChild(footer);
  }

  fill();
  openPopover(x, y, wrap, "timeline-filter-menu");
}

function buildChips(ev) {
  return [
    ...(ev.characterIds || []).map((id) => charById(id)).filter(Boolean).map((c) =>
      `<span class="chip" style="background:${c.color || "#7c7157"}">${escapeHtml(c.name)}</span>`
    ),
    // Места — контурные, со значком типа: сплошной цветной фишкой они не
    // отличались от персонажей.
    ...(ev.locationIds || []).map((id) => locById(id)).filter(Boolean).map((l) => {
      const [, , icon, color] = locationTypeInfo(l.type);
      return `<span class="chip chip-place" style="--chip-color:${color}">${iconSvg(icon, 11)}${escapeHtml(l.name)}</span>`;
    }),
  ].join("");
}

// ── Летопись ─────────────────────────────────────
// Группы — подряд идущие события одного года в текущем порядке (order:
// ручная перестановка побеждает дату, см. reorder), а не сортировка по
// году поверх него — иначе перетаскивание не меняло бы ничего видимого.
function buildChronicle(items) {
  const groups = [];
  for (const ev of items) {
    const year = eventTime(ev)?.year ?? null;
    const last = groups[groups.length - 1];
    if (last && last.year === year) last.items.push(ev);
    else groups.push({ year, items: [ev] });
  }

  const outer = document.createElement("div");
  outer.className = "chronicle-outer";
  const spine = document.createElement("div");
  spine.className = "chronicle timeline-export-target";
  const toc = document.createElement("nav");
  toc.className = "chronicle-toc";
  const tocTitle = document.createElement("div");
  tocTitle.className = "timeline-filter-label";
  tocTitle.textContent = i18n("Периоды");
  toc.appendChild(tocTitle);

  let dragId = null;
  let side = 0;
  groups.forEach((g, gi) => {
    const prev = groups[gi - 1];
    if (prev && prev.year !== null && g.year !== null && g.year - prev.year > 1) {
      const gap = document.createElement("div");
      gap.className = "chronicle-gap";
      gap.innerHTML = `<span>${escapeHtml(i18nPlural(g.year - prev.year, ["прошёл {n} год", "прошло {n} года", "прошло {n} лет"]))}</span>`;
      spine.appendChild(gap);
    }

    const head = document.createElement("div");
    head.className = "chronicle-period";
    head.innerHTML = `<span>${escapeHtml(g.year === null ? i18n("Без даты") : yearLabel(g.year))}</span>`;
    spine.appendChild(head);

    const tocItem = document.createElement("button");
    tocItem.className = "chronicle-toc-item";
    tocItem.innerHTML = `<b>${escapeHtml(g.year === null ? i18n("Без даты") : yearLabel(g.year))}</b><small>${escapeHtml(i18nPlural(g.items.length, ["{n} событие", "{n} события", "{n} событий"]))}</small>`;
    tocItem.addEventListener("click", () => head.scrollIntoView({ behavior: "smooth", block: "start" }));
    toc.appendChild(tocItem);

    for (const ev of g.items) {
      const row = document.createElement("div");
      row.className = "chronicle-row " + (side++ % 2 === 0 ? "left" : "right");

      const card = document.createElement("div");
      card.className = "chronicle-card" + (ev.id === activeId ? " active" : "");
      card.draggable = true;
      card.innerHTML = `
        <div class="timeline-date">${escapeHtml(ev.date || "–")}</div>
        <div class="timeline-title">${escapeHtml(ev.title || i18n("Без названия"))}</div>
        ${ev.description ? `<div class="timeline-desc">${escapeHtml(ev.description)}</div>` : ""}
        <div class="timeline-chips">${buildChips(ev)}</div>
      `;
      card.addEventListener("click", () => { activeId = ev.id; draw(); });
      card.addEventListener("dragstart", () => { dragId = ev.id; });
      card.addEventListener("dragover", (e) => e.preventDefault());
      card.addEventListener("drop", (e) => {
        e.preventDefault();
        if (dragId === null || dragId === ev.id) return;
        reorder(dragId, ev.id, items);
      });

      const dot = document.createElement("span");
      dot.className = "chronicle-dot";
      row.append(card, dot);
      spine.appendChild(row);
    }
  });

  outer.append(spine, toc);
  return outer;
}

// ── Шкала ────────────────────────────────────────
// Ширина года — не меньше LANE_YEAR_MIN и растягивается на всю доступную
// ширину, если лет немного; годы без событий между соседними — один
// разрыв LANE_BREAK шириной, сколько бы их ни было. Карточки, которые
// не помещаются рядом по времени, уходят на следующий ряд той же дорожки.
const LANE_LABEL_W = 190;
const LANE_YEAR_MIN = 560;
const LANE_BREAK = 96;
const LANE_CARD_W = 170;
const LANE_CARD_H = 52;
const LANE_PAD = 10;

function buildLanes(items) {
  const timed = [];
  const undated = [];
  for (const ev of items) {
    const t = eventTime(ev);
    if (t) timed.push({ ev, t });
    else undated.push(ev);
  }

  // Событиям с годом, но без сезона/дня — места внутри года по порядку
  // (order), равномерно, а не все в одну точку на начале года.
  const byYear = new Map();
  for (const it of timed) {
    if (!byYear.has(it.t.year)) byYear.set(it.t.year, []);
    byYear.get(it.t.year).push(it);
  }
  for (const list of byYear.values()) {
    const loose = list.filter((it) => it.t.frac === null);
    loose.forEach((it, i) => { it.frac = (i + 0.5) / loose.length; });
    for (const it of list) if (it.t.frac !== null) it.frac = it.t.frac;
  }
  const years = [...byYear.keys()].sort((a, b) => a - b);

  const avail = Math.max(0, container.clientWidth - LANE_LABEL_W - 2);
  const segCount = years.length + (undated.length ? 1 : 0);
  const breaks = years.filter((y, i) => i && y - years[i - 1] > 1).length;
  const yearW = Math.max(LANE_YEAR_MIN, segCount ? (avail - breaks * LANE_BREAK) / segCount : LANE_YEAR_MIN);

  const segments = [];
  let x = 0;
  years.forEach((y, i) => {
    if (i && y - years[i - 1] > 1) {
      segments.push({ gap: y - years[i - 1] - 1, x, w: LANE_BREAK });
      x += LANE_BREAK;
    }
    segments.push({ year: y, x, w: yearW });
    x += yearW;
  });
  if (undated.length) {
    segments.push({ undated: true, x, w: Math.max(yearW, undated.length * (LANE_CARD_W + 8) + LANE_PAD * 2) });
    x = segments[segments.length - 1].x + segments[segments.length - 1].w;
  }
  const trackW = x;

  const xOf = (it) => {
    const seg = segments.find((s) => s.year === it.t.year);
    return seg.x + LANE_PAD + it.frac * (seg.w - LANE_CARD_W - LANE_PAD * 2);
  };
  const placed = [
    ...timed.map((it) => ({ ev: it.ev, x: xOf(it) })),
    ...undated.map((ev, i) => ({ ev, x: segments[segments.length - 1].x + LANE_PAD + i * (LANE_CARD_W + 8) })),
  ];

  const lanes = [];
  for (const c of characters) {
    const mine = placed.filter((p) => (p.ev.characterIds || []).includes(c.id));
    if (mine.length) lanes.push({ label: "character", c, items: mine, color: () => c.color || "#7c7157" });
  }
  const nobody = placed.filter((p) => !(p.ev.characterIds || []).some((id) => charById(id)));
  if (nobody.length) lanes.push({ label: "nobody", items: nobody, color: () => "var(--text-faint)" });
  const withPlace = placed.filter((p) => (p.ev.locationIds || []).some((id) => locById(id)));
  if (withPlace.length) {
    lanes.push({
      label: "places",
      items: withPlace,
      color: (ev) => locationTypeInfo(locById((ev.locationIds || []).find((id) => locById(id)))?.type)[3],
      text: (ev) => (ev.locationIds || []).map((id) => locById(id)?.name).filter(Boolean).join(", "),
    });
  }

  const outer = document.createElement("div");
  outer.className = "lanes-outer";
  const grid = document.createElement("div");
  grid.className = "lanes timeline-export-target";
  grid.style.width = `${LANE_LABEL_W + trackW}px`;

  const head = document.createElement("div");
  head.className = "lanes-row lanes-head";
  head.innerHTML = `<div class="lanes-label">${escapeHtml(i18n("Дорожки"))}</div>`;
  const headTrack = document.createElement("div");
  headTrack.className = "lanes-track";
  headTrack.style.width = `${trackW}px`;
  for (const s of segments) {
    const cell = document.createElement("div");
    cell.className = "lanes-seg" + (s.gap !== undefined ? " lanes-break" : "");
    cell.style.left = `${s.x}px`;
    cell.style.width = `${s.w}px`;
    cell.textContent = s.gap !== undefined
      ? i18nPlural(s.gap, ["… {n} год …", "… {n} года …", "… {n} лет …"])
      : s.undated ? i18n("Без даты") : yearLabel(s.year);
    headTrack.appendChild(cell);
  }
  head.appendChild(headTrack);
  grid.appendChild(head);

  for (const lane of lanes) {
    // Жадная раскладка по рядам: карточка встаёт в первый ряд, где она не
    // налезает на предыдущую, — иначе события одного сезона закрывали бы
    // друг друга.
    const rowEnds = [];
    const sortedItems = [...lane.items].sort((a, b) => a.x - b.x);
    const pos = sortedItems.map((p) => {
      let r = rowEnds.findIndex((end) => p.x >= end + 6);
      if (r === -1) { r = rowEnds.length; rowEnds.push(0); }
      rowEnds[r] = p.x + LANE_CARD_W;
      return { ...p, row: r };
    });
    const rows = Math.max(1, rowEnds.length);

    const rowEl = document.createElement("div");
    rowEl.className = "lanes-row";
    const label = document.createElement("div");
    label.className = "lanes-label";
    if (lane.label === "character") {
      label.innerHTML = `<span class="lanes-avatar" style="background:${lane.c.color || "#7c7157"}">${avatarInnerHtml(lane.c, escapeHtml((lane.c.name || "?").trim().slice(0, 1).toUpperCase()))}</span><span>${escapeHtml(lane.c.name)}</span>`;
    } else {
      label.innerHTML = `<span class="lanes-label-icon">${iconSvg(lane.label === "places" ? "pin" : "user", 15)}</span><span class="lanes-label-muted">${escapeHtml(lane.label === "places" ? i18n("Места") : i18n("Без участников"))}</span>`;
    }

    const track = document.createElement("div");
    track.className = "lanes-track";
    track.style.width = `${trackW}px`;
    track.style.height = `${rows * (LANE_CARD_H + 8) + LANE_PAD * 2 - 8}px`;
    for (const s of segments) {
      const cell = document.createElement("div");
      cell.className = "lanes-seg" + (s.gap !== undefined ? " lanes-break" : "");
      cell.style.left = `${s.x}px`;
      cell.style.width = `${s.w}px`;
      track.appendChild(cell);
    }
    for (const p of pos) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "lanes-card" + (p.ev.id === activeId ? " active" : "");
      card.style.left = `${p.x}px`;
      card.style.top = `${LANE_PAD + p.row * (LANE_CARD_H + 8)}px`;
      card.style.width = `${LANE_CARD_W}px`;
      card.style.borderLeftColor = lane.color(p.ev);
      const text = lane.text ? lane.text(p.ev) : p.ev.title || i18n("Без названия");
      card.title = `${p.ev.date ? `${p.ev.date} – ` : ""}${p.ev.title || i18n("Без названия")}`;
      card.innerHTML = `<span class="lanes-card-date">${escapeHtml(p.ev.date || "–")}</span><span class="lanes-card-title">${escapeHtml(text)}</span>`;
      card.addEventListener("click", () => { activeId = p.ev.id; draw(); });
      track.appendChild(card);
    }
    rowEl.append(label, track);
    grid.appendChild(rowEl);
  }

  outer.appendChild(grid);
  return outer;
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
  dateLabel.textContent = i18n("Дата");
  dateField.appendChild(dateLabel);
  const dateInput = document.createElement("input");
  dateInput.value = ev.date || "";
  dateInput.placeholder = i18n("например: год 214, день третий");
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
  dateLabel.textContent = i18n("Дата");
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
  titleInput.className = "drawer-name-field";
  titleInput.addEventListener("input", () => { ev.title = titleInput.value; persist(); });
  drawer.appendChild(titleInput);

  drawer.appendChild(calendar ? buildCalendarDateField(ev) : buildFreeTextDateField(ev));

  const descField = document.createElement("div");
  descField.className = "field";
  const descLabel = document.createElement("label");
  descLabel.textContent = i18n("Описание");
  descField.appendChild(descLabel);
  const descArea = document.createElement("textarea");
  descArea.value = ev.description || "";
  descArea.addEventListener("input", () => { ev.description = descArea.value; persist(); });
  descField.appendChild(descArea);
  attachMentionAutocomplete(descArea, () => characters);
  attachMentionContextMenu(descArea, () => characters);
  drawer.appendChild(descField);

  drawer.appendChild(buildToggleGroup(i18n("Персонажи"), characters, ev.characterIds || [], (ids) => {
    ev.characterIds = ids;
    persist();
    draw();
  }));

  drawer.appendChild(buildToggleGroup(
    i18n("Локации"),
    locations,
    ev.locationIds || [],
    (ids) => { ev.locationIds = ids; persist(); draw(); },
    (l) => locationTypeInfo(l.type)[3]
  ));

  const actions = document.createElement("div");
  actions.className = "drawer-actions";
  const closeBtn = document.createElement("button");
  closeBtn.className = "btn";
  closeBtn.textContent = i18n("Закрыть");
  closeBtn.addEventListener("click", () => { activeId = null; draw(); });
  const delBtn = document.createElement("button");
  delBtn.className = "btn danger";
  delBtn.textContent = i18n("Удалить");
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
