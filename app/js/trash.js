import { apiGet, apiPost, uid } from "./api.js";
import { escapeHtml } from "./chips.js";

const TRASH_LIMIT = 200;

// Соединительная работа, которую бриф прямо называл недоделанной в
// прошлой попытке: модули вызывали onTrash(type, item) перед удалением,
// но на уровне приложения не было ни состояния, ни persist, ни UI. Здесь
// это сделано целиком — pushTrash пишет в trash.json сразу (не debounce:
// удаление — дискретное решение, а не набор текста), а модули просто
// зовут pushTrash перед тем, как выкинуть элемент из своего массива.
export async function pushTrash(type, item) {
  const trash = await apiGet("/api/trash");
  const entry = { id: uid(), type, item, deletedAt: new Date().toISOString() };
  const next = [entry, ...trash].slice(0, TRASH_LIMIT);
  await apiPost("/api/trash", next);
  document.dispatchEvent(new CustomEvent("fictaris:trash-changed"));
}

const TYPE_INFO = {
  character: { label: "Персонаж", listPath: "/api/characters", displayName: (i) => i.name },
  location: { label: "Локация", listPath: "/api/locations", displayName: (i) => i.name },
  relationship: { label: "Связь", listPath: "/api/relationships", displayName: (i) => i.label || "Связь" },
  faction: { label: "Фракция", listPath: "/api/factions", displayName: (i) => i.name },
  timeline: { label: "Событие таймлайна", listPath: "/api/timeline", displayName: (i) => i.title },
  "board-card": { label: "Карточка доски", listPath: null, displayName: (i) => i.title },
};

async function restoreArrayItem(listPath, item) {
  const list = await apiGet(listPath);
  if (list.some((x) => x.id === item.id)) return; // уже вернули раньше — не дублируем
  await apiPost(listPath, [...list, item]);
}

// Доска — не плоский массив, а columns/cards/cardOrder, поэтому карточка
// возвращается не туда же, откуда её удалили (колонки самой уже может не
// быть), а в отдельную «Восстановлено», которая создаётся при первой
// необходимости.
async function restoreBoardCard(card) {
  const board = await apiGet("/api/board");
  if (board.cards[card.id]) return;
  let col = board.columns.find((c) => c.title === "Восстановлено");
  if (!col) {
    col = { id: uid(), title: "Восстановлено" };
    board.columns.push(col);
    board.cardOrder[col.id] = [];
  }
  board.cards[card.id] = card;
  board.cardOrder[col.id].push(card.id);
  await apiPost("/api/board", board);
}

async function restoreEntry(entry) {
  if (entry.type === "board-card") await restoreBoardCard(entry.item);
  else await restoreArrayItem(TYPE_INFO[entry.type].listPath, entry.item);
}

export async function trashCount() {
  return (await apiGet("/api/trash")).length;
}

export async function renderTrash(root) {
  const trash = await apiGet("/api/trash");
  root.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "trash-panel";

  if (!trash.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Корзина пуста.";
    wrap.appendChild(empty);
    root.appendChild(wrap);
    return;
  }

  for (const entry of trash) {
    wrap.appendChild(buildRow(entry, trash));
  }

  root.appendChild(wrap);
}

function buildRow(entry, trash) {
  const info = TYPE_INFO[entry.type];
  const row = document.createElement("div");
  row.className = "trash-row";

  const meta = document.createElement("div");
  meta.className = "trash-meta";
  const date = new Date(entry.deletedAt);
  meta.innerHTML = `<span class="trash-type">${escapeHtml(info?.label || entry.type)}</span> · ${escapeHtml(info?.displayName(entry.item) || "?")} <span class="trash-date">${date.toLocaleString()}</span>`;
  row.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "trash-actions";

  const restoreBtn = document.createElement("button");
  restoreBtn.className = "btn";
  restoreBtn.textContent = "Восстановить";
  restoreBtn.addEventListener("click", async () => {
    await restoreEntry(entry);
    const next = trash.filter((e) => e.id !== entry.id);
    await apiPost("/api/trash", next);
    document.dispatchEvent(new CustomEvent("fictaris:trash-changed"));
    row.remove();
  });
  actions.appendChild(restoreBtn);

  const forgetBtn = document.createElement("button");
  forgetBtn.className = "btn danger";
  forgetBtn.textContent = "Удалить навсегда";
  forgetBtn.addEventListener("click", async () => {
    if (forgetBtn.dataset.confirm === "1") {
      const next = trash.filter((e) => e.id !== entry.id);
      await apiPost("/api/trash", next);
      document.dispatchEvent(new CustomEvent("fictaris:trash-changed"));
      row.remove();
      return;
    }
    forgetBtn.dataset.confirm = "1";
    forgetBtn.textContent = "Точно?";
    setTimeout(() => {
      forgetBtn.dataset.confirm = "";
      forgetBtn.textContent = "Удалить навсегда";
    }, 3000);
  });
  actions.appendChild(forgetBtn);

  row.appendChild(actions);
  return row;
}
