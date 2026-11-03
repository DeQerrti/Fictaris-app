import { i18n } from "./i18n.js";
import { hasPendingSaves, holdSaves, releaseSaves, discardPendingSaves } from "./save-badge.js";

// ══════════════════════════════════════════════
//  ПРАВКИ ФАЙЛОВ ПРОЕКТА СНАРУЖИ
//
//  electron/watcher.js сообщает, что файлы проекта изменились не
//  самим приложением (редактор, Claude). Модули держат данные в памяти
//  и при следующем автосохранении записали бы старую копию целиком —
//  поэтому открытый раздел перечитывается с диска. Молча — только если
//  в памяти нет несохранённого: иначе выбирает человек, и ни один из
//  вариантов ничего не теряет насовсем — перезаписанная версия всё
//  равно ложится в .history (electron/vault.js).
//
//  На телефоне и в браузере window.fictaris нет — модуль ничего не делает.
// ══════════════════════════════════════════════

const NOTICE_MS = 3000;
let conflictEl = null;
let conflictFiles = new Set();
let noticeEl = null;
let noticeTimer = null;

export function initExternalChanges(reload) {
  if (!window.fictaris?.onVaultChanged) return;
  window.fictaris.onVaultChanged(({ files }) => {
    if (hasPendingSaves() || conflictEl) showConflict(files, reload);
    else {
      reload();
      showNotice(files);
    }
  });
}

function fileList(files) {
  return [...files].join(", ");
}

function showNotice(files) {
  noticeEl?.remove();
  clearTimeout(noticeTimer);
  noticeEl = document.createElement("div");
  noticeEl.className = "update-banner external-change-banner";
  const text = document.createElement("span");
  text.textContent = i18n("Обновлено с диска: {files}", { files: fileList(files) });
  noticeEl.appendChild(text);
  document.body.appendChild(noticeEl);
  noticeTimer = setTimeout(() => {
    noticeEl?.remove();
    noticeEl = null;
  }, NOTICE_MS);
}

function showConflict(files, reload) {
  for (const f of files) conflictFiles.add(f);
  noticeEl?.remove();
  noticeEl = null;
  holdSaves();
  if (!conflictEl) {
    conflictEl = document.createElement("div");
    conflictEl.className = "update-banner external-change-banner";
    const text = document.createElement("span");
    const actions = document.createElement("div");
    actions.className = "update-banner-actions";

    const loadBtn = document.createElement("button");
    loadBtn.className = "btn accent";
    loadBtn.textContent = i18n("Загрузить с диска");
    loadBtn.title = i18n("Несохранённые правки в приложении будут отброшены");
    loadBtn.addEventListener("click", () => {
      closeConflict();
      discardPendingSaves();
      reload();
    });

    const keepBtn = document.createElement("button");
    keepBtn.className = "btn";
    keepBtn.textContent = i18n("Оставить мои");
    keepBtn.title = i18n("Версия с диска останется в истории файла");
    keepBtn.addEventListener("click", () => {
      closeConflict();
      releaseSaves();
    });

    actions.append(loadBtn, keepBtn);
    conflictEl.append(text, actions);
    document.body.appendChild(conflictEl);
  }
  conflictEl.querySelector("span").textContent = i18n(
    "Файлы проекта изменены вне Fictaris ({files}), а здесь есть несохранённые правки.",
    { files: fileList(conflictFiles) }
  );
}

function closeConflict() {
  conflictEl?.remove();
  conflictEl = null;
  conflictFiles = new Set();
}
