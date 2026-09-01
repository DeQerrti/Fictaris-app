import { i18n } from "./i18n.js";

// ══════════════════════════════════════════════
//  МОДАЛКА КАРТОЧКИ
//
//  Клик по узлу графа (graph.js), по @упоминанию в тексте главы
//  (mentions.js) и по похожим ссылкам раньше уводил на весь модуль
//  «Персонажи»/«Локации»/«Фракции» — граф или текст, с которых ушли,
//  приходилось открывать заново. Модалка держит поверх текущего экрана
//  тот же самый рендер модуля (main.js — MODULES[name], focusId
//  открывает нужную карточку сам), просто в отдельной панели: закрыл —
//  вернулся туда, где был, ничего не перезагружая.
// ══════════════════════════════════════════════

let renderers = null;

export function initEntityModal(modules) {
  renderers = modules;
}

let modalEl = null;
let onCloseCb = null;

function onEscape(e) {
  if (e.key === "Escape") closeEntityModal();
}

export function closeEntityModal() {
  modalEl?.remove();
  modalEl = null;
  document.removeEventListener("keydown", onEscape);
  const cb = onCloseCb;
  onCloseCb = null;
  cb?.();
}

// options.onClose — зовётся один раз при закрытии модалки (крестик,
// клик мимо, Esc) — например, чтобы обновить экран, с которого модалку
// открыли (см. family-tree.js: добавили персонажа, отредактировали в
// модалке, дерево должно перерисоваться с учётом правки).
export async function openEntityModal(moduleName, focusId, options = {}) {
  const render = renderers?.[moduleName];
  if (!render) return;
  closeEntityModal();
  onCloseCb = options.onClose || null;

  const backdrop = document.createElement("div");
  backdrop.className = "entity-modal-backdrop";
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) closeEntityModal();
  });

  const panel = document.createElement("div");
  panel.className = "entity-modal-panel";

  const closeBtn = document.createElement("button");
  closeBtn.className = "entity-modal-close";
  closeBtn.textContent = "×";
  closeBtn.title = i18n("Закрыть");
  closeBtn.addEventListener("click", closeEntityModal);

  const body = document.createElement("div");
  body.className = "entity-modal-body";

  panel.append(closeBtn, body);
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  modalEl = backdrop;
  document.addEventListener("keydown", onEscape);

  await render(body, focusId);
}
