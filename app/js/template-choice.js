import { openContextMenu } from "./context-menu.js";
import { i18n } from "./i18n.js";

// ══════════════════════════════════════════════
//  ВЫБОР ШАБЛОНА АНКЕТЫ ПРИ СОЗДАНИИ
//
//  Если для этого типа сущности настроен только один (дефолтный)
//  шаблон — сразу отдаём его id, никакого меню пользователь не видит
//  (текущее поведение "один клик — карточка создана" не меняется).
//  Если шаблонов несколько — показываем список через тот же
//  context-menu.js, что и остальные всплывающие меню в приложении.
//
//  opts.onCreateNew — пункт "+ Новый шаблон…" в конце списка (см.
//  template-editor-modal.js): даёт завести шаблон на лету, не уходя в
//  Настройки. opts.forceMenu — показать меню, даже если шаблон всего
//  один: обычный клик по "+Добавить" остаётся одношаговым, а вот
//  правая кнопка (contextmenu) на той же кнопке форсирует меню именно
//  затем, чтобы "+ Новый шаблон…" был достижим и когда шаблон пока один.
// ══════════════════════════════════════════════

export function chooseTemplate(templates, anchorEl, onChosen, opts = {}) {
  if (templates.length <= 1 && !opts.forceMenu) {
    onChosen(templates[0]?.id || "default");
    return;
  }
  const rect = anchorEl.getBoundingClientRect();
  const items = templates.map((t) => ({
    label: t.name,
    action: () => onChosen(t.id),
  }));
  if (opts.onCreateNew) {
    items.push({ label: i18n("+ Новый шаблон…"), action: opts.onCreateNew });
  }
  openContextMenu(rect.left, rect.bottom + 4, items);
}
