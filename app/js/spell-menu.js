// ══════════════════════════════════════════════
//  ПРАВАЯ КНОПКА С ПОДСКАЗКАМИ ОРФОГРАФИИ
//
//  Electron подчёркивает ошибки сам, а варианты исправления показывает в
//  своём меню (electron/main.js, buildContextMenu). Редактор главы рисует
//  собственное меню — и раньше оно перекрывало системное: подчёркнутое
//  слово было, а «как исправить» и «Добавить в словарь» — нет.
//
//  Теперь в Electron страница не гасит правую кнопку сразу, а запоминает
//  запрос; главный процесс, получив событие, отдаёт подсказки сюда
//  (window.__editorContextMenu) — и меню редактора открывается уже с ними
//  сверху. Не откликнулся (телефон, браузер) — через долю секунды меню
//  откроется без подсказок, как раньше.
// ══════════════════════════════════════════════

import { openContextMenu } from "./context-menu.js";
import { i18n } from "./i18n.js";

let pending = null;

function invoke(path, body) {
  return window.fictaris?.invoke?.("POST", path, body).catch?.(() => {});
}

function spellItems(spell) {
  if (!spell?.misspelledWord) return [];
  const items = (spell.suggestions || []).slice(0, 6).map((s) => ({
    label: s,
    action: () => invoke("/api/app/replace-misspelling", { text: s }),
  }));
  if (!items.length) items.push({ label: i18n("Нет вариантов исправления"), disabled: true });
  items.push(
    { label: i18n("Добавить «{word}» в словарь", { word: spell.misspelledWord }), action: () => invoke("/api/app/add-to-dictionary", { word: spell.misspelledWord }) },
    { separator: true }
  );
  return items;
}

// buildItems({ x, y, target }) — пункты меню; зовётся в момент открытия
// (выделение к этому времени уже то, что видит человек).
export function attachSpellAwareContextMenu(el, buildItems) {
  el.addEventListener("contextmenu", (e) => {
    const at = { x: e.clientX, y: e.clientY, target: e.target };
    const open = (spell) => openContextMenu(at.x, at.y, [...spellItems(spell), ...buildItems(at)]);
    if (!window.fictaris?.invoke) {
      e.preventDefault();
      open(null);
      return;
    }
    const req = { open };
    req.timer = setTimeout(() => {
      if (pending !== req) return;
      pending = null;
      open(null);
    }, 400);
    pending = req;
  });
}

// Зовёт electron/main.js из своего обработчика "context-menu".
// true — меню нарисовала страница, системное не нужно.
window.__editorContextMenu = (spell) => {
  const req = pending;
  if (!req) return false;
  pending = null;
  clearTimeout(req.timer);
  req.open(spell);
  return true;
};
