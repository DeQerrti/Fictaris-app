import { apiGet } from "./api.js";
import { i18n } from "./i18n.js";

// ══════════════════════════════════════════════
//  ТЕГИ
//
//  По духу TasteID (app/js/config.js — TAGS_MAP): не свободный текст, а
//  курируемый словарь с категориями и подсказками — плюс свои теги
//  сверху, для того, чего в словаре нет. Словарь здесь свой,
//  фэнтези/ворлдбилдинговый, а не про кино и аниме — но механизм
//  переносится один в один: customTags добавляет записи, hiddenTags
//  прячет встроенные (оба живут в site-settings.json и правятся из
//  раздела «Данные», как и остальные настройки оформления).
//
//  Формат на диске не меняется: c.tags/l.tags/f.tags остаются той же
//  строкой через запятую, что были раньше, — только UI теперь чипы, а
//  не голое текстовое поле, чтобы старые данные и импорт/экспорт не
//  сломались.
// ══════════════════════════════════════════════

export const CATEGORY_LABELS = {
  archetype: "Архетип",
  role: "Роль в сюжете",
  status: "Статус",
  trope: "Троп",
};

export const DEFAULT_TAGS_MAP = {
  // ── Архетип ──────────────────────────────────
  "Герой": { cat: "archetype", tip: "Центральная фигура, ведёт историю вперёд" },
  "Наставник": { cat: "archetype", tip: "Направляет и обучает героя" },
  "Трикстер": { cat: "archetype", tip: "Хаотичный, ломает правила ради своих целей" },
  "Страж порога": { cat: "archetype", tip: "Первое препятствие на пути героя" },
  "Тень": { cat: "archetype", tip: "Воплощение того, чего герой боится в себе" },
  "Союзник": { cat: "archetype", tip: "Поддерживает героя в пути" },
  "Оборотень (сюжетный)": { cat: "archetype", tip: "Меняет сторону, скрывает истинные мотивы" },

  // ── Роль в сюжете ─────────────────────────────
  "Протагонист": { cat: "role", tip: "Главный герой истории" },
  "Антагонист": { cat: "role", tip: "Главный противник героя" },
  "Второстепенный": { cat: "role", tip: "Важен для сюжета, но не в центре" },
  "Массовка": { cat: "role", tip: "Заполняет мир, не влияет на сюжет напрямую" },
  "Рассказчик": { cat: "role", tip: "Ведёт повествование от своего лица" },

  // ── Статус ────────────────────────────────────
  "Жив": { cat: "status", tip: "" },
  "Погиб": { cat: "status", tip: "" },
  "Пропал без вести": { cat: "status", tip: "" },
  "Статус неизвестен": { cat: "status", tip: "" },
  "Заброшено": { cat: "status", tip: "Про локацию или фракцию — больше не действует" },

  // ── Троп / атмосфера ──────────────────────────
  "Проклятие": { cat: "trope", tip: "" },
  "Пророчество": { cat: "trope", tip: "" },
  "Тайная личность": { cat: "trope", tip: "" },
  "Искупление": { cat: "trope", tip: "" },
  "Предательство": { cat: "trope", tip: "" },
  "Запретная любовь": { cat: "trope", tip: "" },
  "Месть": { cat: "trope", tip: "" },
  "Наследие": { cat: "trope", tip: "Груз прошлого — рода, титула, преступления предков" },
  "Двойная жизнь": { cat: "trope", tip: "" },
  "Договор с силой": { cat: "trope", tip: "Сделка с богом, демоном или магией — не без цены" },
};

export async function loadTagsMap() {
  const settings = await apiGet("/api/site-settings").catch(() => ({}));
  const map = { ...DEFAULT_TAGS_MAP, ...(settings.customTags || {}) };
  for (const name of settings.hiddenTags || []) delete map[name];
  return map;
}

export function parseTags(str) {
  return (str || "").split(",").map((t) => t.trim()).filter(Boolean);
}

function stringifyTags(list) {
  return list.join(", ");
}

// tagsMap — результат loadTagsMap(). value — текущее значение поля tags
// сущности (строка через запятую). onChange(newValue) вызывается на
// каждое изменение, как и у обычного текстового поля рядом.
export function buildTagsField(tagsMap, value, onChange) {
  const field = document.createElement("div");
  field.className = "field tags-field";
  const label = document.createElement("label");
  label.textContent = i18n("Теги");
  field.appendChild(label);

  let current = new Set(parseTags(value));
  const byCategory = {};
  for (const [name, info] of Object.entries(tagsMap)) {
    (byCategory[info.cat] ||= []).push(name);
  }

  const chips = document.createElement("div");
  chips.className = "tags-chip-list";

  function buildGroup(title, names) {
    const group = document.createElement("div");
    group.className = "tags-group";
    const catLabel = document.createElement("span");
    catLabel.className = "tags-group-label";
    catLabel.textContent = title;
    group.appendChild(catLabel);
    for (const name of names) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "tag-chip" + (current.has(name) ? " active" : "");
      chip.textContent = i18n(name);
      if (tagsMap[name]?.tip) chip.title = i18n(tagsMap[name].tip);
      chip.addEventListener("click", () => {
        if (current.has(name)) current.delete(name);
        else current.add(name);
        onChange(stringifyTags([...current]));
        render();
      });
      group.appendChild(chip);
    }
    return group;
  }

  function render() {
    chips.innerHTML = "";
    for (const [cat, names] of Object.entries(byCategory)) {
      chips.appendChild(buildGroup(i18n(CATEGORY_LABELS[cat] || cat), names));
    }
    // Свои теги — те, что выбраны, но не входят в известный словарь.
    const customNow = [...current].filter((t) => !tagsMap[t]);
    if (customNow.length) chips.appendChild(buildGroup(i18n("Свои"), customNow));
  }
  render();

  const addRow = document.createElement("div");
  addRow.className = "tags-add-row";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = i18n("Свой тег — Enter, чтобы добавить");
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const name = input.value.trim();
    if (!name || current.has(name)) return;
    current.add(name);
    input.value = "";
    onChange(stringifyTags([...current]));
    render();
  });
  addRow.appendChild(input);

  field.append(chips, addRow);
  return field;
}
