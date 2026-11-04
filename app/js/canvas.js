import { apiGet, apiPost, uid } from "./api.js";
import { debounceSave } from "./save-badge.js";
import { escapeHtml, buildEmptyState } from "./chips.js";
import { iconSvg } from "./icons.js";
import { i18n, i18nPlural } from "./i18n.js";
import { buildBoard, edgeGeometry } from "./canvas-board.js";

// ══════════════════════════════════════════════
//  ХОЛСТ
//
//  По духу Obsidian Canvas и Scapple: свободные карточки на бесконечном
//  панорамируемом и масштабируемом поле, которые можно тянуть, менять
//  размер и соединять подписанными стрелками — не привязано к сущностям
//  мира (для этого уже есть Граф/Родословная/Связи). Раньше это было два
//  отдельных, но механически одинаковых инструмента — «Холст» (вольная
//  заметка) и «Карта сюжета» (структурная точка с главой и подписанными
//  стрелками, по образцу Story Map в Twine) — один и тот же холст с
//  перетаскиванием/зумом/стрелками, просто с разным набором полей на
//  карточке. Слиты в один: заголовок и привязка к главе — необязательные
//  поля обычной карточки (в панели свойств справа),
//  а не отдельный тип узла — можно как обойтись голой заметкой, так и
//  выстроить полноценную сюжетную схему на том же холсте.
//
//  Несколько холстов — домашний экран со списком (как в map.js), вход по
//  клику, свой набор карточек/связей у каждого.
//
//  Сама доска — выбор, рамка выделения, стрелки от краёв, группы, панель
//  свойств, отмена — в canvas-board.js; здесь — список холстов, перенос
//  старой «Карты сюжета» и вход в нужный холст из поиска.
// ══════════════════════════════════════════════

let data = { order: [], canvases: {} };
let chapters = [];
let books = []; // manuscript.books — ради подписи книги у главы (chapterLabel)
let activeId = null;
let focusCardId = null;
let container = null;
const save = debounceSave((d) => apiPost("/api/canvas", d));

function persist() {
  save(data);
}

function blankCanvas() {
  return { id: uid(), name: i18n("Новый холст"), cards: [], edges: [], groups: [] };
}

function currentCanvas() {
  return data.canvases[activeId];
}

// Старая «Карта сюжета» (app/js/plot.js, удалён) — один общий граф,
// без нескольких досок, с прямоугольными точками (title/note/
// chapterLabel — свободный текст) вместо произвольного размера. Раз
// вкладки для неё больше нет, а данные в /api/plot у части пользователей
// уже накоплены — при первом открытии «Холста» после обновления её узлы
// становятся отдельной, новой доской «Карта сюжета» здесь; повторно не
// импортируется (data.plotImported), чтобы не плодить копии при каждом
// открытии вкладки.
// Только точное совпадение (без регистра) и только если оно однозначно
// среди текущих глав — иначе null, пусть остаётся свободным текстом.
function resolveChapterByTitle(label) {
  const norm = (label || "").trim().toLowerCase();
  if (!norm) return null;
  const matches = chapters.filter((c) => (c.title || "").trim().toLowerCase() === norm);
  return matches.length === 1 ? matches[0].id : null;
}

async function importLegacyPlotOnce() {
  if (data.plotImported) return;
  data.plotImported = true;
  const plot = await apiGet("/api/plot").catch(() => null);
  const nodes = Array.isArray(plot?.nodes) ? plot.nodes : [];
  if (!nodes.length) return;

  const cv = blankCanvas();
  cv.name = i18n("Карта сюжета");
  cv.cards = nodes.map((n) => {
    // chapterLabel у старой карты — свободный текст ("Глава 7"), не id
    // главы. Нечёткое сопоставление ("Глава 7" ~ "7. Порт") рискует
    // привязать не ту главу, поэтому сверяем только точным совпадением
    // названия (без регистра) и только если оно однозначно — тогда сразу
    // настоящая привязка (кликабельный chapterId). Без такого совпадения
    // подпись просто переносится как раньше, до ручной перепривязки
    // в панели свойств карточки.
    const chapterId = resolveChapterByTitle(n.chapterLabel);
    return {
      id: n.id,
      x: n.x ?? 0,
      y: n.y ?? 0,
      w: 220,
      h: 130,
      text: n.note || "",
      title: n.title || "",
      chapterId,
      chapterLabel: chapterId ? "" : n.chapterLabel || "",
      color: null,
    };
  });
  cv.edges = (Array.isArray(plot?.edges) ? plot.edges : [])
    .filter((e) => nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to))
    .map((e) => ({ id: e.id, fromId: e.from, toId: e.to, label: e.label || "" }));

  data.canvases[cv.id] = cv;
  data.order.push(cv.id);
  persist();
}

// focusCardId — переход из поиска (search.js индексирует карточки холста
// по id) или откуда-то ещё: находим, в какой именно доске лежит эта
// карточка, открываем сразу её и центрируем вид на карточке (см.
// buildCanvasView) — а не просто открываем домашний экран со списком
// досок, откуда всё равно пришлось бы искать её глазами.
export async function renderCanvas(root, focus) {
  container = root;
  focusCardId = focus || null;
  [data, chapters] = await Promise.all([
    apiGet("/api/canvas"),
    apiGet("/api/manuscript").then((m) => {
      books = m.books || [];
      return m.chapters || [];
    }),
  ]);
  if (!Array.isArray(data.order)) data.order = [];
  if (!data.canvases || typeof data.canvases !== "object") data.canvases = {};
  if (activeId && !data.canvases[activeId]) activeId = null;
  await importLegacyPlotOnce();
  if (focusCardId) {
    const owner = data.order.find((id) => data.canvases[id]?.cards?.some((c) => c.id === focusCardId));
    if (owner) activeId = owner;
  }
  draw();
}

function draw() {
  container.innerHTML = "";
  container.appendChild(activeId ? buildCanvasView() : buildHome());
}

// ── Домашний экран — список холстов ────────────
function buildHome() {
  const view = document.createElement("div");
  view.className = "characters-view";
  const grid = document.createElement("div");
  grid.className = "characters-grid";

  if (!data.order.length) {
    const empty = buildEmptyState(
      i18n("Холстов пока нет – создай первый для свободных заметок, схем или сюжетных точек, не привязанных к конкретным персонажам или локациям."),
      "frame"
    );
    empty.style.gridColumn = "1 / -1";
    grid.appendChild(empty);
  }

  for (const id of data.order) {
    const cv = data.canvases[id];
    if (!cv) continue;
    const card = document.createElement("div");
    card.className = "entity-card map-home-card";

    const open = document.createElement("button");
    open.className = "map-home-open";
    open.innerHTML = `
      <div class="map-card-thumb canvas-card-thumb">${canvasThumbSvg(cv) || iconSvg("frame", 30)}</div>
      <div class="map-card-footer">
        <div class="char-name">${escapeHtml(cv.name || i18n("Без названия"))}</div>
        <div class="char-role">${i18nPlural((cv.cards || []).length, ["{n} карточка", "{n} карточки", "{n} карточек"])}</div>
      </div>
    `;
    open.addEventListener("click", () => {
      activeId = id;
      draw();
    });
    card.appendChild(open);

    const delBtn = document.createElement("button");
    delBtn.className = "board-column-del";
    delBtn.innerHTML = iconSvg("close", 12);
    delBtn.title = i18n("Удалить холст");
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (delBtn.dataset.confirm === "1") {
        delete data.canvases[id];
        data.order = data.order.filter((x) => x !== id);
        persist();
        draw();
        return;
      }
      delBtn.dataset.confirm = "1";
      delBtn.textContent = "?";
      delBtn.title = i18n("Точно удалить холст со всеми карточками?");
      setTimeout(() => {
        delBtn.dataset.confirm = "";
        delBtn.innerHTML = iconSvg("close", 12);
        delBtn.title = i18n("Удалить холст");
      }, 3000);
    });
    card.appendChild(delBtn);

    grid.appendChild(card);
  }

  const addCard = document.createElement("button");
  addCard.className = "entity-card add-card";
  addCard.textContent = i18n("+ Новый холст");
  addCard.addEventListener("click", () => {
    const cv = blankCanvas();
    data.canvases[cv.id] = cv;
    data.order.push(cv.id);
    persist();
    activeId = cv.id;
    draw();
  });
  grid.appendChild(addCard);

  view.appendChild(grid);
  return view;
}

// Миниатюра холста на домашнем экране — вместо картинки, как у карт
// (map.js): те же прямоугольники карточек и стрелки, вписанные в рамку.
// Пустой холст — null, и вместо схемы рисуется значок.
function canvasThumbSvg(cv) {
  const cards = cv.cards || [];
  const groups = cv.groups || [];
  if (!cards.length && !groups.length) return null;
  const boxes = [...cards.map((c) => ({ x: c.x, y: c.y, w: c.w || 220, h: c.h || 130 })), ...groups];
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.w));
  const maxY = Math.max(...boxes.map((b) => b.y + b.h));
  const pad = 40;
  const byId = new Map(cards.map((c) => [c.id, c]));
  const edges = (cv.edges || [])
    .map((e) => [byId.get(e.fromId), byId.get(e.toId)])
    .filter(([a, b]) => a && b)
    .map(([a, b]) => `<path d="${edgeGeometry(a, b).d}"/>`)
    .join("");
  const frames = groups.map((g) => `<rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="14"/>`).join("");
  const rects = cards
    .map((c) => {
      const color = /^#[0-9a-f]{6}$/i.test(c.color || "") ? c.color : "var(--card)";
      return `<rect x="${c.x}" y="${c.y}" width="${c.w || 220}" height="${c.h || 130}" rx="10" fill="${color}"/>`;
    })
    .join("");
  return `<svg viewBox="${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}" preserveAspectRatio="xMidYMid meet"><g class="canvas-thumb-groups">${frames}</g><g class="canvas-thumb-edges">${edges}</g><g class="canvas-thumb-cards">${rects}</g></svg>`;
}

// ── Сам холст ───────────────────────────────────
function buildCanvasView() {
  return buildBoard({
    cv: currentCanvas(),
    chapters,
    books,
    persist,
    focusCardId,
    onBack: () => {
      activeId = null;
      focusCardId = null;
      draw();
    },
  });
}
