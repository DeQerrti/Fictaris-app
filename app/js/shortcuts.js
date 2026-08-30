import { apiGet, apiPost } from "./api.js";
import { i18n } from "./i18n.js";

// ══════════════════════════════════════════════
//  ГОРЯЧИЕ КЛАВИШИ
//
//  По духу TasteID (app/js/utils.js): по умолчанию цифры 1–9
//  переключают модули по порядку в сайдбаре, без Alt/Ctrl. Поверх этого
//  можно назначить свою клавишу на конкретный модуль — привязка держится
//  за id модуля, а не за позицию, и работает даже если что-то в сайдбаре
//  когда-нибудь переставят или скроют.
//
//  Клавиша хранится по коду физической клавиши (e.code), а не по
//  символу (e.key): на русской раскладке e.key для тех же клавиш отдаёт
//  кириллицу, и сочетание молча переставало бы работать при переключении
//  раскладки. code от неё не зависит.
// ══════════════════════════════════════════════

let customBindings = {}; // { module: {code, shift, label} }

function isTyping(target) {
  const tag = target?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!target?.isContentEditable;
}

function matches(e, binding) {
  return !!binding && e.code === binding.code && e.shiftKey === !!binding.shift;
}

export function initShortcuts(onOpenModule) {
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping(e.target)) return;
    if (e.code === "Slash" || e.key === "Escape") return; // свои обработчики (поиск и т.п.)
    if (document.querySelector(".search-overlay:not(.hidden)")) return;

    for (const [module, binding] of Object.entries(customBindings)) {
      if (matches(e, binding)) {
        const btn = document.querySelector(`.nav-item[data-module="${module}"]`);
        if (btn && !btn.hidden) {
          e.preventDefault();
          onOpenModule(module);
        }
        return;
      }
    }

    const digitMatch = /^Digit([1-9])$/.exec(e.code);
    if (digitMatch) {
      const visible = Array.from(document.querySelectorAll(".nav-item[data-module]:not([hidden])"));
      const btn = visible[Number(digitMatch[1]) - 1];
      if (btn) {
        e.preventDefault();
        onOpenModule(btn.dataset.module);
      }
    }
  });
}

export async function loadShortcuts() {
  const settings = await apiGet("/api/site-settings").catch(() => ({}));
  customBindings = settings.keyBindings?.nav || {};
  return customBindings;
}

// ── Захват нажатия для настройки ────────────────
// Тот же приём, что у TasteID: подменяем текст кнопки на «Нажми
// клавишу…», следующий keydown — и есть новое значение, Escape отменяет.
export function captureKey(button, onCaptured) {
  const original = button.textContent;
  button.textContent = i18n("Нажми клавишу…");
  button.disabled = true;

  const finish = (result) => {
    document.removeEventListener("keydown", handler, true);
    button.disabled = false;
    button.textContent = original;
    if (result) onCaptured(result);
  };

  const handler = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      finish(null);
      return;
    }
    finish({ code: e.code, shift: e.shiftKey, label: e.key.length === 1 ? e.key.toUpperCase() : e.key });
  };
  document.addEventListener("keydown", handler, true);
}

export async function saveShortcut(module, binding) {
  const settings = (await apiGet("/api/site-settings").catch(() => ({}))) || {};
  const nav = { ...settings.keyBindings?.nav, [module]: binding };
  await apiPost("/api/site-settings", { ...settings, keyBindings: { ...settings.keyBindings, nav } });
  customBindings = nav;
}

export async function clearShortcut(module) {
  const settings = (await apiGet("/api/site-settings").catch(() => ({}))) || {};
  const nav = { ...settings.keyBindings?.nav };
  delete nav[module];
  await apiPost("/api/site-settings", { ...settings, keyBindings: { ...settings.keyBindings, nav } });
  customBindings = nav;
}
