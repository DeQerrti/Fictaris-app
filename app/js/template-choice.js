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
// ══════════════════════════════════════════════

export function chooseTemplate(templates, anchorEl, onChosen) {
  if (templates.length <= 1) {
    onChosen(templates[0]?.id || "default");
    return;
  }
  const rect = anchorEl.getBoundingClientRect();
  openContextMenu(
    rect.left,
    rect.bottom + 4,
    templates.map((t) => ({
      label: t.name,
      action: () => onChosen(t.id),
    }))
  );
}
