// Переиспользуемые кусочки для работы со списком персонажей —
// {id, name, color} — по паттерну из брифа (технические детали, п.4):
// та же форма объекта пригодится для локаций/фракций в будущем без
// переписывания компонента.

import { i18n } from "./i18n.js";

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export function characterSelect(list, selectedId, placeholder) {
  const select = document.createElement("select");
  if (placeholder) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = placeholder;
    select.appendChild(opt);
  }
  for (const c of list) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name || i18n("Без имени");
    if (c.id === selectedId) opt.selected = true;
    select.appendChild(opt);
  }
  return select;
}

// Группа переключаемых чипов для мультиселекта — {id, name, color?}
// (персонажи, локации, будущие нити сюжета). Общая с фильтром
// таймлайна, поэтому те же CSS-классы (.filter-chip/.filter-count).
export function buildToggleGroup(label, items, selectedIds, onChange, colorOf = (c) => c.color || "#7c7157") {
  const field = document.createElement("div");
  field.className = "field";
  const lab = document.createElement("label");
  lab.textContent = label;
  field.appendChild(lab);

  const row = document.createElement("div");
  row.className = "timeline-filter-bar";
  row.style.marginBottom = "0";
  for (const it of items) {
    const chip = document.createElement("button");
    const active = selectedIds.includes(it.id);
    chip.className = "filter-chip" + (active ? " active" : "");
    chip.style.setProperty("--chip-color", colorOf(it));
    chip.textContent = it.name;
    chip.addEventListener("click", () => {
      const next = active ? selectedIds.filter((id) => id !== it.id) : [...selectedIds, it.id];
      onChange(next);
    });
    row.appendChild(chip);
  }
  if (!items.length) {
    const none = document.createElement("span");
    none.className = "filter-count";
    none.textContent = i18n("пока нет");
    row.appendChild(none);
  }
  field.appendChild(row);
  return field;
}
