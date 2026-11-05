import { openSidePanel } from "./side-panel.js";
import { i18n } from "./i18n.js";

// Словарь тегов, шаблоны анкет и календарь — боковой панелью из тех
// мест, где ими пользуются. Импорт ленивый: редакторы сами импортируют
// tags.js и templates.js, откуда эти панели и зовут.

export function openTagsPanel() {
  return openSidePanel({
    title: i18n("Теги"),
    subtitle: i18n("Словарь тегов этого мира – общий для персонажей, мест и фракций"),
    wide: true,
    build: async (body) => (await import("./tags-manager.js")).renderTagsManager(body),
  });
}

export function openTemplatesPanel(kind) {
  return openSidePanel({
    title: i18n("Поля анкеты"),
    subtitle: i18n("Так анкета выглядит в досье – видно, что пустует"),
    wide: true,
    build: async (body) => (await import("./fields-editor.js")).renderFieldsEditor(body, kind),
  });
}

// tab — какую вкладку открыть сразу (months | week | holidays | today).
export function openCalendarPanel(tab) {
  return openSidePanel({
    title: i18n("Календарь мира"),
    subtitle: i18n("Месяцы, неделя, праздники – видно в режиме «Календарь» Таймлайна"),
    build: async (body) => (await import("./calendar-editor.js")).renderCalendarEditor(body, tab),
  });
}
