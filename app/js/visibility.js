import { apiGet, apiPost } from "./api.js";
import { i18n } from "./i18n.js";

// ══════════════════════════════════════════════
//  ВИДИМОСТЬ РАЗДЕЛОВ
//
//  Список пунктов сайдбара, которые вообще можно скрыть — «Настройки»
//  сюда намеренно не входит, иначе можно спрятать единственный способ
//  снова всё показать. «Проверка» и «Корзина» тоже намеренно не входят:
//  первая — единственный способ проверить целостность мира, вторая —
//  единственный путь вернуть удалённое, прятать их так же рискованно,
//  как и «Настройки». Сам список ключей держим тут же, а не берём из
//  defaultLabels().nav (labels.js) — тот описывает подписи, а не то,
//  что можно прятать, и не должен ничего знать о видимости.
//
//  Разделы стоят в сайдбаре тремя секциями по смыслу (разметка в
//  index.html): «Сюжет» — Рукопись и Доска, «Мир» — плитки персонажей,
//  мест, фракций и таймлайна, «Наглядно» — карта, родословная,
//  отношения, холст. Свои группы и перенос раздела в другую секцию
//  убраны вместе со старым списком: у плиток и строки «Наглядно» своя
//  вёрстка. Остались скрытие, подписи и порядок внутри секции.
export const HIDEABLE_TABS = [
  "manuscript",
  "board",
  "characters",
  "locations",
  "factions",
  "timeline",
  "map",
  "familytree",
  "graph",
  "canvas",
];

export const TAB_SECTIONS = [
  { id: "plot", label: () => i18n("Сюжет"), keys: ["manuscript", "board"] },
  { id: "world", label: () => i18n("Мир"), keys: ["characters", "locations", "factions", "timeline"] },
  { id: "views", label: () => i18n("Наглядно"), keys: ["map", "familytree", "graph", "canvas"] },
];

export async function getHiddenTabs() {
  const settings = await apiGet("/api/site-settings").catch(() => ({}));
  const hidden = Array.isArray(settings.hiddenTabs) ? settings.hiddenTabs : [];
  return hidden.filter((key) => HIDEABLE_TABS.includes(key));
}

export async function setTabHidden(key, hidden) {
  if (!HIDEABLE_TABS.includes(key)) return getHiddenTabs();
  const settings = (await apiGet("/api/site-settings").catch(() => ({}))) || {};
  const current = new Set(Array.isArray(settings.hiddenTabs) ? settings.hiddenTabs : []);
  if (hidden) current.add(key);
  else current.delete(key);
  const hiddenTabs = [...current];
  await apiPost("/api/site-settings", { ...settings, hiddenTabs });
  await applyTabVisibility();
  return hiddenTabs;
}

// Прячем сами кнопки в сайдбаре — модуль остаётся доступным напрямую
// (поиск, @упоминания, горячие клавиши), просто не занимает место в
// списке для тех, кому конкретный раздел не нужен по теме проекта.
// Секция, в которой не осталось ни одного раздела, прячется вместе с
// заголовком.
export async function applyTabVisibility() {
  const hidden = new Set(await getHiddenTabs());
  document.querySelectorAll(".nav-item[data-module]").forEach((btn) => {
    btn.classList.toggle("nav-item-hidden", hidden.has(btn.dataset.module));
  });
  for (const section of TAB_SECTIONS) {
    const empty = section.keys.every((k) => hidden.has(k));
    document.querySelectorAll(`[data-section="${section.id}"]`).forEach((el) => { el.hidden = empty; });
  }
  return hidden;
}

// ── Порядок вкладок ────────────────────────────
// Своя настройка, отдельная от видимости — можно перетащить пункт
// повыше внутри его секции, не пряча остальные. tabOrder хранит общий
// список (как и раньше); в сайдбаре он раскладывается по секциям.
export async function getTabOrder() {
  const settings = await apiGet("/api/site-settings").catch(() => ({}));
  const saved = Array.isArray(settings.tabOrder) ? settings.tabOrder.filter((k) => HIDEABLE_TABS.includes(k)) : [];
  const rest = HIDEABLE_TABS.filter((k) => !saved.includes(k));
  return [...saved, ...rest];
}

export async function setTabOrder(order) {
  const settings = (await apiGet("/api/site-settings").catch(() => ({}))) || {};
  const tabOrder = order.filter((k) => HIDEABLE_TABS.includes(k));
  await apiPost("/api/site-settings", { ...settings, tabOrder });
  await applyTabOrder();
  return tabOrder;
}

// Переставляет кнопки внутри их секции. Книги стоят сразу под
// «Рукописью» (sidebar-overview.js) и ездят вместе с ней.
export async function applyTabOrder() {
  const order = await getTabOrder();
  for (const section of TAB_SECTIONS) {
    const box = document.querySelector(`.sb-section[data-section="${section.id}"]`);
    if (!box) continue;
    const keys = order.filter((k) => section.keys.includes(k));
    for (const key of keys) {
      const btn = box.querySelector(`.nav-item[data-module="${key}"]`);
      if (!btn) continue;
      box.appendChild(btn);
      if (key === "manuscript") {
        const books = document.getElementById("sbBooks");
        if (books) box.appendChild(books);
      }
    }
  }
  return order;
}
