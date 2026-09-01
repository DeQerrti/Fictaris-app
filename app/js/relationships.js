import { apiGet, apiPost, uid } from "./api.js";
import { debounceSave } from "./save-badge.js";
import { escapeHtml, characterSelect } from "./chips.js";
import { pushTrash } from "./trash.js";
import { i18n } from "./i18n.js";

// ══════════════════════════════════════════════
//  СВЯЗИ
//
//  Граф раньше был статичной картинкой (позиции по кругу, посчитанные
//  один раз в innerHTML) — ни потаскать узел, ни навести, ни кликнуть.
//  Здесь тот же приём, что и в графе проекта (graph.js) — свой
//  force-directed layout, крутится через requestAnimationFrame, плюс
//  перетаскивание/зум/панорамирование/hover-подсветка и клик открывает
//  карточку персонажа. Отдельная реализация, не общая с graph.js: там
//  три типа узлов и рёбра без веса, здесь — только персонажи, а длина
//  пружины у ребра зависит от score связи (сильный союз — узлы ближе
//  друг к другу, вражда — дальше), чего в общем графе нет и не нужно.
// ══════════════════════════════════════════════

let characters = [];
let relationships = [];
let container = null;
let raf = null;
let dragState = null;
const save = debounceSave((list) => apiPost("/api/relationships", list));

function persist() {
  save(relationships);
}

function charById(id) {
  return characters.find((c) => c.id === id);
}

// -100 (вражда, красный) → 0 (нейтрально, серый) → +100 (союз, зелёный)
function scoreColor(score) {
  const t = Math.max(-100, Math.min(100, Number(score) || 0)) / 100;
  const neg = [0xa4, 0x48, 0x3c];
  const mid = [0x7c, 0x71, 0x57];
  const pos = [0x5a, 0x8a, 0x5f];
  const [a, b] = t < 0 ? [neg, mid] : [mid, pos];
  const k = Math.abs(t);
  const mix = a.map((v, i) => Math.round(v + (b[i] - v) * k));
  return `rgb(${mix.join(",")})`;
}

// Сильная связь (по модулю score) тянет пару ближе, слабая/враждебная —
// держит дальше — чтобы граф нёс смысл, а не только цвет линии.
function springLengthFor(score) {
  return 180 - Math.max(-100, Math.min(100, Number(score) || 0)) * 0.8;
}

export async function renderRelationships(root) {
  container = root;
  if (raf) cancelAnimationFrame(raf);
  [characters, relationships] = await Promise.all([
    apiGet("/api/characters"),
    apiGet("/api/relationships"),
  ]);
  draw();
}

function draw() {
  container.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "rel-view";

  if (characters.length < 2) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = i18n("Нужно как минимум два персонажа, чтобы связать их между собой.");
    wrap.appendChild(empty);
    container.appendChild(wrap);
    return;
  }

  wrap.appendChild(buildGraph());
  wrap.appendChild(buildList());
  container.appendChild(wrap);
}

// ── Интерактивный граф ──────────────────────────
const REPULSION = 2200;
const SPRING_STRENGTH = 0.03;
const CENTER_PULL = 0.003;
const DAMPING = 0.86;
const ALPHA_DECAY = 0.985;
const ALPHA_MIN = 0.01;

let simNodes = [];
let simEdges = [];
let simWidth = 0;
let simHeight = 0;
let simPositionAll = null;

function buildGraph() {
  const width = Math.max(560, container.clientWidth ? container.clientWidth - 48 : 800);
  const height = Math.max(360, Math.min(560, (container.clientHeight || 700) * 0.55));
  const cx = width / 2;
  const cy = height / 2;

  simNodes = characters.map((c, i) => {
    const angle = (2 * Math.PI * i) / characters.length - Math.PI / 2;
    const r = Math.min(width, height) / 2 - 60;
    return { id: c.id, name: c.name, color: c.color || "#7c7157", x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), vx: 0, vy: 0, dragging: false };
  });
  simEdges = relationships
    .filter((rel) => charById(rel.charA) && charById(rel.charB))
    .map((rel) => ({ a: rel.charA, b: rel.charB, score: rel.score, springLength: springLengthFor(rel.score) }));

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.classList.add("rgraph-svg");

  const viewport = document.createElementNS(svgNS, "g");
  svg.appendChild(viewport);

  const lineByNode = new Map();
  const lineEls = new Map();
  for (const e of simEdges) {
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("stroke", scoreColor(e.score));
    line.setAttribute("stroke-width", "2.5");
    line.dataset.a = e.a;
    line.dataset.b = e.b;
    line.dataset.color = scoreColor(e.score);
    viewport.appendChild(line);
    lineEls.set(e, line);
    for (const id of [e.a, e.b]) {
      if (!lineByNode.has(id)) lineByNode.set(id, []);
      lineByNode.get(id).push(line);
    }
  }

  const nodeEls = new Map();
  for (const n of simNodes) {
    const g = document.createElementNS(svgNS, "g");
    g.classList.add("rgraph-node");

    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("r", 15);
    circle.setAttribute("fill", n.color);
    g.appendChild(circle);

    const text = document.createElementNS(svgNS, "text");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("y", 28);
    text.setAttribute("fill", "#a99977");
    text.setAttribute("font-size", "11");
    text.setAttribute("font-family", "Inter,sans-serif");
    text.textContent = n.name || "?";
    g.appendChild(text);

    g.addEventListener("mouseenter", () => { if (!dragState) highlight(n.id, lineByNode, nodeEls); });
    g.addEventListener("mouseleave", () => { if (!dragState) resetHighlight(lineByNode, nodeEls); });

    viewport.appendChild(g);
    nodeEls.set(n.id, g);
  }

  function positionAll() {
    for (const n of simNodes) nodeEls.get(n.id).setAttribute("transform", `translate(${n.x},${n.y})`);
    for (const [e, line] of lineEls) {
      const a = simNodes.find((n) => n.id === e.a);
      const b = simNodes.find((n) => n.id === e.b);
      if (!a || !b) continue;
      line.setAttribute("x1", a.x);
      line.setAttribute("y1", a.y);
      line.setAttribute("x2", b.x);
      line.setAttribute("y2", b.y);
    }
  }
  positionAll();

  const holder = document.createElement("div");
  holder.className = "rgraph-holder";
  // В отличие от графа проекта (pgraph-holder — flex:1 в колонке, тоже
  // flex:1 на весь #content), этот граф стоит в обычном прокручиваемом
  // столбце вместе со списком связей под ним — без явной высоты 100%
  // на SVG было бы не от чего отсчитывать, и он схлопнулся бы в 0.
  holder.style.height = `${height}px`;
  holder.appendChild(svg);

  const outer = document.createElement("div");
  outer.className = "rgraph-outer";
  outer.appendChild(holder);
  outer.appendChild(buildHint());

  simWidth = width;
  simHeight = height;
  simPositionAll = positionAll;
  runSimulation();
  attachInteraction(svg, viewport, width, height, nodeEls, lineByNode);

  return outer;
}

function runSimulation() {
  const cx = simWidth / 2;
  const cy = simHeight / 2;
  let alpha = 1;

  function tick() {
    for (let i = 0; i < simNodes.length; i++) {
      const a = simNodes[i];
      if (a.dragging) continue;
      for (let j = i + 1; j < simNodes.length; j++) {
        const b = simNodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 1) distSq = 1;
        const dist = Math.sqrt(distSq);
        const force = (REPULSION * alpha) / distSq;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx;
        a.vy += fy;
        if (!b.dragging) { b.vx -= fx; b.vy -= fy; }
      }
      a.vx += (cx - a.x) * CENTER_PULL * alpha;
      a.vy += (cy - a.y) * CENTER_PULL * alpha;
    }

    for (const e of simEdges) {
      const a = simNodes.find((n) => n.id === e.a);
      const b = simNodes.find((n) => n.id === e.b);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const force = (dist - e.springLength) * SPRING_STRENGTH * alpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      if (!a.dragging) { a.vx += fx; a.vy += fy; }
      if (!b.dragging) { b.vx -= fx; b.vy -= fy; }
    }

    for (const n of simNodes) {
      if (n.dragging) continue;
      n.vx *= DAMPING;
      n.vy *= DAMPING;
      n.x += n.vx;
      n.y += n.vy;
    }

    simPositionAll();
    alpha *= ALPHA_DECAY;
    if (alpha > ALPHA_MIN || simNodes.some((n) => n.dragging)) {
      raf = requestAnimationFrame(tick);
    } else {
      raf = null;
    }
  }

  raf = requestAnimationFrame(tick);
}

function attachInteraction(svg, viewport, width, height, nodeEls, lineByNode) {
  const view = { x: 0, y: 0, scale: 1 };
  const MIN_SCALE = 0.4;
  const MAX_SCALE = 2.5;

  function applyView() {
    viewport.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.scale})`);
  }

  function toGraphPoint(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    const sx = ((clientX - rect.left) / rect.width) * width;
    const sy = ((clientY - rect.top) / rect.height) * height;
    return { x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale };
  }

  svg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const before = toGraphPoint(e.clientX, e.clientY);
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      view.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * delta));
      const after = toGraphPoint(e.clientX, e.clientY);
      view.x += (after.x - before.x) * view.scale;
      view.y += (after.y - before.y) * view.scale;
      applyView();
    },
    { passive: false }
  );

  let panStart = null;
  svg.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".rgraph-node")) return;
    panStart = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    svg.setPointerCapture(e.pointerId);
    svg.classList.add("panning");
  });
  svg.addEventListener("pointermove", (e) => {
    if (!panStart) return;
    view.x = panStart.vx + (e.clientX - panStart.x);
    view.y = panStart.vy + (e.clientY - panStart.y);
    applyView();
  });
  const endPan = () => {
    if (!panStart) return;
    panStart = null;
    svg.classList.remove("panning");
  };
  svg.addEventListener("pointerup", endPan);
  svg.addEventListener("pointerleave", endPan);

  for (const n of simNodes) {
    const g = nodeEls.get(n.id);
    g.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      const start = toGraphPoint(e.clientX, e.clientY);
      dragState = { id: n.id, moved: false, offX: start.x - n.x, offY: start.y - n.y };
      n.dragging = true;
      g.setPointerCapture(e.pointerId);
      if (!raf) runSimulation();
    });
    g.addEventListener("pointermove", (e) => {
      if (!dragState || dragState.id !== n.id) return;
      const p = toGraphPoint(e.clientX, e.clientY);
      n.x = p.x - dragState.offX;
      n.y = p.y - dragState.offY;
      n.vx = 0;
      n.vy = 0;
      dragState.moved = true;
    });
    const endDrag = () => {
      if (!dragState || dragState.id !== n.id) return;
      n.dragging = false;
      const wasClick = !dragState.moved;
      dragState = null;
      resetHighlight(lineByNode, nodeEls);
      if (wasClick) {
        document.dispatchEvent(new CustomEvent("fictaris:open-entity", { detail: { type: "character", id: n.id } }));
      }
    };
    g.addEventListener("pointerup", endDrag);
    g.addEventListener("pointercancel", endDrag);
  }

  applyView();
}

function highlight(id, lineByNode, nodeEls) {
  const connected = new Set([id]);
  for (const line of lineByNode.get(id) || []) {
    line.setAttribute("stroke", "var(--accent)");
    line.setAttribute("stroke-width", "3");
    connected.add(line.dataset.a);
    connected.add(line.dataset.b);
  }
  for (const [nid, g] of nodeEls) g.style.opacity = connected.has(nid) ? "1" : "0.25";
}

function resetHighlight(lineByNode, nodeEls) {
  for (const lines of lineByNode.values()) {
    for (const line of lines) {
      line.setAttribute("stroke", line.dataset.color);
      line.setAttribute("stroke-width", "2.5");
    }
  }
  for (const g of nodeEls.values()) g.style.opacity = "1";
}

function buildHint() {
  const hint = document.createElement("div");
  hint.className = "rgraph-hint";
  hint.textContent = i18n("Тащи узлы мышью, крути колесо для зума, клик открывает карточку — цвет и длина линии показывают знак и силу связи.");
  return hint;
}

// ── Список связей ───────────────────────────────
function buildList() {
  const box = document.createElement("div");
  box.className = "rel-list";

  const title = document.createElement("h3");
  title.className = "rel-list-title";
  title.textContent = i18n("Список связей");
  box.appendChild(title);

  for (const rel of relationships) {
    box.appendChild(buildRelRow(rel));
  }

  const addBtn = document.createElement("button");
  addBtn.className = "btn rel-list-add";
  addBtn.textContent = i18n("+ Добавить связь");
  addBtn.addEventListener("click", () => {
    relationships.push({
      id: uid(),
      charA: characters[0].id,
      charB: characters[1].id,
      label: "",
      score: 0,
      note: "",
    });
    persist();
    draw();
  });
  box.appendChild(addBtn);

  return box;
}

function buildRelRow(rel) {
  const row = document.createElement("div");
  row.className = "rel-row";

  const top = document.createElement("div");
  top.className = "rel-row-top";

  const selA = characterSelect(characters, rel.charA);
  selA.addEventListener("change", () => { rel.charA = selA.value; persist(); draw(); });
  const arrow = document.createElement("span");
  arrow.className = "rel-row-arrow";
  arrow.textContent = "↔";
  const selB = characterSelect(characters, rel.charB);
  selB.addEventListener("change", () => { rel.charB = selB.value; persist(); draw(); });

  const label = document.createElement("input");
  label.className = "field-inline-control field-inline-control-bright rel-row-label";
  label.placeholder = i18n("Метка (наставник, вражда…)");
  label.value = rel.label || "";
  label.addEventListener("input", () => { rel.label = label.value; persist(); });

  const delBtn = document.createElement("button");
  delBtn.className = "btn danger";
  delBtn.textContent = "✕";
  delBtn.addEventListener("click", async () => {
    await pushTrash("relationship", rel);
    relationships = relationships.filter((r) => r.id !== rel.id);
    persist();
    draw();
  });

  top.append(selA, arrow, selB, label, delBtn);
  row.appendChild(top);

  const sliderRow = document.createElement("div");
  sliderRow.className = "rel-sliders";
  const scoreLabel = document.createElement("span");
  scoreLabel.className = "rel-score-label";
  scoreLabel.textContent = rel.score;
  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "rel-slider";
  slider.min = -100;
  slider.max = 100;
  slider.value = rel.score || 0;
  slider.addEventListener("input", () => {
    rel.score = Number(slider.value);
    scoreLabel.textContent = rel.score;
    persist();
  });
  sliderRow.append(scoreLabel, slider);
  row.appendChild(sliderRow);

  const note = document.createElement("textarea");
  note.className = "field-inline-control rel-note";
  note.placeholder = i18n("Заметка о связи…");
  note.value = rel.note || "";
  note.addEventListener("input", () => { rel.note = note.value; persist(); });
  row.appendChild(note);

  return row;
}
