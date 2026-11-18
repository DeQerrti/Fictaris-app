// Один и тот же индикатор "Сохранение…/Сохранено" на всё приложение —
// сохраняется всегда что-то одно за раз (см. очередь в electron/main.js),
// поэтому общий бейдж в сайдбаре не путает модули между собой.

import { i18n } from "./i18n.js";

const el = document.getElementById("saveBadge");
let hideTimer = null;

// Отложенные и ещё не дописанные сохранения — по ним external-changes.js
// понимает, можно ли молча перечитать раздел после правки файлов снаружи
// или это затрёт то, что человек только что набрал.
const pendingTimers = new Map(); // таймер → запись, которую он запустит
const inFlightRuns = new Set(); // промисы уже идущих записей
let inFlight = 0;

// Пока человек не выбрал, чья версия остаётся (конфликт в
// external-changes.js), сохранения не уходят на диск, а ждут здесь —
// по последнему вызову на каждый debounceSave: тот пишет файл целиком,
// промежуточные не нужны.
let held = null; // Map<debounced, () => Promise> | null

export function hasPendingSaves() {
  return pendingTimers.size > 0 || inFlight > 0 || held?.size > 0;
}

export function holdSaves() {
  held ??= new Map();
}

// «Оставить мои» — придержанное уходит на диск как обычно.
export function releaseSaves() {
  const calls = held ? [...held.values()] : [];
  held = null;
  for (const run of calls) run();
}

// «Загрузить с диска» — придержанные и отложенные правки выбрасываются.
export function discardPendingSaves() {
  for (const t of pendingTimers.keys()) clearTimeout(t);
  pendingTimers.clear();
  held = null;
  if (!inFlight) markSaved();
}

export function debounceSave(fn, delay = 600) {
  let timer = null;
  const debounced = (...args) => {
    clearTimeout(timer);
    pendingTimers.delete(timer);
    markSaving();
    const run = () => {
      const p = write();
      inFlightRuns.add(p);
      p.finally(() => inFlightRuns.delete(p));
      return p;
    };
    const write = async () => {
      inFlight++;
      let res;
      try {
        res = await fn(...args);
      } catch (e) {
        // Например, apiPost отказался писать в испорченный файл (api.js).
        // Раньше исключение здесь оставляло бейдж на «Сохранение…» и
        // никто не узнавал, что правка не записана.
        res = { error: e?.message || String(e) };
      } finally {
        inFlight--;
      }
      // apiPost не бросает на ответ с ошибкой — отказ сервера иначе
      // проходил бы молча (так с 0.3.5 по 0.3.19 терялись все правки Доски).
      if (res?.error) showSaveError(res.error);
      markSaved();
    };
    timer = setTimeout(() => {
      pendingTimers.delete(timer);
      if (held) held.set(debounced, run);
      else run();
    }, delay);
    pendingTimers.set(timer, run);
  };
  return debounced;
}

// Дописать всё отложенное сейчас же, не дожидаясь таймеров: перед
// закрытием окна (electron/main.js → __syncBeforeQuit), перед F5 и перед
// переключением проекта. Иначе фраза, набранная за последние полсекунды
// до закрытия, терялась. Придержанное конфликтом (external-changes.js)
// тоже пишется: версия с диска при этом остаётся в .history.
// Кто держит несобранные правки у себя (редактор длинной главы собирает
// текст после паузы, rich-editor.js) — отдаёт их перед срочной записью.
const beforeFlush = new Set();
export function addBeforeFlush(fn) {
  beforeFlush.add(fn);
  return () => beforeFlush.delete(fn);
}

export async function flushPendingSaves() {
  for (const fn of [...beforeFlush]) {
    try {
      fn();
    } catch {
      // чужая ошибка не должна мешать записи остального
    }
  }
  const runs = [...pendingTimers.values()];
  for (const t of pendingTimers.keys()) clearTimeout(t);
  pendingTimers.clear();
  if (held) {
    runs.push(...held.values());
    held = null;
  }
  const started = runs.map((run) => run());
  await Promise.allSettled([...started, ...inFlightRuns]);
}

if (typeof window !== "undefined") window.__flushPendingSaves = flushPendingSaves;

const ERROR_MS = 8000;
let errorEl = null;
let errorTimer = null;

function showSaveError(message) {
  errorEl?.remove();
  clearTimeout(errorTimer);
  errorEl = document.createElement("div");
  errorEl.className = "update-banner external-change-banner";
  const text = document.createElement("span");
  text.textContent = i18n("Не удалось сохранить: {error}", { error: message });
  errorEl.appendChild(text);
  document.body.appendChild(errorEl);
  errorTimer = setTimeout(() => {
    errorEl?.remove();
    errorEl = null;
  }, ERROR_MS);
}

// Испорченный файл (api.js → fictaris:file-broken) — постоянное
// предупреждение, а не исчезающее через 8 секунд: правки в этот раздел
// не сохраняются, пока файл не починят или не откатят из истории.
document.addEventListener("fictaris:file-broken", (e) => {
  const bar = document.createElement("div");
  bar.className = "update-banner external-change-banner file-broken-banner";
  const text = document.createElement("span");
  text.textContent = i18n(
    "Файл не читается, правки в нём не сохраняются, чтобы не затереть данные: {error} Верни прошлую версию: Настройки → Этот мир → Данные → История версий.",
    { error: e.detail.error }
  );
  const close = document.createElement("button");
  close.className = "btn";
  close.textContent = i18n("Понятно");
  close.addEventListener("click", () => bar.remove());
  bar.append(text, close);
  document.body.appendChild(bar);
});

function markSaving() {
  clearTimeout(hideTimer);
  el.textContent = i18n("Сохранение…");
  el.classList.add("saving");
}

function markSaved() {
  el.textContent = i18n("Сохранено");
  el.classList.remove("saving");
}
