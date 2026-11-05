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
//  прочее) — общие на проект, а не на устройство:
//    calendar = {
//      months: [{ name, days, season? }],   season — winter|spring|summer|autumn
//      eraLabel,                            «год», «эра», «лето»…
//      weekdays: ["Пн", …],                 нет — обычная неделя из 7 дней
//      weekOffset,                          какой день недели у 1-го дня 1-го года
//      holidays: [{ id, name, month, day, kind, color }],  повторяются каждый год
//      today: { year, month, day },         «сегодня в мире»
//      enabled: false                       выключен, но месяцы не стёрты
//    }
//  month везде 0-based. Дата мира в поле анкеты (вид «Дата мира») —
//  строка "год-месяц-день" с месяцем от 1: "214-6-9".
//  Вид календаря — режим «Календарь» в Таймлайне (world-calendar.js),
//  настройка — боковая панель (calendar-editor.js).
// ══════════════════════════════════════════════

export function defaultMonths() {
  return Array.from({ length: 12 }, (_, i) => ({ name: i18n("Месяц {n}", { n: i + 1 }), days: 30 }));
}

// Последний прочитанный календарь — для мест, которым он нужен сразу,
// без ожидания (поле «Дата мира» в анкете рисуется синхронно).
let cached = null;
export function cachedCalendar() {
  return cached;
}

// Включённый календарь или null. loadCalendarSettings — как есть, даже
// выключенный (редактору нужны месяцы, чтобы включить обратно).
export async function loadCalendar() {
  const cal = await loadCalendarSettings();
  cached = cal && cal.enabled !== false ? cal : null;
  return cached;
}

export async function loadCalendarSettings() {
  const settings = await apiGet("/api/site-settings").catch(() => ({}));
  const cal = settings.calendar;
  return cal && Array.isArray(cal.months) && cal.months.length ? cal : null;
}

export async function saveCalendar(calendar) {
  const settings = (await apiGet("/api/site-settings").catch(() => ({}))) || {};
  await apiPost("/api/site-settings", { ...settings, calendar });
  cached = calendar && calendar.enabled !== false ? calendar : null;
}

export function defaultCalendar() {
  return { months: defaultMonths(), eraLabel: i18n("год"), weekdays: defaultWeekdays(), holidays: [] };
}

export function defaultWeekdays() {
  return ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => i18n(d));
}

export function weekdaysOf(calendar) {
  return Array.isArray(calendar?.weekdays) && calendar.weekdays.length ? calendar.weekdays : defaultWeekdays();
}

// День недели (0-based) — по сквозному счёту дней от начала летоисчисления.
export function weekdayOf(calendar, year, monthIndex, day) {
  const n = weekdaysOf(calendar).length;
  const abs = absoluteDay(calendar, year, monthIndex, day) - 1 + (calendar.weekOffset || 0);
  return ((abs % n) + n) % n;
}

export const SEASON_KEYS = ["winter", "spring", "summer", "autumn"];

// Месяц, в который попадает доля года (событие, у которого в дате есть
// только год и сезон): сперва по сезонам, если они расставлены у
// месяцев, иначе — просто по доле.
export function monthForFraction(calendar, frac, seasonKey) {
  if (seasonKey) {
    const i = calendar.months.findIndex((m) => m.season === seasonKey);
    if (i >= 0) return i;
  }
  const target = frac * yearLength(calendar);
  let acc = 0;
  for (let i = 0; i < calendar.months.length; i++) {
    acc += calendar.months[i].days;
    if (target < acc) return i;
  }
  return calendar.months.length - 1;
}

// Дата мира из поля анкеты: "214-6-9" → { year: 214, month: 5, day: 9 }.
export function parseWorldDate(value) {
  const m = /^\s*(-?\d+)-(\d+)-(\d+)\s*$/.exec(value || "");
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) };
}

export function stringifyWorldDate({ year, month, day }) {
  return `${year}-${month + 1}-${day}`;
}

// Подпись даты мира для чтения; без календаря — как записано.
export function formatWorldDate(value, calendar = cached) {
  const d = parseWorldDate(value);
  if (!d || !calendar) return value || "";
  return formatDate(calendar, d);
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
