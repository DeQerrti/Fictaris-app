// ══════════════════════════════════════════════
//  КОНТЕКСТНОЕ МЕНЮ (ПКМ)
//
//  Общий рисователь всплывающего меню по правой кнопке мыши — как у
//  Obsidian/Word: список пунктов, необязательные разделители и
//  вложенные подменю (color/character/faction в board.js держат их
//  списками, а не отдельными полями). Один экземпляр на страницу —
//  открытие нового закрывает предыдущее, как и везде в приложении
//  (project-switcher.js, search.js).
//
//  items: Array<{ label, action?, disabled?, danger?, items? } | { separator: true }>
//  submenu — вложенный items той же формы, раскрывается по наведению.
// ══════════════════════════════════════════════

let menuEl = null;

function closeMenu() {
  menuEl?.remove();
  menuEl = null;
  document.removeEventListener("mousedown", onOutside, true);
  document.removeEventListener("keydown", onEscape, true);
}

function onOutside(e) {
  if (menuEl && !menuEl.contains(e.target)) closeMenu();
}

function onEscape(e) {
  if (e.key === "Escape") closeMenu();
}

function buildList(items) {
  const list = document.createElement("div");
  list.className = "context-menu-list";
  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement("div");
      sep.className = "context-menu-sep";
      list.appendChild(sep);
      continue;
    }
    const row = document.createElement("div");
    row.className = "context-menu-item" + (item.danger ? " danger" : "");
    if (item.checked) row.classList.add("checked");
    if (item.disabled) row.classList.add("disabled");
    row.innerHTML =
      (item.swatch ? `<span class="context-menu-swatch" style="background:${item.swatch}"></span>` : "") +
      `<span class="context-menu-label">${item.label}</span>` +
      (item.items ? `<span class="context-menu-arrow">›</span>` : "");
    if (item.items && !item.disabled) {
      let sub = null;
      row.addEventListener("mouseenter", () => {
        list.querySelectorAll(":scope > .context-menu-submenu").forEach((s) => s.remove());
        sub = buildList(item.items);
        sub.classList.add("context-menu-submenu");
        row.appendChild(sub);
        const r = sub.getBoundingClientRect();
        if (r.right > window.innerWidth) sub.classList.add("context-menu-submenu-left");
      });
    } else {
      row.addEventListener("click", () => {
        if (item.disabled) return;
        closeMenu();
        item.action?.();
      });
    }
    list.appendChild(row);
  }
  return list;
}

export function openContextMenu(x, y, items) {
  closeMenu();
  menuEl = document.createElement("div");
  menuEl.className = "context-menu";
  menuEl.appendChild(buildList(items));
  document.body.appendChild(menuEl);

  const rect = menuEl.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  menuEl.style.left = `${Math.max(4, left)}px`;
  menuEl.style.top = `${Math.max(4, top)}px`;

  setTimeout(() => {
    document.addEventListener("mousedown", onOutside, true);
    document.addEventListener("keydown", onEscape, true);
  }, 0);
}
