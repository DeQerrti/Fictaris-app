import { apiGet, apiPost } from "./api.js";

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
export const HIDEABLE_TABS = [
  "manuscript",
  "characters",
  "locations",
  "relationships",
  "factions",
  "timeline",
  "board",
  "map",
  "graph",
  "familytree",
  "stats",
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
export async function applyTabVisibility() {
  const hidden = new Set(await getHiddenTabs());
  document.querySelectorAll(".nav-item[data-module]").forEach((btn) => {
    btn.classList.toggle("nav-item-hidden", hidden.has(btn.dataset.module));
  });
  return hidden;
}
