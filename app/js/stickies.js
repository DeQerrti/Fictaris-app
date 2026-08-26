// Инлайн-стикеры `[[note:id]]` — маркер в тексте главы, ссылающийся на
// заметку из chapter.stickies. Регексп стикера безопасно накладывается
// поверх уже готового HTML от mentionsToHtml: экранирование не трогает
// квадратные скобки/двоеточие/дефис, так что порядок «сначала упоминания,
// потом стикеры» ничего не ломает.
const STICKY_RE = /\[\[note:([\w-]+)\]\]/g;

export function stickersToHtml(html, stickies) {
  return html.replace(STICKY_RE, (match, id) => {
    const sticky = stickies.find((s) => s.id === id);
    if (!sticky) return match;
    return `<span class="sticky-marker" data-sticky-id="${id}">📌</span>`;
  });
}

let popoverEl = null;
function ensurePopover() {
  if (popoverEl) return popoverEl;
  popoverEl = document.createElement("div");
  popoverEl.className = "sticky-popover";
  document.body.appendChild(popoverEl);
  // Клик где угодно вне стикера и вне самого попапа — закрывает его.
  document.addEventListener("click", (e) => {
    if (popoverEl.style.display !== "none" && !popoverEl.contains(e.target) && !e.target.closest(".sticky-marker")) {
      popoverEl.style.display = "none";
    }
  });
  return popoverEl;
}

export function attachStickyPopover(container, getStickies) {
  container.addEventListener("click", (e) => {
    const el = e.target.closest(".sticky-marker");
    if (!el) return;
    e.stopPropagation();
    const sticky = getStickies().find((s) => s.id === el.dataset.stickyId);
    if (!sticky) return;
    const pop = ensurePopover();
    pop.textContent = sticky.text || "(пустая заметка)";
    const rect = el.getBoundingClientRect();
    pop.style.left = `${rect.left}px`;
    pop.style.top = `${rect.bottom + 6}px`;
    pop.style.display = "block";
  });
}
