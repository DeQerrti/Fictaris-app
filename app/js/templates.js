import { apiGet, apiPost, uid } from "./api.js";
import { i18n } from "./i18n.js";

// ══════════════════════════════════════════════
//  ШАБЛОНЫ АНКЕТ
//
//  Поля анкеты персонажа/локации/фракции раньше были зашиты кодом —
//  теперь настраиваемый список полей на тип сущности (Настройки →
//  Шаблоны анкет): можно убрать блок, переименовать его, завести
//  новый, и всё это сохранить как отдельный шаблон — при создании новой
//  карточки предлагается выбрать, по какому из них её завести. Сама
//  сущность хранит значения по ключам полей (entity[key]) как обычно —
//  смена шаблона или его полей не трогает уже сохранённые данные,
//  только то, какие поля показывает форма.
// ══════════════════════════════════════════════

// Дефолтные поля — то же самое, что раньше было зашито в fields() трёх
// модулей: если пользователь ничего не настраивал, поведение то же.
export function defaultFieldsFor(kind) {
  if (kind === "characters") {
    return [
      { key: "role", label: i18n("Роль"), type: "input" },
      { key: "age", label: i18n("Возраст"), type: "input" },
      { key: "appearance", label: i18n("Внешность"), type: "textarea" },
      { key: "personality", label: i18n("Характер"), type: "textarea" },
      { key: "motivation", label: i18n("Мотивация"), type: "textarea" },
      { key: "goal", label: i18n("Цель"), type: "textarea" },
      { key: "flaws", label: i18n("Слабости"), type: "textarea" },
      { key: "backstory", label: i18n("Предыстория"), type: "textarea" },
    ];
  }
  if (kind === "locations") {
    return [
      { key: "description", label: i18n("Описание"), type: "textarea" },
      { key: "notes", label: i18n("Заметки"), type: "textarea" },
    ];
  }
  if (kind === "factions") {
    return [
      { key: "description", label: i18n("Описание / идеология"), type: "textarea" },
      { key: "notes", label: i18n("Заметки"), type: "textarea" },
    ];
  }
  return [];
}

export const KIND_LABELS = {
  characters: () => i18n("Персонажи"),
  locations: () => i18n("Локации"),
  factions: () => i18n("Фракции"),
};

function defaultTemplate(kind) {
  return { id: "default", name: i18n("По умолчанию"), fields: defaultFieldsFor(kind) };
}

export async function loadTemplates(kind) {
  const settings = await apiGet("/api/site-settings").catch(() => ({}));
  const list = settings.templates?.[kind];
  return Array.isArray(list) && list.length ? list : [defaultTemplate(kind)];
}

export async function saveTemplates(kind, list) {
  const settings = (await apiGet("/api/site-settings").catch(() => ({}))) || {};
  const templates = { ...settings.templates, [kind]: list };
  await apiPost("/api/site-settings", { ...settings, templates });
}

// Шаблон сущности мог быть удалён после того, как она была создана —
// тогда просто показываем первый доступный, ничего не теряя из данных
// (лишние поля entity[key] от старого шаблона остаются на диске, просто
// не отображаются, пока какой-то из шаблонов их снова не заведёт).
export function templateFor(list, templateId) {
  return list.find((t) => t.id === templateId) || list[0];
}

export function blankField() {
  return { key: `f_${uid()}`, label: i18n("Новое поле"), type: "textarea" };
}

// ══════════════════════════════════════════════
//  РАЗДЕЛЫ ВНУТРИ ПОЛЯ (тип "richtext")
//
//  Вместо полноценного WYSIWYG-редактора (риск разметки, которая потом
//  не проэкранируется как надо) — простой построчный синтаксис поверх
//  обычной textarea: строка "## Заголовок" начинает раздел, "###
//  Подзаголовок" — вложенный. Всё остальное — обычный текст абзаца.
//  Разбор идёт только на чтение (openEntitySheet, экспорт сайта) —
//  сама textarea в редакторе (characters.js/locations.js/factions.js)
//  правит эти строки как есть, ничего не подсвечивая.
// ══════════════════════════════════════════════

function sectionSlug(title, index) {
  const base = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `sec-${index}-${base || "s"}`;
}

// Возвращает [{ level: 0|2|3, title, text, id }] — level 0 это текст до
// первого заголовка (title пустой). Секции без заголовка и без текста
// не возвращаются.
export function parseRichSections(value) {
  const lines = String(value || "").split(/\r?\n/);
  const raw = [];
  let current = null;
  for (const line of lines) {
    const h2 = /^##\s+(.+)/.exec(line);
    const h3 = !h2 && /^###\s+(.+)/.exec(line);
    if (h2 || h3) {
      current = { level: h2 ? 2 : 3, title: (h2 || h3)[1].trim(), lines: [] };
      raw.push(current);
    } else if (current) {
      current.lines.push(line);
    } else {
      current = { level: 0, title: "", lines: [line] };
      raw.push(current);
    }
  }
  return raw
    .map((s, i) => ({ level: s.level, title: s.title, text: s.lines.join("\n").trim(), id: sectionSlug(s.title, i) }))
    .filter((s) => s.title || s.text);
}

// Есть ли смысл показывать оглавление — хотя бы один заголовок в тексте.
export function hasRichHeadings(value) {
  return parseRichSections(value).some((s) => s.level > 0);
}

// Подсказка под полем "richtext" в редакторе (drawer) — один и тот же
// текст в трёх модулях (characters/locations/factions), поэтому общей
// функцией, а не копией разметки в каждом.
export function buildFieldHint(type) {
  if (type !== "richtext") return null;
  const hint = document.createElement("div");
  hint.className = "field-hint";
  hint.textContent = i18n('Строка с "## " – новый раздел, с "### " – подраздел. Соберётся оглавление.');
  return hint;
}
