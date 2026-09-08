// ══════════════════════════════════════════════
//  НЕДАВНЕЕ — короткий MRU-список последних открытых разделов/карточек
//
//  Пишет main.js (openModule — единственная точка, через которую
//  проходит любое переключение раздела: клик в сайдбаре, командная
//  палитра, горячие клавиши, клик по @упоминанию), читает командная
//  палитра (search.js), чтобы показать список при пустом запросе —
//  как "недавние файлы" в палитре VS Code/Obsidian, только по разделам
//  Fictaris. localStorage, а не site-settings.json: это след действий
//  конкретного человека за этим экраном, а не часть проекта, которую
//  стоит синхронизировать между устройствами.
// ══════════════════════════════════════════════

const KEY = "fictaris_recent_nav";
const MAX = 8;

export function readRecent() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

// id может быть null — у разделов без карточек по отдельности (Доска,
// Связи, Карта сюжета, Знания) это просто "недавно заходил в раздел
// целиком", как и в их собственной записи в индексе поиска.
export function recordRecent(module, id) {
  if (!module) return;
  let list = readRecent().filter((e) => !(e.module === module && e.id === (id ?? null)));
  list.unshift({ module, id: id ?? null });
  list = list.slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* приватный режим/квота — недавнее просто не запомнится, не критично */
  }
}
