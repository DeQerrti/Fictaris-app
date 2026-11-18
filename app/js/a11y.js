// ══════════════════════════════════════════════
//  КЛАВИАТУРА И ЭКРАННЫЕ ДИКТОРЫ
//
//  Многие кликабельные элементы — <div> (главы в списке, карточки доски,
//  таймлайна и «Обзора», люди в Родословной): мышью работают, с
//  клавиатуры до них было не добраться. Здесь, в одном месте, а не в
//  каждом разделе: такие элементы получают tabindex и role="button",
//  Enter/пробел нажимает их, Shift+F10 или клавиша «меню» открывает их
//  контекстное меню (там же, например, «Переместить в колонку»).
// ══════════════════════════════════════════════

const CLICKABLE = [".chapter-item", ".chapter-folder", ".ms-card", ".board-card", ".chronicle-card", ".ftree-person"].join(", ");

function enhance(root) {
  if (!(root instanceof Element)) return;
  const nodes = root.matches?.(CLICKABLE) ? [root] : [];
  nodes.push(...root.querySelectorAll(CLICKABLE));
  for (const el of nodes) {
    if (el.tagName === "BUTTON" || el.tagName === "A") continue;
    if (!el.hasAttribute("tabindex")) el.tabIndex = 0;
    if (!el.hasAttribute("role")) el.setAttribute("role", "button");
    if (!el.hasAttribute("aria-label")) {
      const name = el.querySelector(".chapter-item-title, .chapter-folder-name, .ms-card-title, .board-card-title, .timeline-title, .ftree-person-name")?.textContent || el.title?.split("\n")[0];
      if (name) el.setAttribute("aria-label", name.trim());
    }
    if (el.classList.contains("active")) el.setAttribute("aria-current", "true");
  }
  // Заголовок раздела, уведомления, поиск — роли для экранного диктора.
  for (const h of root.querySelectorAll?.(".timeline-heading:not([role])") || []) {
    h.setAttribute("role", "heading");
    h.setAttribute("aria-level", "1");
  }
  const banners = root.matches?.(".update-banner, .update-modal") ? [root] : [...(root.querySelectorAll?.(".update-banner, .update-modal") || [])];
  for (const b of banners) if (!b.hasAttribute("role")) b.setAttribute("role", b.classList.contains("file-broken-banner") ? "alert" : "status");
  for (const s of root.querySelectorAll?.(".search-input:not([aria-label])") || []) s.setAttribute("aria-label", s.placeholder || "Search");
  for (const s of root.querySelectorAll?.(".search-results:not([aria-live])") || []) s.setAttribute("aria-live", "polite");
  for (const g of root.matches?.(".segmented") ? [root] : root.querySelectorAll?.(".segmented") || []) syncSegmented(g);
}

// Переключатель режимов (.segmented) — какая кнопка нажата, а не только
// подсветка цветом. Только у групп, где вообще есть выбранная кнопка:
// у панели форматирования это просто действия.
function syncSegmented(group) {
  const btns = [...group.querySelectorAll(":scope > .segmented-btn")];
  if (!btns.some((b) => b.classList.contains("active"))) return;
  for (const b of btns) b.setAttribute("aria-pressed", b.classList.contains("active") ? "true" : "false");
}

function syncState(el) {
  if (el.classList.contains("nav-item")) {
    if (el.classList.contains("active")) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  } else if (el.classList.contains("segmented-btn") && el.parentElement?.classList.contains("segmented")) {
    syncSegmented(el.parentElement);
  } else if (el.matches(CLICKABLE)) {
    if (el.classList.contains("active")) el.setAttribute("aria-current", "true");
    else el.removeAttribute("aria-current");
  }
}

// Боковая панель, уехавшая за край (узкое окно, «прятать»), не должна
// ловить Tab: фокус уходил в невидимые кнопки.
function syncSidebar() {
  const app = document.getElementById("app");
  const sidebar = document.querySelector(".sidebar");
  if (!app || !sidebar) return;
  const r = sidebar.getBoundingClientRect();
  const hidden = getComputedStyle(sidebar).display === "none" || r.right <= 1 || r.left >= window.innerWidth;
  if (sidebar.inert !== hidden) sidebar.inert = hidden;
  document.getElementById("sidebarToggle")?.setAttribute("aria-expanded", app.classList.contains("sidebar-open") ? "true" : "false");
}

function isTyping(el) {
  return el?.closest?.("input, textarea, select, [contenteditable='true'], [contenteditable='']");
}

export function initA11y() {
  enhance(document.body);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "attributes") {
        if (r.target instanceof Element) syncState(r.target);
        if (r.target.id === "app") setTimeout(syncSidebar, 350); // после анимации выезда
      } else for (const n of r.addedNodes) enhance(n);
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  document.querySelectorAll(".nav-item").forEach(syncState);
  window.addEventListener("resize", () => setTimeout(syncSidebar, 50));
  syncSidebar();

  document.addEventListener("keydown", (e) => {
    const el = document.activeElement;
    if (!el || el === document.body || isTyping(el)) return;
    const target = el.matches?.(CLICKABLE) ? el : null;
    if (target && (e.key === "Enter" || e.key === " ") && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      target.click();
      return;
    }
    // Shift+F10 / клавиша «меню» — контекстное меню того, на чём фокус,
    // как правая кнопка мыши по его середине.
    if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + Math.min(24, r.width / 2), clientY: r.top + r.height / 2 }));
    }
  });
}

// ── Диалоги ──
// Окно поверх приложения (карточка, Настройки, боковая панель): роль
// диалога, фокус внутрь, Tab не уходит под окно (#app — inert, пока
// открыто хоть одно окно), после закрытия фокус возвращается туда, откуда
// окно открыли. Возвращает функцию, которую зовут при закрытии.
const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
let openDialogs = 0;

export function makeDialog(container, label) {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  container.setAttribute("role", "dialog");
  container.setAttribute("aria-modal", "true");
  if (label) container.setAttribute("aria-label", label);
  const app = document.getElementById("app");
  openDialogs++;
  if (app) app.inert = true;

  const onKey = (e) => {
    if (e.key !== "Tab" || !container.isConnected) return;
    // Только для самого верхнего окна — вложенные всплывающие меню
    // висят вне контейнера и сами разбираются с фокусом.
    if (!container.contains(document.activeElement) && document.activeElement !== document.body) return;
    const items = [...container.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener("keydown", onKey);
  // Фокус внутрь — после того, как содержимое дорисуется (оно часто async).
  setTimeout(() => {
    if (container.contains(document.activeElement)) return;
    const target = container.querySelector("[autofocus]") || container.querySelector(FOCUSABLE);
    target?.focus({ preventScroll: true });
  }, 50);

  return function release() {
    document.removeEventListener("keydown", onKey);
    openDialogs = Math.max(0, openDialogs - 1);
    if (app && !openDialogs) app.inert = false;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  };
}
