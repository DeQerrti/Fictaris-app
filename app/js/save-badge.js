// Один и тот же индикатор "Сохранение…/Сохранено" на всё приложение —
// сохраняется всегда что-то одно за раз (см. очередь в electron/server.js),
// поэтому общий бейдж в сайдбаре не путает модули между собой.

import { i18n } from "./i18n.js";

const el = document.getElementById("saveBadge");
let hideTimer = null;

export function debounceSave(fn, delay = 600) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    markSaving();
    timer = setTimeout(async () => {
      await fn(...args);
      markSaved();
    }, delay);
  };
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
