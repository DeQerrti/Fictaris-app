import { apiGet, apiPost } from "./api.js";
import { wordCount } from "./stats.js";

// ══════════════════════════════════════════════
//  ДНЕВНАЯ ЦЕЛЬ И СЕРИЯ ДНЕЙ (writing-log.json)
//
//  Формат — { dailyGoal, days: { "YYYY-MM-DD": суммарноеЧислоСловНаТотМомент } }.
//  Не дельта за день, а именно снимок суммарной длины рукописи на
//  момент последнего сохранения в этот день — так проще писать
//  (recordToday вызывается на каждом autosave рукописи, не нужно
//  отдельно считать «сколько добавилось с прошлого раза») и надёжнее
//  читать (переписали кусок текста заново — снимок всё равно
//  корректный, просто следующий).
//
//  Сколько слов написано именно в день D, считает computeStats: разница
//  между снимком дня D и снимком ближайшего предыдущего *записанного*
//  дня (а не обязательно вчерашнего — если вчера ничего не сохраняли,
//  записи не было). День без записи в days трактуется как «в этот день
//  не писали» — 0 слов, серия прерывается.
// ══════════════════════════════════════════════

const DEFAULT_GOAL = 300;
const EMPTY = { dailyGoal: DEFAULT_GOAL, days: {} };

let saveTimer = null;
function debouncedSave(log) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    apiPost("/api/writing-log", log).catch(() => {});
  }, 800);
}

// Локальный календарный день (не UTC) — "сегодня" для человека значит
// его собственный часовой пояс, а не Гринвич. toISOString() даёт дату
// в UTC, что рядом с полуночью по местному времени в любом поясе,
// отличном от нулевого, может показать не тот день — отсюда своя
// сборка строки из локальных getFullYear/getMonth/getDate.
function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayKey() {
  return dateKey(new Date());
}

export async function loadWritingLog() {
  const log = await apiGet("/api/writing-log").catch(() => null);
  return log && typeof log.days === "object" ? { ...EMPTY, ...log } : { ...EMPTY };
}

export async function saveDailyGoal(dailyGoal) {
  const log = await loadWritingLog();
  log.dailyGoal = Math.max(0, Number(dailyGoal) || 0);
  await apiPost("/api/writing-log", log);
  return log;
}

// Вызывается из manuscript.js при каждом сохранении рукописи — считает
// суммарную длину заново и кладёт снимок под сегодняшнюю дату. Дешёвая
// операция (несколько .split в самой длинной рукописи), можно звать
// на каждый autosave не задумываясь.
export async function recordToday(manuscript) {
  const total = (manuscript.chapters || []).reduce((sum, c) => sum + wordCount(c.content), 0);
  const log = await loadWritingLog();
  log.days[todayKey()] = total;
  debouncedSave(log);
}

// dates — отсортированные ключи days по возрастанию; delta(d) = снимок
// дня d минус снимок ближайшего предыдущего дня с записью (0, если это
// вообще первая запись).
function deltasByDate(days) {
  const dates = Object.keys(days).sort();
  const deltas = {};
  let prevTotal = 0;
  for (const d of dates) {
    deltas[d] = Math.max(0, days[d] - prevTotal);
    prevTotal = days[d];
  }
  return deltas;
}

// Тоже строго в локальном времени — по тем же причинам, что и todayKey
// выше: разбираем "YYYY-MM-DD" на числа сами (не отдаём строку в new
// Date(), чтобы её не разобрали как UTC-момент), собираем локальную
// полночь, и setDate уже сам верно переносит через границы месяца/года.
function shiftDate(dateStr, deltaDays) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  return dateKey(dt);
}

// { goal, todayWords, todayHit, streak, last14 } — last14: [{ date, words, hit }],
// от 13 дней назад до сегодня, для мини-графика в stats.js.
//
// Серия не обнуляется в полночь сегодняшнего дня, если цель просто ещё
// не достигнута, а не провалена: если сегодня уже написано достаточно,
// серия считает и сегодня; если ещё нет — считает подтверждённую серию
// по вчерашний день включительно, а сегодняшний прогресс показывает
// отдельно (todayWords/todayHit) — иначе счётчик сбрасывался бы каждое
// утро до первого сохранения, что выглядело бы как «потерял серию»,
// хотя день ещё не кончился.
export function computeStats(log) {
  const goal = log.dailyGoal || 0;
  const deltas = deltasByDate(log.days);
  const today = todayKey();
  const todayWords = deltas[today] || 0;
  const todayHit = goal > 0 && todayWords >= goal;

  let streak = 0;
  if (goal > 0) {
    let cursor = todayHit ? today : shiftDate(today, -1);
    while ((deltas[cursor] || 0) >= goal) {
      streak++;
      cursor = shiftDate(cursor, -1);
    }
  }

  const last14 = [];
  for (let i = 13; i >= 0; i--) {
    const date = shiftDate(today, -i);
    const words = deltas[date] || 0;
    last14.push({ date, words, hit: goal > 0 && words >= goal });
  }

  return { goal, todayWords, todayHit, streak, last14 };
}
