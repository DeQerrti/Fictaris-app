import { uid } from "./api.js";
import { iconSvg } from "./icons.js";
import { loadCalendarSettings, saveCalendar, defaultCalendar, defaultWeekdays, weekdaysOf, yearLength, formatDate, SEASON_KEYS } from "./calendar.js";
import { HOLIDAY_KINDS } from "./world-calendar.js";
import { i18n, i18nPlural } from "./i18n.js";

// ══════════════════════════════════════════════
//  НАСТРОЙКА КАЛЕНДАРЯ МИРА (боковая панель из Таймлайна)
//
//  Вкладки: «Месяцы» (название, дни, сезон; название года), «Неделя»
//  (дни недели и с какого дня начался 1-й год), «Праздники» (каждый
//  год: название, день, месяц, вид, цвет), «Сегодня» («сегодня в мире»
//  и выключить свой календарь — месяцы при этом не стираются). Всё
//  видно сразу в режиме «Календарь» Таймлайна после закрытия панели.
//  Формат данных — в шапке calendar.js.
// ══════════════════════════════════════════════

const TABS = [
  ["months", "Месяцы"],
  ["week", "Неделя"],
  ["holidays", "Праздники"],
  ["today", "Сегодня"],
];
const SEASON_LABELS = { winter: "зима", spring: "весна", summer: "лето", autumn: "осень" };
const HOLIDAY_COLORS = ["#a4483c", "#c9944a", "#5a8a5f", "#6a8fae", "#7d6a9e"];

let root = null;
let tab = "months";
let cal = null;
let saveTimer = null;

export async function renderCalendarEditor(body, startTab) {
  root = body;
  if (startTab && TABS.some(([k]) => k === startTab)) tab = startTab;
  cal = await loadCalendarSettings();
  if (!cal || cal.enabled === false) {
    // открыли настройку — значит, календарь нужен: включаем
    cal = cal ? { ...cal, enabled: true } : defaultCalendar();
    await saveCalendar(cal);
  }
  render();
}

function save(now = false) {
  clearTimeout(saveTimer);
  if (now) return saveCalendar(cal);
  saveTimer = setTimeout(() => saveCalendar(cal), 400);
  return null;
}

function render() {
  root.innerHTML = "";
  const tabs = document.createElement("div");
  tabs.className = "cale-tabs";
  for (const [key, label] of TABS) {
    const b = document.createElement("button");
    b.className = "cale-tab" + (key === tab ? " active" : "");
    b.textContent = i18n(label);
    if (key === "holidays" && cal.holidays?.length) b.textContent += ` · ${cal.holidays.length}`;
    b.addEventListener("click", () => {
      tab = key;
      render();
    });
    tabs.appendChild(b);
  }
  root.appendChild(tabs);

  const summary = document.createElement("div");
  summary.className = "cale-summary";
  summary.textContent = i18n("В году {months} · {days} · неделя из {week}", {
    months: i18nPlural(cal.months.length, ["{n} месяц", "{n} месяца", "{n} месяцев"]),
    days: i18nPlural(yearLength(cal), ["{n} день", "{n} дня", "{n} дней"]),
    week: weekdaysOf(cal).length,
  });
  root.appendChild(summary);

  const body = document.createElement("div");
  body.className = "cale-body";
  ({ months: renderMonths, week: renderWeek, holidays: renderHolidays, today: renderToday })[tab](body);
  root.appendChild(body);
}

// ── Месяцы ─────────────────────────────────────
function renderMonths(body) {
  const era = document.createElement("label");
  era.className = "cale-row-label";
  era.innerHTML = `<span></span>`;
  era.firstChild.textContent = i18n("Как называется год");
  const eraInput = document.createElement("input");
  eraInput.className = "field-inline-control";
  eraInput.value = cal.eraLabel || i18n("год");
  eraInput.placeholder = i18n("год, лето, эра…");
  eraInput.addEventListener("input", () => {
    cal.eraLabel = eraInput.value.trim() || i18n("год");
    save();
  });
  era.appendChild(eraInput);
  body.appendChild(era);

  const head = document.createElement("div");
  head.className = "cale-month cale-month-head";
  head.innerHTML = `<span></span><span></span><span></span><span></span><span></span>`;
  head.children[1].textContent = i18n("Месяц");
  head.children[2].textContent = i18n("Дней");
  head.children[3].textContent = i18n("Сезон");
  body.appendChild(head);

  let dragIndex = null;
  cal.months.forEach((m, i) => {
    const row = document.createElement("div");
    row.className = "cale-month";
    row.draggable = true;
    const grip = document.createElement("span");
    grip.className = "fe-grip";
    grip.textContent = "⠿";
    const name = document.createElement("input");
    name.className = "field-inline-control";
    name.value = m.name;
    name.addEventListener("input", () => {
      m.name = name.value.trim() || m.name;
      save();
    });
    const days = document.createElement("input");
    days.type = "number";
    days.min = "1";
    days.max = "99";
    days.className = "field-inline-control";
    days.value = m.days;
    days.addEventListener("change", () => {
      m.days = Math.max(1, Math.min(99, Number(days.value) || 30));
      days.value = m.days;
      save(true);
      render();
    });
    const season = document.createElement("select");
    season.className = "kin-kind-select";
    season.innerHTML = `<option value="">–</option>`;
    for (const key of SEASON_KEYS) {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = i18n(SEASON_LABELS[key]);
      if (m.season === key) opt.selected = true;
      season.appendChild(opt);
    }
    season.title = i18n("Сезон – чтобы события с датой «год 214, весна» вставали в свой месяц");
    season.addEventListener("change", () => {
      if (season.value) m.season = season.value;
      else delete m.season;
      save();
    });
    const del = document.createElement("button");
    del.className = "fe-del";
    del.innerHTML = iconSvg("close", 13);
    del.title = i18n("Убрать месяц");
    del.disabled = cal.months.length <= 1;
    del.addEventListener("click", () => {
      cal.months.splice(i, 1);
      save(true);
      render();
    });
    for (const el of [name, days]) {
      el.addEventListener("mousedown", () => { row.draggable = false; });
      el.addEventListener("blur", () => { row.draggable = true; });
    }
    row.addEventListener("dragstart", () => { dragIndex = i; });
    row.addEventListener("dragover", (e) => { if (dragIndex !== null && dragIndex !== i) e.preventDefault(); });
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      if (dragIndex === null || dragIndex === i) return;
      const [moved] = cal.months.splice(dragIndex, 1);
      cal.months.splice(i, 0, moved);
      dragIndex = null;
      save(true);
      render();
    });
    row.append(grip, name, days, season, del);
    body.appendChild(row);
  });

  const add = document.createElement("button");
  add.className = "btn";
  add.textContent = i18n("+ Месяц");
  add.addEventListener("click", () => {
    cal.months.push({ name: i18n("Месяц {n}", { n: cal.months.length + 1 }), days: cal.months.at(-1)?.days || 30 });
    save(true);
    render();
  });
  body.appendChild(add);
}

// ── Неделя ─────────────────────────────────────
function renderWeek(body) {
  const hint = document.createElement("div");
  hint.className = "cale-hint";
  hint.textContent = i18n("Сколько дней в неделе и как они называются – по ним строятся столбцы календаря.");
  body.appendChild(hint);

  const days = [...weekdaysOf(cal)];
  const list = document.createElement("div");
  list.className = "cale-weekdays";
  days.forEach((d, i) => {
    const wrap = document.createElement("span");
    wrap.className = "cale-weekday";
    const input = document.createElement("input");
    input.className = "field-inline-control";
    input.value = d;
    input.addEventListener("input", () => {
      days[i] = input.value.trim() || d;
      cal.weekdays = [...days];
      save();
    });
    const del = document.createElement("button");
    del.className = "fe-del";
    del.innerHTML = iconSvg("close", 12);
    del.title = i18n("Убрать день недели");
    del.disabled = days.length <= 1;
    del.addEventListener("click", () => {
      days.splice(i, 1);
      cal.weekdays = days;
      if ((cal.weekOffset || 0) >= days.length) cal.weekOffset = 0;
      save(true);
      render();
    });
    wrap.append(input, del);
    list.appendChild(wrap);
  });
  const add = document.createElement("button");
  add.className = "tagm-chip add";
  add.textContent = i18n("+ день");
  add.addEventListener("click", () => {
    cal.weekdays = [...days, i18n("День {n}", { n: days.length + 1 })];
    save(true);
    render();
  });
  list.appendChild(add);
  body.appendChild(list);

  const start = document.createElement("label");
  start.className = "cale-row-label";
  start.innerHTML = `<span></span>`;
  start.firstChild.textContent = i18n("1-й день 1-го года – это");
  const sel = document.createElement("select");
  sel.className = "kin-kind-select";
  days.forEach((d, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = d;
    if ((cal.weekOffset || 0) === i) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener("change", () => {
    cal.weekOffset = Number(sel.value);
    save();
  });
  start.appendChild(sel);
  body.appendChild(start);

  const reset = document.createElement("button");
  reset.className = "btn";
  reset.textContent = i18n("Обычная неделя из 7 дней");
  reset.addEventListener("click", () => {
    cal.weekdays = defaultWeekdays();
    cal.weekOffset = 0;
    save(true);
    render();
  });
  body.appendChild(reset);
}

// ── Праздники ──────────────────────────────────
function renderHolidays(body) {
  const hint = document.createElement("div");
  hint.className = "cale-hint";
  hint.textContent = i18n("Повторяются каждый год. Красные дни – в календаре сразу видно. Дни рождения отдельно вводить не нужно: они берутся из поля анкеты вида «Дата мира» (например, «Дата рождения»).");
  body.appendChild(hint);

  const list = cal.holidays || [];
  if (!list.length) {
    const none = document.createElement("div");
    none.className = "wcal-sub";
    none.textContent = i18n("Праздников пока нет.");
    body.appendChild(none);
  }
  list.forEach((h, i) => {
    const card = document.createElement("div");
    card.className = "cale-hol";
    card.style.setProperty("--hol", h.color || HOLIDAY_COLORS[0]);

    const top = document.createElement("div");
    top.className = "cale-hol-top";
    const name = document.createElement("input");
    name.className = "fe-label";
    name.value = h.name;
    name.addEventListener("input", () => {
      h.name = name.value.trim() || i18n("Праздник");
      save();
    });
    const del = document.createElement("button");
    del.className = "fe-del";
    del.innerHTML = iconSvg("close", 13);
    del.title = i18n("Удалить праздник");
    del.addEventListener("click", () => {
      cal.holidays.splice(i, 1);
      save(true);
      render();
    });
    top.append(name, del);
    card.appendChild(top);

    const row = document.createElement("div");
    row.className = "cale-hol-row";
    const day = document.createElement("input");
    day.type = "number";
    day.min = "1";
    day.className = "field-inline-control";
    day.value = h.day;
    const month = document.createElement("select");
    month.className = "kin-kind-select";
    cal.months.forEach((m, mi) => {
      const opt = document.createElement("option");
      opt.value = String(mi);
      opt.textContent = m.name;
      if (h.month === mi) opt.selected = true;
      month.appendChild(opt);
    });
    const applyDate = () => {
      h.month = Number(month.value);
      const max = cal.months[h.month]?.days || 30;
      h.day = Math.max(1, Math.min(max, Number(day.value) || 1));
      day.value = h.day;
      save();
    };
    day.addEventListener("change", applyDate);
    month.addEventListener("change", applyDate);
    const kind = document.createElement("select");
    kind.className = "kin-kind-select";
    for (const [k, label] of HOLIDAY_KINDS) {
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = i18n(label);
      if ((h.kind || "holiday") === k) opt.selected = true;
      kind.appendChild(opt);
    }
    kind.addEventListener("change", () => {
      h.kind = kind.value;
      save();
    });
    const colors = document.createElement("span");
    colors.className = "cale-colors";
    for (const c of HOLIDAY_COLORS) {
      const sw = document.createElement("button");
      sw.className = "cale-color" + ((h.color || HOLIDAY_COLORS[0]) === c ? " active" : "");
      sw.style.background = c;
      sw.title = i18n("Цвет в календаре");
      sw.addEventListener("click", () => {
        h.color = c;
        save(true);
        render();
      });
      colors.appendChild(sw);
    }
    row.append(day, month, kind, colors);
    card.appendChild(row);
    body.appendChild(card);
  });

  const add = document.createElement("button");
  add.className = "btn";
  add.textContent = i18n("+ Праздник");
  add.addEventListener("click", () => {
    cal.holidays = [...list, { id: uid(), name: i18n("Новый праздник"), month: 0, day: 1, kind: "holiday", color: HOLIDAY_COLORS[0] }];
    save(true);
    render();
    root.querySelectorAll(".cale-hol .fe-label")[cal.holidays.length - 1]?.select();
  });
  body.appendChild(add);
}

// ── Сегодня ────────────────────────────────────
function renderToday(body) {
  const hint = document.createElement("div");
  hint.className = "cale-hint";
  hint.textContent = i18n("«Сегодня в мире» – точка, где сейчас стоит история. От неё Календарь открывается и считает возраст.");
  body.appendChild(hint);

  const t = cal.today || { year: 1, month: 0, day: 1 };
  const row = document.createElement("div");
  row.className = "cale-hol-row";
  const day = document.createElement("input");
  day.type = "number";
  day.min = "1";
  day.className = "field-inline-control";
  day.value = cal.today ? t.day : "";
  day.placeholder = i18n("день");
  const month = document.createElement("select");
  month.className = "kin-kind-select";
  cal.months.forEach((m, mi) => {
    const opt = document.createElement("option");
    opt.value = String(mi);
    opt.textContent = m.name;
    if (t.month === mi) opt.selected = true;
    month.appendChild(opt);
  });
  const year = document.createElement("input");
  year.type = "number";
  year.className = "field-inline-control";
  year.value = cal.today ? t.year : "";
  year.placeholder = cal.eraLabel || i18n("год");
  const shown = document.createElement("div");
  shown.className = "wcal-now";
  shown.textContent = cal.today ? formatDate(cal, cal.today) : i18n("Не выбрано");
  const apply = () => {
    if (day.value === "" || year.value === "") return;
    const m = Number(month.value);
    const max = cal.months[m]?.days || 30;
    cal.today = { year: Number(year.value) || 0, month: m, day: Math.max(1, Math.min(max, Number(day.value) || 1)) };
    day.value = cal.today.day;
    shown.textContent = formatDate(cal, cal.today);
    save();
  };
  for (const el of [day, month, year]) el.addEventListener("change", apply);
  row.append(day, month, year);
  body.append(shown, row);

  if (cal.today) {
    const clear = document.createElement("button");
    clear.className = "btn";
    clear.textContent = i18n("Не отмечать «сегодня»");
    clear.addEventListener("click", () => {
      delete cal.today;
      save(true);
      render();
    });
    body.appendChild(clear);
  }

  const off = document.createElement("div");
  off.className = "cale-off";
  off.innerHTML = `<div class="cale-hint"></div>`;
  off.firstChild.textContent = i18n("Выключить свой календарь – даты событий снова станут свободным текстом. Месяцы, неделя и праздники сохранятся: включишь – всё вернётся.");
  const btn = document.createElement("button");
  btn.className = "btn danger";
  btn.textContent = i18n("Выключить свой календарь");
  btn.addEventListener("click", async () => {
    cal.enabled = false;
    await save(true);
    btn.disabled = true;
    btn.textContent = i18n("Выключен – закрой панель");
  });
  off.appendChild(btn);
  body.appendChild(off);
}
