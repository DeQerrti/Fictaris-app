import { apiGet, apiPost } from "./api.js";
import { i18n } from "./i18n.js";

// ══════════════════════════════════════════════
//  ПОЛОСКА ОБНОВЛЕНИЯ (десктоп)
//
//  electron-updater (Windows/Linux) качает файл в фоне сам, macOS — нет
//  (см. electron/update.js). В обоих случаях главный процесс просто
//  запоминает, что обновление готово или доступно, а страница узнаёт об
//  этом обычным поллингом GET /api/app/update-status — без ipc, тем же
//  приёмом, что и весь остальной мост страница↔диск.
//
//  На телефоне не подключается: там своя, полностью клиентская проверка
//  прямо внутри mobile.bundle.js.
// ══════════════════════════════════════════════

const POLL_MS = 60_000;
let shown = false;

// Обновление готово (тихо скачано, осталось перезапустить) — модалка по
// центру с фоном-заглушкой: перезапуск заменяет файлы приложения на
// диске, поэтому продолжать работать в старой открытой копии до выбора
// не должно быть можно — только «Обновить» или «Позже», без клика мимо.
// «Доступно обновление» (macOS, просто ссылка на скачивание вручную) —
// по-прежнему мягкая полоска снизу, ничего не блокирует.
function showBanner({ text, actionLabel, onAction, version, modal = false }) {
  const bar = document.createElement("div");
  bar.className = modal ? "update-modal" : "update-banner";

  const span = document.createElement(modal ? "p" : "span");
  span.textContent = text;

  const actions = document.createElement("div");
  actions.className = "update-banner-actions";

  const actionBtn = document.createElement("button");
  actionBtn.className = "btn accent";
  actionBtn.textContent = actionLabel;
  actionBtn.addEventListener("click", async () => {
    close();
    await onAction();
  });

  const laterBtn = document.createElement("button");
  laterBtn.className = "btn";
  laterBtn.textContent = i18n("Позже");
  laterBtn.addEventListener("click", async () => {
    close();
    shown = false;
    await apiPost("/api/app/update-dismiss", { version }).catch(() => {});
  });

  actions.append(actionBtn, laterBtn);
  bar.append(span, actions);

  const root = modal ? document.createElement("div") : bar;
  if (modal) {
    root.className = "update-modal-backdrop";
    root.appendChild(bar);
  }
  function close() {
    root.remove();
  }
  document.body.appendChild(root);
}

async function poll() {
  if (shown) return;
  let status;
  try {
    status = await apiGet("/api/app/update-status");
  } catch {
    return;
  }
  if (status.type === "ready") {
    shown = true;
    showBanner({
      text: i18n("Обновление готово: {version}", status),
      actionLabel: i18n("Обновить"),
      version: status.version,
      modal: true,
      onAction: () => apiPost("/api/app/update-restart", {}),
    });
  } else if (status.type === "available") {
    shown = true;
    showBanner({
      text: i18n("Доступно обновление: {version}", status),
      actionLabel: i18n("Скачать"),
      version: status.version,
      onAction: () => apiPost("/api/app/update-download", {}),
    });
  } else if (status.type === "error") {
    // Тихо: полоска — для позитивного сценария (обновление готово/
    // доступно), а не для тревоги на каждый обрыв сети. Явную причину
    // ошибки увидит тот, кто сам зайдёт в «Данные» и нажмёт «Проверить
    // обновления» — там уже показывается message из update-status.
  }
}

export function initUpdateBanner() {
  poll();
  setInterval(poll, POLL_MS);
}
