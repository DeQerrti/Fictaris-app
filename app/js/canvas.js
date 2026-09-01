import { apiGet, apiPost, uid } from "./api.js";
import { debounceSave } from "./save-badge.js";
import { escapeHtml } from "./chips.js";
import { openContextMenu } from "./context-menu.js";
import { i18n } from "./i18n.js";

// ══════════════════════════════════════════════
//  ХОЛСТ
//
//  По духу Obsidian Canvas: свободные текстовые карточки на
//  бесконечном панорамируемом и масштабируемом поле, которые можно
//  тянуть, менять размер и соединять стрелками — не привязано к
//  сущностям мира (для этого уже есть Граф/Родословная/Связи),
//  свободное место для черновых идей, схем сюжета, набросков сцен.
//  Несколько холстов — как несколько карт в map.js: домашний экран со
//  списком, вход по клику, свой набор карточек/связей у каждого.
//
//  Панорамирование/зум/перетаскивание — тот же приём, что и в graph.js
//  (view = {x,y,scale}, transform на общий контейнер, пересчёт клика
//  через getBoundingClientRect), только применён к обычным HTML-div,
//  а не к SVG-группе: карточкам нужен живой <textarea>, а не текст в SVG.
// ══════════════════════════════════════════════

let data = { order: [], canvases: {} };
let activeId = null;
let container = null;
const save = debounceSave((d) => apiPost("/api/canvas", d));

function persist() {
  save(data);
}

function blankCanvas() {
  return { id: uid(), name: i18n("Новый холст"), cards: [], edges: [] };
}

function blankCard(x, y) {
  return { id: uid(), x, y, w: 220, h: 130, text: "", color: null };
}

function currentCanvas() {
  return data.canvases[activeId];
}

const CARD_COLORS = [null, "#c9944a", "#4f7d74", "#a4483c", "#7d6a9e", "#6a8fae", "#5a8a5f"];
const MIN_W = 140;
const MIN_H = 80;

export async function renderCanvas(root) {
  container = root;
  data = await apiGet("/api/canvas");
  if (!Array.isArray(data.order)) data.order = [];
  if (!data.canvases || typeof data.canvases !== "object") data.canvases = {};
  if (activeId && !data.canvases[activeId]) activeId = null;
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
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.style.gridColumn = "1 / -1";
    empty.textContent = i18n("Холстов пока нет — создай первый для свободных заметок и схем, не привязанных к конкретным персонажам или локациям.");
    grid.appendChild(empty);
  }

  for (const id of data.order) {
    const cv = data.canvases[id];
    if (!cv) continue;
    const card = document.createElement("div");
    card.className = "char-card map-home-card";

    const open = document.createElement("button");
    open.className = "map-home-open";
    open.innerHTML = `
      <div class="char-avatar" style="background:#7d6a9e">✎</div>
      <div class="char-name">${escapeHtml(cv.name || i18n("Без названия"))}</div>
      <div class="char-role">${i18n("{n} карточек", { n: (cv.cards || []).length })}</div>
    `;
    open.addEventListener("click", () => {
      activeId = id;
      draw();
    });
    card.appendChild(open);

    const delBtn = document.createElement("button");
    delBtn.className = "board-column-del";
    delBtn.textContent = "✕";
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
        delBtn.textContent = "✕";
      }, 3000);
    });
    card.appendChild(delBtn);

    grid.appendChild(card);
  }

  const addCard = document.createElement("button");
  addCard.className = "char-card add-card";
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

// ── Сам холст ───────────────────────────────────
function buildCanvasView() {
  const cv = currentCanvas();
  const wrap = document.createElement("div");
  wrap.className = "canvas-view-wrap";

  const toolbar = document.createElement("div");
  toolbar.className = "canvas-toolbar";

  const backBtn = document.createElement("button");
  backBtn.className = "btn";
  backBtn.textContent = i18n("← Все холсты");
  backBtn.addEventListener("click", () => {
    activeId = null;
    draw();
  });
  toolbar.appendChild(backBtn);

  const nameInput = document.createElement("input");
  nameInput.className = "canvas-name-input";
  nameInput.value = cv.name || "";
  nameInput.placeholder = i18n("Название холста");
  nameInput.addEventListener("input", () => {
    cv.name = nameInput.value;
    persist();
  });
  toolbar.appendChild(nameInput);

  const addNoteBtn = document.createElement("button");
  addNoteBtn.className = "btn";
  addNoteBtn.textContent = i18n("+ Заметка");
  toolbar.appendChild(addNoteBtn);

  const resetBtn = document.createElement("button");
  resetBtn.className = "btn";
  resetBtn.textContent = i18n("Сбросить вид");
  toolbar.appendChild(resetBtn);

  const hint = document.createElement("span");
  hint.className = "graph-hint";
  hint.textContent = i18n("Тащи фон — панорама, колесо — зум, ⠿⠿ тянет карточку, точки по краям — тянут связь к другой карточке.");
  toolbar.appendChild(hint);

  const holder = document.createElement("div");
  holder.className = "canvas-holder";

  const viewport = document.createElement("div");
  viewport.className = "canvas-viewport";

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.classList.add("canvas-edges-svg");
  viewport.appendChild(svg);

  const cardLayer = document.createElement("div");
  cardLayer.className = "canvas-card-layer";
  viewport.appendChild(cardLayer);

  holder.appendChild(viewport);
  wrap.append(toolbar, holder);

  // ── Вид: панорама + зум ──
  const view = { x: 0, y: 0, scale: 1 };
  const MIN_SCALE = 0.3;
  const MAX_SCALE = 2.5;

  function applyView() {
    viewport.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.scale})`;
  }

  function toCanvasPoint(clientX, clientY) {
    const rect = holder.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return { x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale };
  }

  holder.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const before = toCanvasPoint(e.clientX, e.clientY);
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      view.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * delta));
      const after = toCanvasPoint(e.clientX, e.clientY);
      view.x += (after.x - before.x) * view.scale;
      view.y += (after.y - before.y) * view.scale;
      applyView();
    },
    { passive: false }
  );

  let panStart = null;
  holder.addEventListener("pointerdown", (e) => {
    if (e.target !== holder && e.target !== viewport && e.target !== svg) return;
    panStart = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    holder.setPointerCapture(e.pointerId);
    holder.classList.add("panning");
  });
  holder.addEventListener("pointermove", (e) => {
    if (!panStart) return;
    view.x = panStart.vx + (e.clientX - panStart.x);
    view.y = panStart.vy + (e.clientY - panStart.y);
    applyView();
  });
  const endPan = () => {
    panStart = null;
    holder.classList.remove("panning");
  };
  holder.addEventListener("pointerup", endPan);
  holder.addEventListener("pointerleave", endPan);

  resetBtn.addEventListener("click", () => {
    view.x = 0;
    view.y = 0;
    view.scale = 1;
    applyView();
  });

  addNoteBtn.addEventListener("click", () => {
    const rect = holder.getBoundingClientRect();
    const center = toCanvasPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const card = blankCard(Math.round(center.x - 110), Math.round(center.y - 65));
    cv.cards.push(card);
    persist();
    renderCards();
  });

  // ── Связи (рёбра) ──
  function renderEdges() {
    svg.innerHTML = "";
    for (const e of cv.edges) {
      const a = cv.cards.find((c) => c.id === e.fromId);
      const b = cv.cards.find((c) => c.id === e.toId);
      if (!a || !b) continue;
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", a.x + a.w / 2);
      line.setAttribute("y1", a.y + a.h / 2);
      line.setAttribute("x2", b.x + b.w / 2);
      line.setAttribute("y2", b.y + b.h / 2);
      line.setAttribute("stroke", "var(--accent)");
      line.setAttribute("stroke-width", "2");
      line.setAttribute("marker-end", "url(#canvas-arrow)");
      svg.appendChild(line);
    }
  }

  function ensureArrowMarker() {
    const defs = document.createElementNS(svgNS, "defs");
    defs.innerHTML =
      `<marker id="canvas-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
      `<path d="M0,0 L10,5 L0,10 z" fill="var(--accent)"></path></marker>`;
    svg.appendChild(defs);
  }
  ensureArrowMarker();

  function edgeLabel(card) {
    return (card.text || "").trim().slice(0, 24) || i18n("Без текста");
  }

  function connectionsMenuItems(card) {
    const touching = cv.edges.filter((e) => e.fromId === card.id || e.toId === card.id);
    if (!touching.length) return [{ label: i18n("Связей нет"), disabled: true }];
    return touching.map((e) => {
      const otherId = e.fromId === card.id ? e.toId : e.fromId;
      const other = cv.cards.find((c) => c.id === otherId);
      return {
        label: i18n("✕ {label}", { label: other ? edgeLabel(other) : "?" }),
        action: () => {
          cv.edges = cv.edges.filter((x) => x.id !== e.id);
          persist();
          renderEdges();
        },
      };
    });
  }

  // ── Карточки ──
  let connectDrag = null; // { fromId, line }

  function buildCardEl(card) {
    const el = document.createElement("div");
    el.className = "canvas-card";
    el.dataset.cardId = card.id;
    el.style.left = `${card.x}px`;
    el.style.top = `${card.y}px`;
    el.style.width = `${card.w}px`;
    el.style.height = `${card.h}px`;
    if (card.color) el.style.borderColor = card.color;

    const head = document.createElement("div");
    head.className = "canvas-card-head";
    head.textContent = "⠿⠿";
    el.appendChild(head);

    const area = document.createElement("textarea");
    area.className = "canvas-card-text";
    area.value = card.text || "";
    area.placeholder = i18n("Текст…");
    area.addEventListener("pointerdown", (e) => e.stopPropagation());
    area.addEventListener("input", () => {
      card.text = area.value;
      persist();
    });
    el.appendChild(area);

    const resizeHandle = document.createElement("div");
    resizeHandle.className = "canvas-card-resize";
    el.appendChild(resizeHandle);

    for (const side of ["n", "e", "s", "w"]) {
      const dot = document.createElement("div");
      dot.className = `canvas-connector canvas-connector-${side}`;
      dot.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        const line = document.createElementNS(svgNS, "line");
        line.setAttribute("stroke", "var(--accent)");
        line.setAttribute("stroke-width", "2");
        line.setAttribute("stroke-dasharray", "4 3");
        svg.appendChild(line);
        connectDrag = { fromId: card.id, line };
        const p = toCanvasPoint(e.clientX, e.clientY);
        line.setAttribute("x1", card.x + card.w / 2);
        line.setAttribute("y1", card.y + card.h / 2);
        line.setAttribute("x2", p.x);
        line.setAttribute("y2", p.y);
        document.addEventListener("pointermove", onConnectMove);
        document.addEventListener("pointerup", onConnectUp, { once: true });
      });
      el.appendChild(dot);
    }

    head.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      const start = toCanvasPoint(e.clientX, e.clientY);
      const offX = start.x - card.x;
      const offY = start.y - card.y;
      const onMove = (ev) => {
        const p = toCanvasPoint(ev.clientX, ev.clientY);
        card.x = Math.round(p.x - offX);
        card.y = Math.round(p.y - offY);
        el.style.left = `${card.x}px`;
        el.style.top = `${card.y}px`;
        renderEdges();
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        persist();
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });

    resizeHandle.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = card.w;
      const startH = card.h;
      const onMove = (ev) => {
        card.w = Math.max(MIN_W, Math.round(startW + (ev.clientX - startX) / view.scale));
        card.h = Math.max(MIN_H, Math.round(startH + (ev.clientY - startY) / view.scale));
        el.style.width = `${card.w}px`;
        el.style.height = `${card.h}px`;
        renderEdges();
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        persist();
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });

    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY, [
        {
          label: i18n("Цвет"),
          items: CARD_COLORS.map((c) => ({
            label: c ? "" : i18n("Без цвета"),
            swatch: c || undefined,
            checked: card.color === c,
            action: () => {
              card.color = c;
              persist();
              renderCards();
            },
          })),
        },
        { label: i18n("Связи"), items: connectionsMenuItems(card) },
        { separator: true },
        {
          label: i18n("Удалить карточку"),
          danger: true,
          action: () => {
            cv.cards = cv.cards.filter((c) => c.id !== card.id);
            cv.edges = cv.edges.filter((ed) => ed.fromId !== card.id && ed.toId !== card.id);
            persist();
            renderCards();
          },
        },
      ]);
    });

    return el;
  }

  function onConnectMove(e) {
    if (!connectDrag) return;
    const p = toCanvasPoint(e.clientX, e.clientY);
    connectDrag.line.setAttribute("x2", p.x);
    connectDrag.line.setAttribute("y2", p.y);
  }

  function onConnectUp(e) {
    document.removeEventListener("pointermove", onConnectMove);
    if (!connectDrag) return;
    connectDrag.line.remove();
    const targetEl = document.elementFromPoint(e.clientX, e.clientY)?.closest(".canvas-card");
    const toId = targetEl?.dataset.cardId;
    const fromId = connectDrag.fromId;
    connectDrag = null;
    if (toId && toId !== fromId && !cv.edges.some((ed) => ed.fromId === fromId && ed.toId === toId)) {
      cv.edges.push({ id: uid(), fromId, toId });
      persist();
      renderEdges();
    }
  }

  function renderCards() {
    cardLayer.innerHTML = "";
    for (const card of cv.cards) cardLayer.appendChild(buildCardEl(card));
    renderEdges();
  }

  renderCards();
  applyView();

  return wrap;
}
