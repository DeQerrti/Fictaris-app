import { i18n } from "./i18n.js";

// ══════════════════════════════════════════════
//  БОКОВАЯ ПАНЕЛЬ
//
//  Данные мира, которые раньше жили в Настройках — словарь тегов,
//  шаблоны анкет, календарь, — открываются там, где ими пользуются:
//  панелью справа поверх раздела, сам раздел остаётся на месте. По
//  закрытию раздел перерисовывается (событие fictaris:reload-module,
//  main.js) — чтобы новые теги, поля или месяцы сразу были видны.
// ══════════════════════════════════════════════

let openEl = null;

export function closeSidePanel() {
  if (!openEl) return;
  const { el, onClose } = openEl;
  openEl = null;
  el.remove();
  document.removeEventListener("keydown", onKey, true);
  onClose?.();
}

function onKey(e) {
  // Сначала закрывается всплывающее окошко внутри панели, потом сама
  // панель; модалку карточки под ней Escape при этом не трогает.
  if (e.key === "Escape" && !document.querySelector(".context-menu")) {
    e.stopPropagation();
    closeSidePanel();
  }
}

// build(body) — содержимое (может быть async); reload — перерисовать
// раздел под панелью после закрытия; wide — шире (словарь тегов, поля
// анкеты: им тесно в 480px).
export async function openSidePanel({ title, subtitle, build, reload = true, wide = false }) {
  closeSidePanel();
  const backdrop = document.createElement("div");
  backdrop.className = "side-panel-backdrop";
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) closeSidePanel();
  });

  const panel = document.createElement("aside");
  panel.className = "side-panel" + (wide ? " wide" : "");
  panel.innerHTML = `<div class="side-panel-head"><div class="side-panel-titles"><div class="side-panel-title"></div><div class="side-panel-sub"></div></div><button class="side-panel-close">×</button></div><div class="side-panel-body"></div>`;
  panel.querySelector(".side-panel-title").textContent = title;
  panel.querySelector(".side-panel-sub").textContent = subtitle || "";
  const closeBtn = panel.querySelector(".side-panel-close");
  closeBtn.title = i18n("Закрыть");
  closeBtn.addEventListener("click", closeSidePanel);
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  openEl = {
    el: backdrop,
    onClose: reload ? () => document.dispatchEvent(new CustomEvent("fictaris:reload-module")) : null,
  };
  document.addEventListener("keydown", onKey, true);
  await build(panel.querySelector(".side-panel-body"));
}
