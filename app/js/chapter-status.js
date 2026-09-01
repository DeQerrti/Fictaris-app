import { apiGet, apiPost } from "./api.js";

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
