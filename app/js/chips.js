// Переиспользуемые кусочки для работы со списком персонажей —
// {id, name, color} — по паттерну из брифа (технические детали, п.4):
// та же форма объекта пригодится для локаций/фракций в будущем без
// переписывания компонента.

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
    opt.textContent = c.name || "Без имени";
    if (c.id === selectedId) opt.selected = true;
    select.appendChild(opt);
  }
  return select;
}
