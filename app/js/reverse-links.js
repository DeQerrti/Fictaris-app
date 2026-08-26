import { escapeHtml } from "./chips.js";

// Общий рендер блока «Где ещё упоминается» — карточки персонажа и
// локации показывают его в самом низу, под редактируемыми полями.
// Каждая группа — [подпись, список готовых строк]; пустые группы не
// рисуются, а если пусто всё — блок вообще не появляется.
export function buildReverseLinks(groups) {
  const nonEmpty = groups.filter(([, list]) => list.length);
  if (!nonEmpty.length) return null;

  const wrap = document.createElement("div");
  wrap.className = "reverse-links";

  const title = document.createElement("div");
  title.className = "reverse-links-title";
  title.textContent = "Где ещё упоминается";
  wrap.appendChild(title);

  for (const [label, list] of nonEmpty) {
    const row = document.createElement("div");
    row.className = "reverse-links-group";
    row.innerHTML = `<strong>${escapeHtml(label)}:</strong> ${list.map(escapeHtml).join(", ")}`;
    wrap.appendChild(row);
  }

  return wrap;
}
