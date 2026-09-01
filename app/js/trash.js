import { apiGet, apiPost, uid } from "./api.js";
import { escapeHtml } from "./chips.js";
import { i18n } from "./i18n.js";

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

function typeInfo() {
  return {
    character: { label: i18n("Персонаж"), listPath: "/api/characters", displayName: (i) => i.name },
    location: { label: i18n("Локация"), listPath: "/api/locations", displayName: (i) => i.name },
    relationship: { label: i18n("Связь"), listPath: "/api/relationships", displayName: (i) => i.label || i18n("Связь") },
    faction: { label: i18n("Фракция"), listPath: "/api/factions", displayName: (i) => i.name },
    timeline: { label: i18n("Событие таймлайна"), listPath: "/api/timeline", displayName: (i) => i.title },
    "board-card": { label: i18n("Карточка доски"), listPath: null, displayName: (i) => i.title },
    chapter: { label: i18n("Глава"), listPath: null, displayName: (i) => i.title || i18n("Без названия") },
  };
}

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
  let col = board.columns.find((c) => c.title === i18n("Восстановлено"));
  if (!col) {
    col = { id: uid(), title: i18n("Восстановлено") };
    board.columns.push(col);
    board.cardOrder[col.id] = [];
  }
  board.cards[card.id] = card;
  board.cardOrder[col.id].push(card.id);
  await apiPost("/api/board", board);
}

// Глава — тоже не плоский массив на верхнем уровне, а manuscript.chapters
// внутри manuscript.json; папка, в которой она когда-то лежала, к
// моменту восстановления могла и сама уже быть удалена — тогда глава
// просто возвращается «без папки», а не теряется вовсе.
async function restoreChapter(chapter) {
  const manuscript = await apiGet("/api/manuscript");
  if (manuscript.chapters.some((c) => c.id === chapter.id)) return;
  const folders = manuscript.folders || [];
  const folderId = folders.some((f) => f.id === chapter.folderId) ? chapter.folderId : null;
  manuscript.chapters.push({ ...chapter, folderId });
  await apiPost("/api/manuscript", manuscript);
}

async function restoreEntry(entry) {
  if (entry.type === "board-card") await restoreBoardCard(entry.item);
  else if (entry.type === "chapter") await restoreChapter(entry.item);
  else await restoreArrayItem(typeInfo()[entry.type].listPath, entry.item);
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
    empty.textContent = i18n("Корзина пуста.");
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
  const info = typeInfo()[entry.type];
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
  restoreBtn.textContent = i18n("Восстановить");
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
  forgetBtn.textContent = i18n("Удалить навсегда");
  forgetBtn.addEventListener("click", async () => {
    if (forgetBtn.dataset.confirm === "1") {
      const next = trash.filter((e) => e.id !== entry.id);
      await apiPost("/api/trash", next);
      document.dispatchEvent(new CustomEvent("fictaris:trash-changed"));
      row.remove();
      return;
    }
    forgetBtn.dataset.confirm = "1";
    forgetBtn.textContent = i18n("Точно?");
    setTimeout(() => {
      forgetBtn.dataset.confirm = "";
      forgetBtn.textContent = i18n("Удалить навсегда");
    }, 3000);
  });
  actions.appendChild(forgetBtn);

  row.appendChild(actions);
  return row;
}
