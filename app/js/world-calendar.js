import { apiGet, uid } from "./api.js";
import { iconSvg } from "./icons.js";
import { openPopover, closeMenu } from "./context-menu.js";
import { loadTemplates, templateFor } from "./templates.js";
import { absoluteDay, formatDate, weekdaysOf, weekdayOf, monthForFraction, parseWorldDate, saveCalendar } from "./calendar.js";
import { i18n, i18nPlural } from "./i18n.js";

// ══════════════════════════════════════════════
//  КАЛЕНДАРЬ МИРА — режим «Календарь» в Таймлайне
//
//  Год — сеткой месяцев, месяц — крупно, с подписями в клетках. На
//  клетках: события таймлайна (с точной датой — в свой день; с годом и
//  сезоном — «в течение месяца»), праздники и памятные даты из
//  настройки календаря (каждый год), дни рождения — из полей анкеты
//  вида «Дата мира» с «рожд» в названии (каждый год, с возрастом),
//  другие такие поля — один раз, в свою дату. «Сегодня в мире» —
//  calendar.today. Справа — что в выбранном месяце.
//
//  Сам календарь (месяцы, неделя, праздники) правится в боковой панели
//  (calendar-editor.js); сюда timeline.js отдаёт уже отфильтрованные
//  события и что делать по щелчку.
// ══════════════════════════════════════════════

const VIEW_KEY = "fictaris_calendar_view";
const SEASON_OF_FRAC = [[0.2, "winter"], [0.45, "spring"], [0.7, "summer"], [0.95, "autumn"], [1.01, "winter"]];

let view = readView();
let shownYear = null;
let shownMonth = 0;
let dateMarks = null; // дни рождения и даты из анкет — читаются один раз на показ

function readView() {
  try {
    return localStorage.getItem(VIEW_KEY) === "month" ? "month" : "year";
  } catch {
    return "year";
  }
}

function writeView(v) {
  view = v;
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {
    // приватное окно — вид просто не запомнится
  }
}

// ── Что лежит на днях ──────────────────────────
// { exact: Map("y|m|d" → [item]), month: Map("y|m" → [item]) }
function eventMarks(calendar, events, eventTime) {
  const exact = new Map();
  const month = new Map();
  const push = (map, key, item) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  };
  for (const ev of events) {
    const item = { kind: "event", id: ev.id, title: ev.title || i18n("Без названия") };
    if (Number.isFinite(ev.dateYear)) {
      push(exact, `${ev.dateYear}|${ev.dateMonth ?? 0}|${ev.dateDay ?? 1}`, item);
      continue;
    }
    const t = eventTime(ev);
    if (!t) continue;
    if (t.frac == null) {
      push(month, `${t.year}|year`, item);
      continue;
    }
    const season = SEASON_OF_FRAC.find(([f]) => t.frac < f)?.[1];
    push(month, `${t.year}|${monthForFraction(calendar, t.frac, season)}`, item);
  }
  return { exact, month };
}

async function loadDateMarks() {
  const kinds = [["characters", "/api/characters"], ["locations", "/api/locations"], ["factions", "/api/factions"]];
  const out = [];
  for (const [kind, path] of kinds) {
    const [list, templates] = await Promise.all([apiGet(path).catch(() => []), loadTemplates(kind)]);
    for (const e of Array.isArray(list) ? list : []) {
      const fields = templateFor(templates, e.templateId)?.fields || [];
      for (const f of fields) {
        if (f.type !== "date") continue;
        const d = parseWorldDate(e[f.key]);
        if (!d) continue;
        out.push({ ...d, name: e.name || "?", label: f.label, birthday: /рожд|birth/i.test(f.label), entity: { kind, id: e.id } });
      }
    }
  }
  return out;
}

function dayItems(calendar, marks, year, m, d) {
  const items = [...(marks.exact.get(`${year}|${m}|${d}`) || [])];
  for (const h of calendar.holidays || []) {
    if (h.month === m && h.day === d) items.unshift({ kind: "holiday", id: h.id, title: h.name, color: h.color, sub: h.kind });
  }
  for (const b of dateMarks || []) {
    if (b.month !== m || b.day !== d) continue;
    if (b.birthday && year >= b.year) {
      const age = year - b.year;
      items.push({ kind: "birthday", title: b.name, sub: age ? i18nPlural(age, ["{n} год", "{n} года", "{n} лет"]) : i18n("рождение"), entity: b.entity });
    } else if (!b.birthday && year === b.year) {
      items.push({ kind: "date", title: `${b.label}: ${b.name}`, entity: b.entity });
    }
  }
  return items;
}

function isToday(calendar, y, m, d) {
  const t = calendar.today;
  return t && t.year === y && t.month === m && t.day === d;
}

// ── Отрисовка ──────────────────────────────────
// opts: { calendar, events, eventTime, onOpenEvent(id), onAddEvent({year,month,day}), onEditCalendar(), onChanged() }
export function buildWorldCalendar(opts) {
  const root = document.createElement("div");
  root.className = "wcal";
  const { calendar } = opts;
  if (shownYear == null) shownYear = startYear(opts);
  const draw = () => {
    root.innerHTML = "";
    const marks = eventMarks(calendar, opts.events, opts.eventTime);
    const main = document.createElement("div");
    main.className = "wcal-main";
    main.appendChild(buildHeader(opts, draw));
    main.appendChild(view === "month" ? buildMonth(opts, marks, draw) : buildYear(opts, marks, draw));
    root.append(main, buildSide(opts, marks, draw));
  };
  draw();
  if (!dateMarks) {
    loadDateMarks().then((list) => {
      dateMarks = list;
      if (root.isConnected) draw();
    });
  }
  return root;
}

// Сбросить прочитанные даты из анкет (таймлайн перерисовался заново).
export function resetWorldCalendarCache() {
  dateMarks = null;
}

function startYear({ calendar, events, eventTime }) {
  if (calendar.today) return calendar.today.year;
  const years = events.map(eventTime).filter(Boolean).map((t) => t.year);
  return years.length ? Math.min(...years) : 1;
}

function buildHeader(opts, draw) {
  const { calendar } = opts;
  const bar = document.createElement("div");
  bar.className = "wcal-head";
  const prev = document.createElement("button");
  prev.className = "btn wcal-nav";
  prev.innerHTML = iconSvg("chevronLeft", 15);
  prev.title = view === "month" ? i18n("Прошлый месяц") : i18n("Прошлый год");
  const next = document.createElement("button");
  next.className = "btn wcal-nav";
  next.innerHTML = iconSvg("chevronRight", 15);
  next.title = view === "month" ? i18n("Следующий месяц") : i18n("Следующий год");
  const step = (dir) => {
    if (view === "year") shownYear += dir;
    else {
      shownMonth += dir;
      if (shownMonth < 0) { shownMonth = calendar.months.length - 1; shownYear -= 1; }
      if (shownMonth >= calendar.months.length) { shownMonth = 0; shownYear += 1; }
    }
    draw();
  };
  prev.addEventListener("click", () => step(-1));
  next.addEventListener("click", () => step(1));

  const title = document.createElement("button");
  title.className = "wcal-title";
  const era = calendar.eraLabel || i18n("год");
  title.textContent = view === "month" ? `${calendar.months[shownMonth]?.name || ""} · ${shownYear} ${era}` : `${shownYear} ${era}`;
  title.title = i18n("Перейти к году");
  title.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "number";
    input.className = "wcal-year-input";
    input.value = shownYear;
    title.replaceWith(input);
    input.focus();
    input.select();
    const go = () => {
      const y = Number(input.value);
      if (Number.isFinite(y)) shownYear = y;
      draw();
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); if (e.key === "Escape") draw(); });
    input.addEventListener("blur", go);
  });

  const today = document.createElement("button");
  today.className = "btn";
  today.textContent = i18n("Сегодня в мире");
  today.disabled = !calendar.today;
  today.title = calendar.today ? formatDate(calendar, calendar.today) : i18n("«Сегодня» пока не выбрано – щёлкни по дню в календаре");
  today.addEventListener("click", () => {
    shownYear = calendar.today.year;
    shownMonth = calendar.today.month;
    draw();
  });

  const spacer = document.createElement("span");
  spacer.style.flex = "1";

  const seg = document.createElement("div");
  seg.className = "segmented";
  for (const [key, label] of [["year", "Год"], ["month", "Месяц"]]) {
    const b = document.createElement("button");
    b.className = "segmented-btn" + (view === key ? " active" : "");
    b.textContent = i18n(label);
    b.addEventListener("click", () => {
      writeView(key);
      draw();
    });
    seg.appendChild(b);
  }
  bar.append(prev, title, next, today, spacer, seg);
  return bar;
}

function weekHeader(calendar) {
  return weekdaysOf(calendar).map((w) => `<div class="wcal-wd">${escapeText(w)}</div>`).join("");
}

function escapeText(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function buildYear(opts, marks, draw) {
  const { calendar } = opts;
  const grid = document.createElement("div");
  grid.className = "wcal-year";
  const cols = weekdaysOf(calendar).length;
  calendar.months.forEach((month, mi) => {
    const card = document.createElement("button");
    card.className = "wcal-month" + (calendar.today?.year === shownYear && calendar.today?.month === mi ? " current" : "");
    const inMonth = (marks.month.get(`${shownYear}|${mi}`) || []).length;
    card.innerHTML = `<div class="wcal-month-head"><span class="wcal-month-name"></span><span class="wcal-month-sub"></span></div>`;
    card.querySelector(".wcal-month-name").textContent = month.name;
    card.querySelector(".wcal-month-sub").textContent = inMonth ? i18n("+{n} без дня", { n: inMonth }) : i18nPlural(month.days, ["{n} день", "{n} дня", "{n} дней"]);
    const days = document.createElement("div");
    days.className = "wcal-mini";
    days.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    let html = weekHeader(calendar);
    const offset = weekdayOf(calendar, shownYear, mi, 1);
    for (let i = 0; i < offset; i++) html += `<span></span>`;
    for (let d = 1; d <= month.days; d++) {
      const items = dayItems(calendar, marks, shownYear, mi, d);
      const cls = ["wcal-d"];
      if (items.some((x) => x.kind === "holiday")) cls.push("hol");
      if (items.some((x) => x.kind === "event" || x.kind === "date")) cls.push("ev");
      if (items.some((x) => x.kind === "birthday")) cls.push("bd");
      if (isToday(calendar, shownYear, mi, d)) cls.push("today");
      html += `<span class="${cls.join(" ")}" title="${escapeText(items.map((x) => x.title).join(" · "))}">${d}</span>`;
    }
    days.innerHTML = html;
    card.appendChild(days);
    card.addEventListener("click", () => {
      shownMonth = mi;
      writeView("month");
      draw();
    });
    grid.appendChild(card);
  });
  return grid;
}

function buildMonth(opts, marks, draw) {
  const { calendar } = opts;
  const wrap = document.createElement("div");
  wrap.className = "wcal-bigmonth";
  const month = calendar.months[shownMonth];
  if (!month) return wrap;

  const loose = marks.month.get(`${shownYear}|${shownMonth}`) || [];
  if (loose.length) {
    const row = document.createElement("div");
    row.className = "wcal-loose";
    row.innerHTML = `<span class="wcal-loose-k"></span>`;
    row.firstChild.textContent = i18n("В течение месяца:");
    for (const it of loose) row.appendChild(buildTag(it, opts));
    wrap.appendChild(row);
  }

  const cols = weekdaysOf(calendar).length;
  const grid = document.createElement("div");
  grid.className = "wcal-grid";
  grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  grid.innerHTML = weekHeader(calendar);
  const offset = weekdayOf(calendar, shownYear, shownMonth, 1);
  for (let i = 0; i < offset; i++) grid.appendChild(document.createElement("span"));
  for (let d = 1; d <= month.days; d++) {
    const items = dayItems(calendar, marks, shownYear, shownMonth, d);
    const cell = document.createElement("div");
    cell.className = "wcal-cell" + (items.some((x) => x.kind === "holiday") ? " hol" : "") + (isToday(calendar, shownYear, shownMonth, d) ? " today" : "");
    const num = document.createElement("button");
    num.className = "wcal-num";
    num.textContent = String(d);
    num.title = i18n("Что сделать с этим днём");
    num.addEventListener("click", (e) => {
      e.stopPropagation();
      openDayMenu(opts, d, num, draw);
    });
    cell.appendChild(num);
    for (const it of items) cell.appendChild(buildTag(it, opts));
    grid.appendChild(cell);
  }
  wrap.appendChild(grid);
  return wrap;
}

function buildTag(it, opts) {
  const tag = document.createElement("button");
  tag.className = `wcal-tag ${it.kind}`;
  if (it.kind === "holiday" && it.color) tag.style.setProperty("--hol", it.color);
  tag.textContent = it.kind === "birthday" ? `${i18n("ДР")} · ${it.title}` : it.title;
  if (it.sub) tag.title = it.kind === "birthday" ? it.sub : i18n(holidayKindLabel(it.sub));
  tag.addEventListener("click", (e) => {
    e.stopPropagation();
    if (it.kind === "event") opts.onOpenEvent(it.id);
    else if (it.kind === "holiday") opts.onEditCalendar("holidays");
    else if (it.entity) {
      const type = { characters: "character", locations: "location", factions: "faction" }[it.entity.kind];
      document.dispatchEvent(new CustomEvent("fictaris:open-entity", { detail: { type, id: it.entity.id } }));
    }
  });
  return tag;
}

export const HOLIDAY_KINDS = [
  ["holiday", "праздник"],
  ["memorial", "памятная дата"],
  ["mourning", "траур"],
];

function holidayKindLabel(kind) {
  return (HOLIDAY_KINDS.find(([k]) => k === kind) || HOLIDAY_KINDS[0])[1];
}

function openDayMenu(opts, day, anchor, draw) {
  const { calendar } = opts;
  const date = { year: shownYear, month: shownMonth, day };
  const box = document.createElement("div");
  box.className = "wcal-daymenu";
  const title = document.createElement("div");
  title.className = "wcal-daymenu-title";
  title.textContent = formatDate(calendar, date);
  box.appendChild(title);
  const item = (icon, text, fn) => {
    const b = document.createElement("button");
    b.className = "context-menu-item";
    b.innerHTML = `<span class="context-menu-icon">${iconSvg(icon, 14)}</span><span class="context-menu-label"></span>`;
    b.querySelector(".context-menu-label").textContent = text;
    b.addEventListener("click", async () => {
      closeMenu();
      await fn();
    });
    box.appendChild(b);
  };
  item("notePlus", i18n("Событие в этот день"), () => opts.onAddEvent(date));
  item("pushpin", i18n("Праздник в этот день (каждый год)"), async () => {
    calendar.holidays = [...(calendar.holidays || []), { id: uid(), name: i18n("Новый праздник"), month: shownMonth, day, kind: "holiday", color: "#a4483c" }];
    await saveCalendar(calendar);
    opts.onEditCalendar("holidays");
  });
  item("clock", isToday(calendar, date.year, date.month, day) ? i18n("Это и есть «сегодня в мире»") : i18n("Сделать «сегодня в мире»"), async () => {
    calendar.today = date;
    await saveCalendar(calendar);
    draw();
  });
  const r = anchor.getBoundingClientRect();
  openPopover(r.left, r.bottom + 4, box, "wcal-popover");
}

function buildSide(opts, marks, draw) {
  const { calendar } = opts;
  const side = document.createElement("aside");
  side.className = "wcal-side";

  const now = document.createElement("div");
  now.innerHTML = `<div class="wcal-k"></div><div class="wcal-now"></div><div class="wcal-sub"></div>`;
  now.querySelector(".wcal-k").textContent = i18n("Сегодня в мире");
  now.querySelector(".wcal-now").textContent = calendar.today ? formatDate(calendar, calendar.today) : i18n("Не выбрано");
  now.querySelector(".wcal-sub").textContent = calendar.today
    ? i18n("Щёлкни по числу в месяце, чтобы передвинуть")
    : i18n("Щёлкни по числу в месяце – «Сделать «сегодня в мире»»");
  side.appendChild(now);

  const legend = document.createElement("div");
  legend.className = "wcal-legend";
  legend.innerHTML = `<span><b class="today"></b>${i18n("сегодня")}</span><span><b class="hol"></b>${i18n("праздник")}</span><span><b class="bd"></b>${i18n("день рождения")}</span><span><b class="ev"></b>${i18n("событие")}</span>`;
  side.appendChild(legend);

  const m = view === "month" ? shownMonth : calendar.today?.year === shownYear ? calendar.today.month : null;
  const listTitle = document.createElement("div");
  listTitle.className = "wcal-k";
  const list = document.createElement("div");
  list.className = "wcal-list";
  if (m == null) {
    listTitle.textContent = `${shownYear} ${calendar.eraLabel || i18n("год")}`;
    const yearItems = [];
    calendar.months.forEach((month, mi) => {
      for (let d = 1; d <= month.days; d++) {
        for (const it of dayItems(calendar, marks, shownYear, mi, d)) yearItems.push({ ...it, when: `${d} ${month.name}` });
      }
      for (const it of marks.month.get(`${shownYear}|${mi}`) || []) yearItems.push({ ...it, when: month.name });
    });
    for (const it of marks.month.get(`${shownYear}|year`) || []) yearItems.push({ ...it, when: i18n("в течение года") });
    fillList(list, yearItems, opts);
  } else {
    const month = calendar.months[m];
    listTitle.textContent = `${month.name} · ${shownYear}`;
    const monthItems = [];
    for (let d = 1; d <= month.days; d++) {
      for (const it of dayItems(calendar, marks, shownYear, m, d)) monthItems.push({ ...it, when: i18n("{n}-е", { n: d }) });
    }
    for (const it of marks.month.get(`${shownYear}|${m}`) || []) monthItems.push({ ...it, when: i18n("в течение месяца") });
    fillList(list, monthItems, opts);
  }
  side.append(listTitle, list);

  const edit = document.createElement("button");
  edit.className = "btn";
  edit.innerHTML = `${iconSvg("settings", 14)}<span></span>`;
  edit.querySelector("span").textContent = i18n("Месяцы, неделя, праздники…");
  edit.addEventListener("click", () => opts.onEditCalendar());
  side.appendChild(edit);
  return side;
}

function fillList(list, items, opts) {
  if (!items.length) {
    const none = document.createElement("div");
    none.className = "wcal-sub";
    none.textContent = i18n("Ничего не отмечено");
    list.appendChild(none);
    return;
  }
  for (const it of items) {
    const row = document.createElement("button");
    row.className = `wcal-row ${it.kind}`;
    if (it.kind === "holiday" && it.color) row.style.setProperty("--hol", it.color);
    row.innerHTML = `<i></i><span class="wcal-row-main"><span class="wcal-row-title"></span><span class="wcal-row-sub"></span></span>`;
    row.querySelector(".wcal-row-title").textContent = it.kind === "birthday" ? `${i18n("День рождения")}: ${it.title}` : it.title;
    const kindText = { event: i18n("событие"), holiday: i18n(holidayKindLabel(it.sub)), birthday: it.sub, date: i18n("дата из анкеты") }[it.kind];
    row.querySelector(".wcal-row-sub").textContent = [it.when, kindText].filter(Boolean).join(" · ");
    row.addEventListener("click", () => buildTag(it, opts).click());
    list.appendChild(row);
  }
}

// Для события, созданного щелчком по дню: те же поля, что пишет
// карточка события при своём календаре (timeline.js).
export function eventDateFields(calendar, { year, month, day }) {
  return { dateYear: year, dateMonth: month, dateDay: day, date: formatDate(calendar, { year, month, day }), order: absoluteDay(calendar, year, month, day) };
}

