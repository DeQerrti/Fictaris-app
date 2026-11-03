// Один и тот же индикатор "Сохранение…/Сохранено" на всё приложение —
// сохраняется всегда что-то одно за раз (см. очередь в electron/main.js),
// поэтому общий бейдж в сайдбаре не путает модули между собой.

import { i18n } from "./i18n.js";

const el = document.getElementById("saveBadge");
let hideTimer = null;

// Отложенные и ещё не дописанные сохранения — по ним external-changes.js
// понимает, можно ли молча перечитать раздел после правки файлов снаружи
// или это затрёт то, что человек только что набрал.
const pendingTimers = new Set();
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
  for (const t of pendingTimers) clearTimeout(t);
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
    const run = async () => {
      inFlight++;
      let res;
      try {
        res = await fn(...args);
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
    pendingTimers.add(timer);
  };
  return debounced;
}

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

function markSaving() {
  clearTimeout(hideTimer);
  el.textContent = i18n("Сохранение…");
  el.classList.add("saving");
}

function markSaved() {
  el.textContent = i18n("Сохранено");
  el.classList.remove("saving");
}
