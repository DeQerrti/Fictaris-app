import { apiGet, apiPost } from "./api.js";
import { iconSvg } from "./icons.js";
import { i18n } from "./i18n.js";

// ══════════════════════════════════════════════
//  СТАТУСЫ ГЛАВ И ПАПОК
//
//  Раньше три статуса (Черновик/На редактуре/Готово) были зашиты в
//  manuscript.js как константа — теперь настраиваемый список в
//  site-settings.json: переименовать любой, задать любой цвет или
//  вместо цвета — смайлик, добавить свой, удалить (с подтверждением,
//  как теги — tags.js). Один и тот же список используют главы и папки
//  рукописи (manuscript.js) — папке нужен статус ровно того же смысла
//  («Книга 1 — Черновик»), заводить для неё отдельный список было бы
//  лишней сущностью.
// ══════════════════════════════════════════════

export const DEFAULT_STATUSES = [
  { key: "draft", label: "Черновик", color: "#7c7157", emoji: "" },
  { key: "editing", label: "На редактуре", color: "#c9944a", emoji: "" },
  { key: "done", label: "Готово", color: "#5a8a5f", emoji: "" },
];

export async function loadStatuses() {
  const settings = await apiGet("/api/site-settings").catch(() => ({}));
  const custom = Array.isArray(settings.chapterStatuses) ? settings.chapterStatuses : null;
  return custom && custom.length ? custom : DEFAULT_STATUSES;
}

export async function saveStatuses(list) {
  const settings = (await apiGet("/api/site-settings").catch(() => ({}))) || {};
  await apiPost("/api/site-settings", { ...settings, chapterStatuses: list });
}

export function statusByKey(list, key) {
  return list.find((s) => s.key === key) || list[0];
}

// Один и тот же кружок/смайлик — в списке глав (manuscript.js), в
// заголовке папки и в настройках (settings-panel.js).
export function buildStatusDot(status) {
  const el = document.createElement("span");
  if (status?.emoji) {
    el.className = "status-emoji";
    el.textContent = status.emoji;
  } else {
    el.className = "status-dot";
    el.style.background = status?.color || "#7c7157";
  }
  if (status?.label) el.title = status.label;
  return el;
}

// ── Список статусов с редактированием на месте ────────────────────
// Один рисователь строки (кружок/цвет, имя, смайлик, удалить) — общий
// для Настроек (settings-panel.js, buildStatusesSection) и всплывающей
// панели "Статус → Управлять статусами…" по ПКМ на главе (manuscript.js,
// openStatusManagePopover): раньше в самом ПКМ статус можно было только
// выбрать из уже существующих, переименовать или завести новый — только
// сходив в Настройки отдельно. onSaved(next), если передан, вызывается
// после каждого сохранения (не только добавления/удаления, но и правки
// имени/цвета/смайлика) — сторона вызова обновляет свою локальную копию
// списка, чтобы точки статусов в списке глав обновились сразу же, не
// дожидаясь закрытия попапа.
export function renderStatusesList(list, statuses, onSaved) {
  list.innerHTML = "";
  for (const status of statuses) {
    const row = document.createElement("div");
    row.className = "tags-manage-row";

    row.appendChild(buildStatusDot(status));

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "tags-manage-rename-input";
    nameInput.value = status.label;
    let nameTimer;
    nameInput.addEventListener("input", () => {
      clearTimeout(nameTimer);
      nameTimer = setTimeout(async () => {
        status.label = nameInput.value.trim() || status.label;
        const current = await loadStatuses();
        const next = current.map((s) => (s.key === status.key ? status : s));
        await saveStatuses(next);
        onSaved?.(next);
      }, 500);
    });
    row.appendChild(nameInput);

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = /^#[0-9a-f]{6}$/i.test(status.color || "") ? status.color : "#7c7157";
    colorInput.title = i18n("Цвет (используется, если не задан смайлик)");
    colorInput.addEventListener("input", async () => {
      status.color = colorInput.value;
      const current = await loadStatuses();
      const next = current.map((s) => (s.key === status.key ? status : s));
      await saveStatuses(next);
      onSaved?.(next);
    });
    row.appendChild(colorInput);

    const emojiInput = document.createElement("input");
    emojiInput.type = "text";
    emojiInput.className = "status-emoji-input";
    // Нейтральный пример вместо смайлика-лица — кружок ближе по духу к
    // обычной цветной точке статуса, которую смайлик как раз заменяет,
    // не намекает на конкретное настроение/значение.
    emojiInput.placeholder = "⚪";
    emojiInput.maxLength = 4;
    emojiInput.value = status.emoji || "";
    emojiInput.title = i18n("Смайлик вместо цветного кружка (необязательно)");
    let emojiTimer;
    emojiInput.addEventListener("input", () => {
      clearTimeout(emojiTimer);
      emojiTimer = setTimeout(async () => {
        status.emoji = emojiInput.value.trim();
        const current = await loadStatuses();
        const next = current.map((s) => (s.key === status.key ? status : s));
        await saveStatuses(next);
        row.replaceChild(buildStatusDot(status), row.firstChild);
        onSaved?.(next);
      }, 400);
    });
    row.appendChild(emojiInput);

    const delBtn = document.createElement("button");
    delBtn.className = "btn danger shortcut-clear";
    delBtn.innerHTML = iconSvg("trash", 14);
    delBtn.title = i18n("Удалить статус навсегда");
    delBtn.addEventListener("click", async () => {
      if (statuses.length <= 1) return;
      if (delBtn.dataset.confirm === "1") {
        const current = await loadStatuses();
        const next = current.filter((s) => s.key !== status.key);
        await saveStatuses(next);
        renderStatusesList(list, next, onSaved);
        onSaved?.(next);
        return;
      }
      delBtn.dataset.confirm = "1";
      delBtn.textContent = i18n("Точно?");
      setTimeout(() => {
        delBtn.dataset.confirm = "";
        delBtn.innerHTML = iconSvg("trash", 14);
      }, 3000);
    });
    row.appendChild(delBtn);

    list.appendChild(row);
  }
}

// Компактная панель "список + добавить" без кнопки сброса к трём
// стандартным (та осталась только в Настройках — на месте, по ПКМ,
// это скорее опасное лишнее действие, чем частая надобность). Сама
// панель без позиционирования и без обвязки открытия/закрытия — этим
// занимается вызывающая сторона (manuscript.js, openStatusManagePopover).
export function buildStatusManagePanel(statuses, onSaved) {
  const wrap = document.createElement("div");
  wrap.className = "status-manage-panel";

  const list = document.createElement("div");
  list.className = "tags-manage-list";
  renderStatusesList(list, statuses, onSaved);
  wrap.appendChild(list);

  const addBtn = document.createElement("button");
  addBtn.className = "btn";
  addBtn.textContent = i18n("Добавить статус");
  addBtn.addEventListener("click", async () => {
    const current = await loadStatuses();
    const next = [...current, { key: `status-${Date.now()}`, label: i18n("Новый статус"), color: "#7c7157", emoji: "" }];
    await saveStatuses(next);
    renderStatusesList(list, next, onSaved);
    onSaved?.(next);
  });
  wrap.appendChild(addBtn);

  return wrap;
}
