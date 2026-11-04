import { openSidePanel } from "./side-panel.js";
import { i18n } from "./i18n.js";

// Словарь тегов, шаблоны анкет и календарь — боковой панелью из тех
// мест, где ими пользуются. Редакторы пока живут в settings-panel.js;
// импорт ленивый — тот сам импортирует tags.js, откуда зовут эту панель.

async function fill(body, nodes) {
  for (const el of Array.isArray(nodes) ? nodes : [nodes]) body.appendChild(el);
}

export function openTagsPanel() {
  return openSidePanel({
    title: i18n("Теги"),
    subtitle: i18n("Словарь тегов этого мира – общий для персонажей, мест и фракций"),
    build: async (body) => fill(body, await (await import("./settings-panel.js")).buildTagsSection()),
  });
}

export function openTemplatesPanel(kind) {
  return openSidePanel({
    title: i18n("Поля анкеты"),
    subtitle: i18n("Шаблоны анкет: какие поля есть у карточки"),
    build: async (body) => fill(body, await (await import("./settings-panel.js")).buildTemplatesSection(kind)),
  });
}

export function openCalendarPanel() {
  return openSidePanel({
    title: i18n("Календарь мира"),
    subtitle: i18n("Свои месяцы и длина года для таймлайна"),
    build: async (body) => fill(body, await (await import("./settings-panel.js")).buildCalendarSection()),
  });
}
