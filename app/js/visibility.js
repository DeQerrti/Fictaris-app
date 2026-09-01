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
//  Порядок по умолчанию сразу кластеризован по смысловым группам
//  (Сюжет/Мир/Инструменты/Обзор, см. ниже): раньше «Доска» стояла в
//  списке последней, отдельно от «Рукописи» (тоже «Сюжет»), из-за чего
//  подпись «Сюжет» рисовалась дважды — до Рукописи и снова перед
//  Доской. Порядок ниже — только резерв на случай, если пользователь
//  ещё не перетаскивал вкладки (getTabOrder); сохранённый порядок
//  (tabOrder в site-settings.json) как всегда имеет приоритет.
export const HIDEABLE_TABS = [
  "manuscript",
  "board",
  "characters",
  "locations",
  "factions",
  "relationships",
  "timeline",
  "map",
  "graph",
  "familytree",
  "canvas",
  "stats",
];

// Смысловые группы для подписей в сайдбаре (applyTabOrder ниже) и для
// того же деления в «Подписи интерфейса» (settings-panel.js) — черновик
// и доска про сам текст, персонажи/локации/фракции/связи/таймлайн про
// сам мир, карта/граф/родословная/холст — визуальные инструменты по
// миру, статистика — отдельно, обзорная. Группа — не просто ярлык:
// у неё стабильный id (id группы неизменен даже после переименования —
// иначе переименование потеряло бы связь с уже расставленными пунктами)
// и её можно переименовать или удалить целиком в Настройках
// (getGroupsConfig/setGroupLabel/deleteGroup ниже), а отдельный пункт —
// перетащить в другую группу (getTabGroupMap/setTabGroup).
export const DEFAULT_GROUPS = [
  { id: "plot", label: () => i18n("Сюжет") },
  { id: "world", label: () => i18n("Мир") },
  { id: "tools", label: () => i18n("Инструменты") },
  { id: "overview", label: () => i18n("Обзор") },
];

const DEFAULT_TAB_GROUP = {
  manuscript: "plot",
  board: "plot",
  characters: "world",
  locations: "world",
  factions: "world",
  relationships: "world",
  timeline: "world",
  map: "tools",
  graph: "tools",
  familytree: "tools",
  canvas: "tools",
  stats: "overview",
};

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

// ── Порядок вкладок ────────────────────────────
// Своя настройка, отдельная от видимости — можно перетащить пункт
// повыше в сайдбаре, не пряча остальные. Список хранит только
// HIDEABLE_TABS (те же, что можно скрыть) — «Настройки»/«Проверка»/
// «Корзина» стоят фиксированно, их порядок не трогаем.
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

// ── Группы (подписи в сайдбаре) ─────────────────
// order — порядок групп, которые ещё существуют (удалённые убраны);
// labels — id группы → подпись (своя, если переименовали, иначе
// дефолтная из DEFAULT_GROUPS). Пользователь не заводит новые группы
// с нуля — только переименовывает/удаляет уже готовые четыре, этого
// достаточно для просьбы «переименовывать разделы и удалять».
export async function getGroupsConfig() {
  const settings = await apiGet("/api/site-settings").catch(() => ({}));
  const g = settings.groups || {};
  const deleted = new Set(Array.isArray(g.deleted) ? g.deleted : []);
  const knownIds = DEFAULT_GROUPS.map((x) => x.id);
  const orderRaw = Array.isArray(g.order) ? g.order.filter((id) => knownIds.includes(id)) : [];
  const order = orderRaw.filter((id) => !deleted.has(id));
  for (const id of knownIds) {
    if (!deleted.has(id) && !order.includes(id)) order.push(id);
  }
  const labels = {};
  for (const def of DEFAULT_GROUPS) {
    const custom = g.labels?.[def.id];
    labels[def.id] = typeof custom === "string" && custom.trim() ? custom.trim() : def.label();
  }
  return { order, labels, deleted };
}

export async function setGroupOrder(order) {
  const settings = (await apiGet("/api/site-settings").catch(() => ({}))) || {};
  const knownIds = DEFAULT_GROUPS.map((x) => x.id);
  const groups = { ...settings.groups, order: order.filter((id) => knownIds.includes(id)) };
  await apiPost("/api/site-settings", { ...settings, groups });
  await applyTabOrder();
}

export async function setGroupLabel(id, label) {
  const settings = (await apiGet("/api/site-settings").catch(() => ({}))) || {};
  const labels = { ...settings.groups?.labels, [id]: label };
  const groups = { ...settings.groups, labels };
  await apiPost("/api/site-settings", { ...settings, groups });
  await applyTabOrder();
}

// Удаление — не «стереть насовсем всё про группу», а спрятать саму
// подпись: пункты, которые в неё входили, просто перестают показывать
// заголовок над собой (getTabGroupMap ниже отфильтровывает удалённые id),
// сами разделы никуда не деваются.
export async function deleteGroup(id) {
  const settings = (await apiGet("/api/site-settings").catch(() => ({}))) || {};
  const deleted = new Set(settings.groups?.deleted || []);
  deleted.add(id);
  const order = (settings.groups?.order || DEFAULT_GROUPS.map((x) => x.id)).filter((x) => x !== id);
  const groups = { ...settings.groups, deleted: [...deleted], order };
  await apiPost("/api/site-settings", { ...settings, groups });
  await applyTabOrder();
}

// key → id группы (своя, если пункт перетащили в другую в Настройках,
// иначе дефолтная), либо null — без группы, без заголовка над собой.
// Группа, которую удалили (deleteGroup), для всех её пунктов тоже даёт
// null, даже если ни у одного из них нет явного override.
export async function getTabGroupMap() {
  const [settings, { order }] = await Promise.all([
    apiGet("/api/site-settings").catch(() => ({})),
    getGroupsConfig(),
  ]);
  const overrides = settings.tabGroups || {};
  const map = {};
  for (const key of HIDEABLE_TABS) {
    const raw = key in overrides ? overrides[key] || null : DEFAULT_TAB_GROUP[key] || null;
    map[key] = raw && order.includes(raw) ? raw : null;
  }
  return map;
}

export async function setTabGroup(key, groupId) {
  if (!HIDEABLE_TABS.includes(key)) return;
  const settings = (await apiGet("/api/site-settings").catch(() => ({}))) || {};
  const tabGroups = { ...settings.tabGroups, [key]: groupId || null };
  await apiPost("/api/site-settings", { ...settings, tabGroups });
  await applyTabOrder();
}

// Переставляет сами кнопки в DOM — insertBefore(btn, spacer) в нужном
// порядке: повторное вставление перед одной и той же точкой (граница
// перед «Проверкой»/«Корзиной») сдвигает уже переставленные элементы
// правильно одно за другим, без прыжков в конец всего сайдбара (как
// было бы с обычным appendChild). Подписи групп — не часть order
// (только пункты сайдбара) и перестраиваются с нуля при каждом вызове.
export async function applyTabOrder() {
  const [order, { labels }, tabGroup] = await Promise.all([getTabOrder(), getGroupsConfig(), getTabGroupMap()]);
  const spacer = document.querySelector(".sidebar-spacer");
  if (!spacer?.parentNode) return order;
  const parent = spacer.parentNode;
  parent.querySelectorAll(".nav-group-label").forEach((el) => el.remove());
  let lastGroup = undefined;
  for (const key of order) {
    const btn = parent.querySelector(`.nav-item[data-module="${key}"]`);
    if (!btn) continue;
    const groupId = tabGroup[key] || null;
    if (groupId !== lastGroup) {
      if (groupId) {
        const label = document.createElement("div");
        label.className = "nav-group-label";
        label.textContent = labels[groupId] || "";
        parent.insertBefore(label, spacer);
      }
      lastGroup = groupId;
    }
    parent.insertBefore(btn, spacer);
  }
  return order;
}
