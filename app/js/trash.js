import { apiGet, apiPost, uid } from "./api.js";
import { migrateBoards } from "./board-data.js";
import { escapeHtml, buildEmptyState } from "./chips.js";
import { iconSvg } from "./icons.js";
import { i18n, i18nPlural } from "./i18n.js";
import { reattachKin, reattachCharacter, reattachLocation, reattachFaction } from "./cascade.js";

// Корзина ничего не выкидывает сама: раньше после 200 записей самые старые
// молча пропадали навсегда. Теперь при большой корзине панель только
// предупреждает и предлагает убрать старое по кнопке.
const TRASH_BIG = 300;
const OLD_DAYS = 90;

// Соединительная работа, которую бриф прямо называл недоделанной в
// прошлой попытке: модули вызывали onTrash(type, item) перед удалением,
// но на уровне приложения не было ни состояния, ни persist, ни UI. Здесь
// это сделано целиком — pushTrash пишет в trash.json сразу (не debounce:
// удаление — дискретное решение, а не набор текста), а модули просто
// зовут pushTrash перед тем, как выкинуть элемент из своего массива.
//
// links — какие ссылки на запись убрали из других мест (родня, составы
// фракций, события, карточки…): «Вернуть» ставит их обратно. Часть ссылок
// известна только после чистки — их дописывает addTrashLinks.
export async function pushTrash(type, item, links) {
  const trash = await apiGet("/api/trash");
  const entry = { id: uid(), type, item, deletedAt: new Date().toISOString() };
  if (links) entry.links = links;
  await apiPost("/api/trash", [entry, ...trash]);
  document.dispatchEvent(new CustomEvent("fictaris:trash-changed"));
  return entry.id;
}

export async function addTrashLinks(entryId, links) {
  if (!entryId || !links) return;
  const trash = await apiGet("/api/trash");
  const entry = trash.find((e) => e.id === entryId);
  if (!entry) return;
  entry.links = { ...(entry.links || {}), ...links };
  await apiPost("/api/trash", trash);
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
    entry: { label: i18n("Запись"), listPath: null, displayName: (i) => (i.sectionName ? `${i.name} · ${i.sectionName}` : i.name) },
  };
}

async function restoreArrayItem(listPath, item) {
  const list = await apiGet(listPath);
  if (list.some((x) => x.id === item.id)) return; // уже вернули раньше — не дублируем
  await apiPost(listPath, [...list, item]);
}

// Доска — не плоский массив, а columns/cards/cardOrder, поэтому карточка
// возвращается не туда же, откуда её удалили (колонки самой уже может не
// быть), а в отдельную «Восстановлено» активной доски, которая создаётся
// при первой необходимости.
async function restoreBoardCard(card) {
  const data = migrateBoards(await apiGet("/api/board"));
  if (data.boards.some((b) => b.cards[card.id])) return;
  const board = data.boards.find((b) => b.id === data.activeBoardId) || data.boards[0];
  let col = board.columns.find((c) => c.title === i18n("Восстановлено"));
  if (!col) {
    col = { id: uid(), title: i18n("Восстановлено") };
    board.columns.push(col);
    board.cardOrder[col.id] = [];
  }
  board.cards[card.id] = card;
  board.cardOrder[col.id].push(card.id);
  await apiPost("/api/board", data);
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

const KIN_KEYS = ["parentIds", "adoptiveParentIds", "uncertainParentIds", "partnerIds"];

// Персонаж возвращается с роднёй (у других снова есть он в родителях и
// парах), составами фракций, событиями, главами, карточками, метками и
// «Кто что знает», а его связи из relationships.json — из корзины вместе
// с ним. Возвращает записи корзины, которые ушли заодно.
async function restoreCharacter(entry, trash) {
  const c = entry.item;
  const links = entry.links || {};
  const characters = await apiGet("/api/characters");
  if (!characters.some((x) => x.id === c.id)) {
    const ids = new Set(characters.map((x) => x.id));
    const own = { ...c };
    // Кого из родни успели удалить после него — тех в его списках уже нет.
    for (const k of KIN_KEYS) if (Array.isArray(own[k])) own[k] = own[k].filter((i) => ids.has(i));
    if (own.partnerKinds) own.partnerKinds = Object.fromEntries(Object.entries(own.partnerKinds).filter(([i]) => ids.has(i)));
    characters.push(own);
    reattachKin(characters, c.id, links.kin);
    await apiPost("/api/characters", characters);
  }
  await reattachCharacter(c.id, links);

  const extra = [];
  const relIds = links.relationships || [];
  if (relIds.length) {
    const present = new Set(characters.map((x) => x.id));
    const list = await apiGet("/api/relationships");
    for (const e of trash) {
      if (e.type !== "relationship" || !relIds.includes(e.item?.id)) continue;
      const r = e.item;
      if (!present.has(r.charA) || !present.has(r.charB)) continue;
      if (!list.some((x) => x.id === r.id)) list.push(r);
      extra.push(e);
    }
    if (extra.length) await apiPost("/api/relationships", list);
  }
  return extra;
}

async function restoreLocation(entry) {
  const loc = entry.item;
  const locations = await apiGet("/api/locations");
  if (!locations.some((x) => x.id === loc.id)) {
    const parentOk = locations.some((x) => x.id === loc.parentId);
    await apiPost("/api/locations", [...locations, { ...loc, parentId: parentOk ? loc.parentId : null }]);
  }
  await reattachLocation(loc.id, entry.links);
}

// Запись своего раздела: раздел могли удалить целиком — тогда он
// заводится заново с прежним id и названием (шаблон анкеты в
// site-settings.json остаётся и после удаления раздела).
async function restoreSectionEntry(entry) {
  const { sectionName, ...item } = entry.item;
  const data = await apiGet("/api/entries").catch(() => ({ sections: [], entries: [] }));
  data.sections = Array.isArray(data.sections) ? data.sections : [];
  data.entries = Array.isArray(data.entries) ? data.entries : [];
  if (data.entries.some((e) => e.id === item.id)) return;
  if (!data.sections.some((s) => s.id === item.sectionId)) {
    data.sections.push({ id: item.sectionId, name: sectionName || i18n("Восстановлено"), icon: "folder", color: "#7d6a9e" });
  }
  data.entries.push(item);
  await apiPost("/api/entries", data);
  document.dispatchEvent(new CustomEvent("fictaris:sections-changed"));
}

async function restoreFaction(entry) {
  await restoreArrayItem("/api/factions", entry.item);
  await reattachFaction(entry.item.id, entry.links);
}

export async function restoreEntry(entry, trash) {
  if (entry.type === "board-card") await restoreBoardCard(entry.item);
  else if (entry.type === "chapter") await restoreChapter(entry.item);
  else if (entry.type === "character") return restoreCharacter(entry, trash);
  else if (entry.type === "location") await restoreLocation(entry);
  else if (entry.type === "faction") await restoreFaction(entry);
  else if (entry.type === "entry") await restoreSectionEntry(entry);
  else await restoreArrayItem(typeInfo()[entry.type].listPath, entry.item);
  return [];
}

// Окно из нижней строки сайдбара (sidebar-overview.js), не вкладка:
// список короткий, на весь экран он только пустовал.
export async function renderTrash(root) {
  const trash = await apiGet("/api/trash");
  root.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "trash-panel";

  const head = document.createElement("div");
  head.className = "sb-pop-head";
  head.innerHTML = `<span class="sb-pop-title"></span><span class="sb-pop-meta"></span>`;
  head.querySelector(".sb-pop-title").textContent = i18n("Корзина");
  const meta = head.querySelector(".sb-pop-meta");
  const updateMeta = (n) => { meta.textContent = n ? i18nPlural(n, ["{n} запись", "{n} записи", "{n} записей"]) : ""; };
  updateMeta(trash.length);
  wrap.appendChild(head);

  if (!trash.length) {
    const empty = buildEmptyState(i18n("Корзина пуста."), "trash");
    wrap.appendChild(empty);
    root.appendChild(wrap);
    return;
  }

  if (trash.length > TRASH_BIG) wrap.appendChild(buildBigWarning(trash, () => renderTrash(root)));

  for (const entry of trash) {
    wrap.appendChild(buildRow(entry, trash, (left) => {
      updateMeta(left);
      if (!left) wrap.appendChild(buildEmptyState(i18n("Корзина пуста."), "trash"));
    }));
  }

  root.appendChild(wrap);
}

// Большая корзина: предупреждение и кнопка «убрать старше 90 дней» —
// вместо прежнего молчаливого вытеснения.
function buildBigWarning(trash, rerender) {
  const box = document.createElement("div");
  box.className = "trash-warning";
  const cutoff = Date.now() - OLD_DAYS * 86400000;
  const old = trash.filter((e) => new Date(e.deletedAt).getTime() < cutoff);
  const text = document.createElement("span");
  text.textContent = i18n("Корзина разрослась. Записи не удаляются сами – уберите ненужные.");
  box.appendChild(text);
  if (old.length) {
    const btn = document.createElement("button");
    btn.className = "btn danger";
    const label = i18nPlural(old.length, ["Удалить {n} запись старше 3 месяцев", "Удалить {n} записи старше 3 месяцев", "Удалить {n} записей старше 3 месяцев"]);
    btn.textContent = label;
    btn.addEventListener("click", async () => {
      if (btn.dataset.confirm !== "1") {
        btn.dataset.confirm = "1";
        btn.textContent = i18n("Точно? Их нельзя будет вернуть");
        setTimeout(() => { btn.dataset.confirm = ""; btn.textContent = label; }, 3000);
        return;
      }
      const left = trash.filter((e) => !old.includes(e));
      await apiPost("/api/trash", left);
      document.dispatchEvent(new CustomEvent("fictaris:trash-changed"));
      rerender();
    });
    box.appendChild(btn);
  }
  return box;
}

function removeFrom(trash, entry) {
  const i = trash.indexOf(entry);
  if (i >= 0) trash.splice(i, 1);
}

function buildRow(entry, trash, onRemoved) {
  const info = typeInfo()[entry.type];
  const row = document.createElement("div");
  row.className = "trash-row";
  row.dataset.entryId = entry.id;

  const meta = document.createElement("div");
  meta.className = "trash-meta";
  const date = new Date(entry.deletedAt);
  meta.innerHTML = `<span class="trash-name">${escapeHtml(info?.displayName(entry.item) || "?")}</span><span class="trash-date"><span class="trash-type">${escapeHtml(info?.label || entry.type)}</span> · ${date.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>`;
  row.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "trash-actions";

  const restoreBtn = document.createElement("button");
  restoreBtn.className = "btn";
  restoreBtn.textContent = i18n("Вернуть");
  restoreBtn.addEventListener("click", async () => {
    // Сначала дописать отложенные правки открытого раздела, потом вернуть
    // запись на диск и перечитать раздел: иначе следующая правка записала
    // бы старую копию из памяти — без возвращённого.
    await window.__flushPendingSaves?.();
    const extra = await restoreEntry(entry, trash);
    removeFrom(trash, entry);
    for (const e of extra) {
      removeFrom(trash, e);
      row.parentElement?.querySelector(`[data-entry-id="${e.id}"]`)?.remove();
    }
    await apiPost("/api/trash", trash);
    document.dispatchEvent(new CustomEvent("fictaris:trash-changed"));
    document.dispatchEvent(new CustomEvent("fictaris:data-replaced"));
    row.remove();
    onRemoved(trash.length);
  });
  actions.appendChild(restoreBtn);

  const forgetBtn = document.createElement("button");
  forgetBtn.className = "btn danger trash-forget";
  forgetBtn.innerHTML = iconSvg("close", 13);
  forgetBtn.title = i18n("Удалить навсегда");
  forgetBtn.addEventListener("click", async () => {
    if (forgetBtn.dataset.confirm === "1") {
      removeFrom(trash, entry);
      await apiPost("/api/trash", trash);
      document.dispatchEvent(new CustomEvent("fictaris:trash-changed"));
      row.remove();
      onRemoved(trash.length);
      return;
    }
    forgetBtn.dataset.confirm = "1";
    forgetBtn.textContent = i18n("Точно?");
    setTimeout(() => {
      forgetBtn.dataset.confirm = "";
      forgetBtn.innerHTML = iconSvg("close", 13);
    }, 3000);
  });
  actions.appendChild(forgetBtn);

  row.appendChild(actions);
  return row;
}
