import { apiGet, apiPost } from "./api.js";
import { i18n } from "./i18n.js";

// ══════════════════════════════════════════════
//  КАЛЕНДАРЬ
//
//  По умолчанию таймлайн работает как раньше: дата — свободный текст,
//  число внутри него двигает событие по шкале (см. orderFromDate в
//  timeline.js). Это устраивает того, кому хватает «года 214» — и
//  ломать для всех уже сохранённые события ради фичи, нужной не всем,
//  не стоило. Свой календарь — надстройка сверху, включается по
//  желанию: тогда дата в карточке события — не текст, а три поля (год/
//  месяц/день) по названиям месяцев из этих настроек, а порядок на
//  шкале считается точно, а не эвристикой по числу в строке.
//
//  Настройки календаря живут в site-settings.json (как тема, подписи и
//  прочее) — общие на проект, а не на устройство.
// ══════════════════════════════════════════════

export function defaultMonths() {
  return Array.from({ length: 12 }, (_, i) => ({ name: i18n("Месяц {n}", { n: i + 1 }), days: 30 }));
}

export async function loadCalendar() {
  const settings = await apiGet("/api/site-settings").catch(() => ({}));
  return settings.calendar && Array.isArray(settings.calendar.months) && settings.calendar.months.length
    ? settings.calendar
    : null;
}

export async function saveCalendar(calendar) {
  const settings = (await apiGet("/api/site-settings").catch(() => ({}))) || {};
  await apiPost("/api/site-settings", { ...settings, calendar });
}

export function yearLength(calendar) {
  return calendar.months.reduce((sum, m) => sum + m.days, 0);
}

// monthIndex — 0-based. Число только для сравнения между собой
// (сортировка/позиция на шкале), не календарная дата в чьём-либо
// стороннем формате.
export function absoluteDay(calendar, year, monthIndex, day) {
  let days = 0;
  for (let i = 0; i < monthIndex; i++) days += calendar.months[i]?.days || 0;
  return year * yearLength(calendar) + days + day;
}

export function formatDate(calendar, { year, month, day }) {
  const m = calendar.months[month];
  const era = calendar.eraLabel || i18n("год");
  return `${day} ${m ? m.name : "?"}, ${year} ${era}`;
}
