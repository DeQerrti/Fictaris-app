import { apiGet, apiPost, uid } from "./api.js";
import { debounceSave } from "./save-badge.js";
import { openContextMenu } from "./context-menu.js";
import { buildEmptyState } from "./chips.js";
import { i18n } from "./i18n.js";

// ══════════════════════════════════════════════
//  КАРТА СЮЖЕТА
//
//  По образцу Story Map в Twine (прямоугольники-отрывки, стрелки между
//  ними) и вложенного Flow в articy:draft (сюжетная структура — те же
//  сущности со своими шаблонами, что и весь остальной мир, просто
//  разложенные по холсту как узлы). В отличие от того и другого — не
//  движок ветвящейся игры: узел не исполняемый отрывок с логикой, а
//  просто сюжетная точка (сцена, поворот, линия), связи — просто
//  подписанные стрелки ("отсюда следует", "здесь предвестие" и т.п.,
//  подпись — свободный текст, как label у relationships.js).
//
//  В отличие от графа персонажей (graph.js) — никакой физической
//  раскладки: автор сам расставляет точки по смыслу (хронология слева
//  направо, сюжетные линии — параллельными рядами), а не даёт
//  пружинам решать. Поэтому x/y каждого узла — обычное сохранённое
//  значение, а не состояние симуляции.
// ══════════════════════════════════════════════

let nodes = [];
let edges = [];
let container = null;
let connectMode = false;
let connectFrom = null;
// Без аргументов и с чтением nodes/edges внутри самого fn — а не через
// persist(nodes, edges) с захватом ссылок на момент вызова: между
// вызовом persist() и срабатыванием debounce (600мс) любой из массивов
// мог успеть замениться новым (например, edges.filter при удалении) —
// сохранить нужно то, что актуально в момент реального срабатывания, а
// не то, на что ссылки указывали в момент постановки в очередь.
const save = debounceSave(() => apiPost("/api/plot", { nodes, edges }));
function persist() {
  save();
}

const NODE_W = 180;
const NODE_H = 76;

function blankNode() {
  const col = nodes.length % 4;
  const row = Math.floor(nodes.length / 4);
  return {
    id: uid(),
    title: i18n("Новая точка"),
    note: "",
    chapterLabel: "",
    x: 140 + col * 220,
    y: 100 + row * 150,
  };
}

// Один слушатель на всё время жизни модуля (ES-модуль исполняется один
// раз), а не внутри draw()/attachInteraction — те вызываются заново на
// каждый клик/перетаскивание, и document.addEventListener там плодил бы
// новый слушатель при каждой перерисовке вместо одного. connectMode
// вне вкладки «Карта сюжета» всегда false, так что нажатие Esc в любом
// другом месте приложения этим слушателем не заметится.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && connectMode) {
    connectMode = false;
    connectFrom = null;
    draw();
  }
});

export async function renderPlot(root) {
  container = root;
  const data = await apiGet("/api/plot");
  nodes = Array.isArray(data.nodes) ? data.nodes : [];
  edges = Array.isArray(data.edges) ? data.edges : [];
  connectMode = false;
  connectFrom = null;
  draw();
}

function draw() {
  container.innerHTML = "";
  const view = document.createElement("div");
  view.className = "pgraph-view";

  const toolbar = document.createElement("div");
  toolbar.className = "graph-toolbar";
  const hint = document.createElement("span");
  hint.className = "graph-hint";
  hint.textContent = connectMode
    ? connectFrom
      ? i18n("Выбери вторую точку, чтобы связать «{name}» с ней", { name: connectFrom.title || i18n("Без названия") })
      : i18n("Выбери первую точку связи (Esc – отмена)")
    : i18n("Тащи точки мышью, клик открывает редактирование, ПКМ по точке или связи – удалить");
  toolbar.appendChild(hint);

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "8px";

  const addBtn = document.createElement("button");
  addBtn.className = "btn";
  addBtn.textContent = i18n("+ Точка");
  addBtn.addEventListener("click", () => {
    const n = blankNode();
    nodes.push(n);
    persist();
    draw();
    openNodeModal(n);
  });
  actions.appendChild(addBtn);

  const connectBtn = document.createElement("button");
  connectBtn.className = "btn" + (connectMode ? " accent" : "");
  connectBtn.textContent = i18n("Соединить");
  connectBtn.addEventListener("click", () => {
    connectMode = !connectMode;
    connectFrom = null;
    draw();
  });
  actions.appendChild(connectBtn);

  const resetBtn = document.createElement("button");
  resetBtn.className = "btn graph-reset-btn";
  resetBtn.textContent = i18n("Сбросить вид");
  actions.appendChild(resetBtn);

  toolbar.appendChild(actions);
  view.appendChild(toolbar);

  if (!nodes.length) {
    const empty = buildEmptyState(i18n("Пока нет ни одной точки сюжета – добавь первую."), "route");
    view.appendChild(empty);
    container.appendChild(view);
    return;
  }

  const width = Math.max(560, container.clientWidth || 900);
  const height = Math.max(440, (container.clientHeight || 700) - 90);

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.classList.add("pgraph-svg");

  const defs = document.createElementNS(svgNS, "defs");
  defs.innerHTML = `<marker id="plot-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--accent)"></path></marker>`;
  svg.appendChild(defs);

  const viewport = document.createElementNS(svgNS, "g");
  viewport.classList.add("graph-viewport");
  svg.appendChild(viewport);

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edgeEls = new Map();
  for (const e of edges) {
    const a = nodeById.get(e.from);
    const b = nodeById.get(e.to);
    if (!a || !b) continue;
    const g = document.createElementNS(svgNS, "g");
    g.classList.add("plot-edge");
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("stroke", "var(--accent)");
    line.setAttribute("stroke-width", "1.8");
    line.setAttribute("marker-end", "url(#plot-arrow)");
    g.appendChild(line);
    let labelEl = null;
    if (e.label) {
      labelEl = document.createElementNS(svgNS, "text");
      labelEl.setAttribute("text-anchor", "middle");
      labelEl.setAttribute("fill", "var(--text-dim)");
      labelEl.setAttribute("font-size", "11");
      labelEl.setAttribute("font-family", "Inter,sans-serif");
      labelEl.textContent = e.label;
      g.appendChild(labelEl);
    }
    g.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openContextMenu(ev.clientX, ev.clientY, [
        { label: i18n("Удалить связь"), danger: true, action: () => { edges = edges.filter((x) => x !== e); persist(); draw(); } },
      ]);
    });
    viewport.appendChild(g);
    edgeEls.set(e, { line, labelEl, a, b });
  }

  const nodeEls = new Map();
  for (const n of nodes) {
    const g = document.createElementNS(svgNS, "g");
    g.classList.add("graph-node", "plot-node");
    if (connectMode && connectFrom === n) g.classList.add("plot-node-pending");

    const rect = document.createElementNS(svgNS, "rect");
    rect.setAttribute("x", -NODE_W / 2);
    rect.setAttribute("y", -NODE_H / 2);
    rect.setAttribute("width", NODE_W);
    rect.setAttribute("height", NODE_H);
    rect.setAttribute("rx", 10);
    g.appendChild(rect);

    const title = document.createElementNS(svgNS, "text");
    title.setAttribute("text-anchor", "middle");
    title.setAttribute("y", n.chapterLabel ? -6 : 2);
    title.setAttribute("fill", "var(--text)");
    title.setAttribute("font-size", "13");
    title.setAttribute("font-family", "Inter,sans-serif");
    title.setAttribute("font-weight", "600");
    title.textContent = truncate(n.title || i18n("Без названия"), 22);
    g.appendChild(title);

    if (n.chapterLabel) {
      const sub = document.createElementNS(svgNS, "text");
      sub.setAttribute("text-anchor", "middle");
      sub.setAttribute("y", 14);
      sub.setAttribute("fill", "var(--text-faint)");
      sub.setAttribute("font-size", "10.5");
      sub.setAttribute("font-family", "Inter,sans-serif");
      sub.textContent = truncate(n.chapterLabel, 26);
      g.appendChild(sub);
    }

    g.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openContextMenu(ev.clientX, ev.clientY, [
        {
          label: i18n("Удалить точку"),
          danger: true,
          action: () => {
            nodes = nodes.filter((x) => x !== n);
            edges = edges.filter((e) => e.from !== n.id && e.to !== n.id);
            if (connectFrom === n) connectFrom = null;
            persist();
            draw();
          },
        },
      ]);
    });

    viewport.appendChild(g);
    nodeEls.set(n.id, g);
  }

  function positionAll() {
    for (const n of nodes) nodeEls.get(n.id)?.setAttribute("transform", `translate(${n.x},${n.y})`);
    for (const { line, labelEl, a, b } of edgeEls.values()) {
      // Стрелка должна утыкаться в край прямоугольника, а не в его
      // центр — иначе засвечивала бы собственный текст точки. Обрезаем
      // отрезок по границе NODE_W×NODE_H вокруг конечной точки b.
      const clipped = clipToRect(a.x, a.y, b.x, b.y, NODE_W, NODE_H);
      line.setAttribute("x1", a.x);
      line.setAttribute("y1", a.y);
      line.setAttribute("x2", clipped.x);
      line.setAttribute("y2", clipped.y);
      if (labelEl) {
        labelEl.setAttribute("x", (a.x + b.x) / 2);
        labelEl.setAttribute("y", (a.y + b.y) / 2 - 6);
      }
    }
  }
  positionAll();

  const holder = document.createElement("div");
  holder.className = "pgraph-holder";
  holder.appendChild(svg);
  view.appendChild(holder);
  container.appendChild(view);

  attachInteraction(svg, viewport, width, height, nodeEls, resetBtn);
}

function truncate(text, max) {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

// Точка на прямоугольнике NODE_W×NODE_H с центром (bx,by), где его
// пересекает отрезок из (ax,ay) — простое пересечение луча с
// ближайшей из четырёх сторон через параметр t.
function clipToRect(ax, ay, bx, by, w, h) {
  const dx = ax - bx;
  const dy = ay - by;
  if (dx === 0 && dy === 0) return { x: bx, y: by };
  const hw = w / 2;
  const hh = h / 2;
  const tx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const ty = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return { x: bx + dx * t, y: by + dy * t };
}

let dragState = null;

function attachInteraction(svg, viewport, width, height, nodeEls, resetBtn) {
  const viewState = { x: 0, y: 0, scale: 1 };
  const MIN_SCALE = 0.4;
  const MAX_SCALE = 2.5;

  function applyView() {
    viewport.setAttribute("transform", `translate(${viewState.x},${viewState.y}) scale(${viewState.scale})`);
  }

  function toGraphPoint(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    const sx = ((clientX - rect.left) / rect.width) * width;
    const sy = ((clientY - rect.top) / rect.height) * height;
    return { x: (sx - viewState.x) / viewState.scale, y: (sy - viewState.y) / viewState.scale };
  }

  svg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const before = toGraphPoint(e.clientX, e.clientY);
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      viewState.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, viewState.scale * delta));
      const after = toGraphPoint(e.clientX, e.clientY);
      viewState.x += (after.x - before.x) * viewState.scale;
      viewState.y += (after.y - before.y) * viewState.scale;
      applyView();
    },
    { passive: false }
  );

  let panStart = null;
  svg.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".graph-node")) return;
    panStart = { x: e.clientX, y: e.clientY, vx: viewState.x, vy: viewState.y };
    svg.setPointerCapture(e.pointerId);
    svg.classList.add("panning");
  });
  svg.addEventListener("pointermove", (e) => {
    if (!panStart) return;
    viewState.x = panStart.vx + (e.clientX - panStart.x);
    viewState.y = panStart.vy + (e.clientY - panStart.y);
    applyView();
  });
  const endPan = () => {
    if (!panStart) return;
    panStart = null;
    svg.classList.remove("panning");
  };
  svg.addEventListener("pointerup", endPan);
  svg.addEventListener("pointerleave", endPan);

  for (const n of nodes) {
    const g = nodeEls.get(n.id);
    if (!g) continue;
    g.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      const start = toGraphPoint(e.clientX, e.clientY);
      dragState = { id: n.id, moved: false, offX: start.x - n.x, offY: start.y - n.y };
      g.setPointerCapture(e.pointerId);
    });
    g.addEventListener("pointermove", (e) => {
      if (!dragState || dragState.id !== n.id) return;
      const p = toGraphPoint(e.clientX, e.clientY);
      n.x = p.x - dragState.offX;
      n.y = p.y - dragState.offY;
      dragState.moved = true;
      // Во время самого перетаскивания двигаем только узел — рёбра
      // "подтянутся" разом полным draw() при отпускании (ниже), это
      // дешевле, чем пересчитывать clipToRect на каждый pointermove.
      g.setAttribute("transform", `translate(${n.x},${n.y})`);
    });
    const endDrag = () => {
      if (!dragState || dragState.id !== n.id) return;
      const wasClick = !dragState.moved;
      dragState = null;
      if (wasClick) {
        if (connectMode) {
          if (!connectFrom) {
            connectFrom = n;
            draw();
          } else if (connectFrom !== n) {
            const label = window.prompt(i18n("Подпись связи (необязательно):"), "") || "";
            edges.push({ id: uid(), from: connectFrom.id, to: n.id, label: label.trim() });
            connectMode = false;
            connectFrom = null;
            persist();
            draw();
          }
        } else {
          openNodeModal(n);
        }
      } else {
        persist();
        draw(); // подтягивает связи под новую позицию узла
      }
    };
    g.addEventListener("pointerup", endDrag);
    g.addEventListener("pointercancel", endDrag);
  }

  resetBtn.addEventListener("click", () => {
    viewState.x = 0;
    viewState.y = 0;
    viewState.scale = 1;
    applyView();
  });

  applyView();
}

// ── Редактор точки (модалка) ─────────────────────
let modalEl = null;

function closeModal() {
  modalEl?.remove();
  modalEl = null;
}

function openNodeModal(n) {
  closeModal();
  modalEl = document.createElement("div");
  modalEl.className = "entity-modal-backdrop";
  modalEl.addEventListener("click", (e) => {
    if (e.target === modalEl) closeModal();
  });

  const panel = document.createElement("div");
  panel.className = "entity-modal-panel sheet-panel compact";

  const closeBtn = document.createElement("button");
  closeBtn.className = "entity-modal-close";
  closeBtn.innerHTML = "×";
  closeBtn.addEventListener("click", closeModal);
  panel.appendChild(closeBtn);

  const body = document.createElement("div");
  body.className = "entity-modal-body sheet-body";

  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.className = "drawer-name-field";
  titleInput.value = n.title || "";
  titleInput.addEventListener("input", () => {
    n.title = titleInput.value;
    persist();
  });
  body.appendChild(titleInput);

  const chapterField = document.createElement("div");
  chapterField.className = "field";
  chapterField.style.marginTop = "14px";
  const chapterLabel = document.createElement("label");
  chapterLabel.textContent = i18n("Глава / место в рукописи (необязательно)");
  chapterField.appendChild(chapterLabel);
  const chapterInput = document.createElement("input");
  chapterInput.type = "text";
  chapterInput.placeholder = i18n("например: Глава 7");
  chapterInput.value = n.chapterLabel || "";
  chapterInput.addEventListener("input", () => {
    n.chapterLabel = chapterInput.value;
    persist();
  });
  chapterField.appendChild(chapterInput);
  body.appendChild(chapterField);

  const noteField = document.createElement("div");
  noteField.className = "field";
  const noteLabel = document.createElement("label");
  noteLabel.textContent = i18n("Заметка");
  noteField.appendChild(noteLabel);
  const noteArea = document.createElement("textarea");
  noteArea.style.minHeight = "140px";
  noteArea.value = n.note || "";
  noteArea.addEventListener("input", () => {
    n.note = noteArea.value;
    persist();
  });
  noteField.appendChild(noteArea);
  body.appendChild(noteField);

  const actions = document.createElement("div");
  actions.className = "drawer-actions";
  const doneBtn = document.createElement("button");
  doneBtn.className = "btn";
  doneBtn.textContent = i18n("Готово");
  doneBtn.addEventListener("click", closeModal);
  const delBtn = document.createElement("button");
  delBtn.className = "btn danger";
  delBtn.textContent = i18n("Удалить");
  delBtn.addEventListener("click", () => {
    nodes = nodes.filter((x) => x !== n);
    edges = edges.filter((e) => e.from !== n.id && e.to !== n.id);
    persist();
    closeModal();
    draw();
  });
  actions.append(doneBtn, delBtn);
  body.appendChild(actions);

  panel.appendChild(body);
  modalEl.appendChild(panel);
  document.body.appendChild(modalEl);
  titleInput.focus();
  titleInput.select();
}
