import { apiGet } from "./api.js";
import { locationTypeInfo, factionTypeInfo, iconSvg } from "./icons.js";
import { i18n } from "./i18n.js";

// ══════════════════════════════════════════════
//  ГРАФ ПРОЕКТА
//
//  Раньше — статичный круг (позиции фиксировались один раз при отрисовке
//  и никогда не менялись), без панорамирования, без зума, без
//  перетаскивания узлов, без клика. По просьбе «сделать более
//  интерактивным и динамичным как в обсидиане» — здесь простой
//  рукописный force-directed layout (отталкивание между всеми узлами +
//  пружина по рёбрам + лёгкое притяжение к центру), который сам крутится
//  через requestAnimationFrame, плюс: перетаскивание узла мышью, зум
//  колесом (к курсору), панорамирование перетаскиванием фона, и клик по
//  узлу открывает нужную карточку (персонажа/локацию/фракцию) — как в
//  графе Obsidian.
// ══════════════════════════════════════════════

let nodes = [];
let edges = [];
let container = null;
let raf = null;
let simWidth = 0;
let simHeight = 0;
let simPositionAll = null;

const REPULSION = 2600;
const SPRING_LENGTH = 110;
const SPRING_STRENGTH = 0.02;
const CENTER_PULL = 0.0025;
const DAMPING = 0.86;
const ALPHA_DECAY = 0.985;
const ALPHA_MIN = 0.01;

function buildNodes(characters, locations, factions) {
  const list = [];
  for (const c of characters) list.push({ id: c.id, type: "character", name: c.name, color: c.color || "#7c7157", icon: null });
  for (const l of locations) {
    const [, , icon, color] = locationTypeInfo(l.type);
    list.push({ id: l.id, type: "location", name: l.name, color, icon });
  }
  for (const f of factions) {
    const [, , icon, color] = factionTypeInfo(f.type);
    list.push({ id: f.id, type: "faction", name: f.name, color, icon });
  }
  return list;
}

// Рёбра автоматически из связей, состава фракций и совместных упоминаний
// в событиях таймлайна — как описано в брифе, без ручной расстановки.
function buildEdges(relationships, factions, timeline) {
  const seen = new Set();
  const list = [];
  const add = (a, b) => {
    if (!a || !b || a === b) return;
    const key = [a, b].sort().join("|");
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ a, b });
  };

  for (const r of relationships) add(r.charA, r.charB);

  for (const f of factions) {
    if (f.leaderId) add(f.id, f.leaderId);
    if (f.headquartersId) add(f.id, f.headquartersId);
    for (const m of f.memberIds || []) add(f.id, m);
  }

  for (const ev of timeline) {
    for (const c of ev.characterIds || []) {
      for (const l of ev.locationIds || []) add(c, l);
    }
  }

  return list;
}

export async function renderGraph(root) {
  container = root;
  if (raf) cancelAnimationFrame(raf);
  const [characters, locations, factions, relationships, timeline] = await Promise.all([
    apiGet("/api/characters"),
    apiGet("/api/locations"),
    apiGet("/api/factions"),
    apiGet("/api/relationships"),
    apiGet("/api/timeline"),
  ]);
  nodes = buildNodes(characters, locations, factions);
  edges = buildEdges(relationships, factions, timeline);
  draw();
}

function draw() {
  container.innerHTML = "";

  if (nodes.length < 2) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = i18n("Добавь персонажей, локаций или фракций, чтобы увидеть граф проекта.");
    container.appendChild(empty);
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "graph-view";

  const width = Math.max(560, Math.min(920, container.clientWidth || 720));
  const height = Math.max(440, Math.min(680, 140 + nodes.length * 18));
  const cx = width / 2;
  const cy = height / 2;

  // Начальная раскладка — по кругу, как и раньше; дальше её берёт на
  // себя симуляция, но стартовать со случайного разброса точек и дать
  // физике тысячи итераций само по себе некрасиво трясётся на глазах —
  // круг как отправная точка успокаивается за пару секунд куда мягче.
  const r = Math.min(width, height) / 2 - 70;
  nodes.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
    if (n.x === undefined) {
      n.x = cx + r * Math.cos(angle);
      n.y = cy + r * Math.sin(angle);
    }
    n.vx = 0;
    n.vy = 0;
    n.dragging = false;
  });

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.classList.add("graph-svg");

  const viewport = document.createElementNS(svgNS, "g");
  viewport.classList.add("graph-viewport");
  svg.appendChild(viewport);

  const lineByNode = new Map();
  const lineEls = new Map();
  for (const e of edges) {
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("stroke", "var(--border)");
    line.setAttribute("stroke-width", "1.5");
    line.dataset.a = e.a;
    line.dataset.b = e.b;
    viewport.appendChild(line);
    lineEls.set(e, line);
    for (const id of [e.a, e.b]) {
      if (!lineByNode.has(id)) lineByNode.set(id, []);
      lineByNode.get(id).push(line);
    }
  }

  const nodeEls = new Map();
  for (const n of nodes) {
    const g = document.createElementNS(svgNS, "g");
    g.classList.add("graph-node");

    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("r", 14);
    circle.setAttribute("fill", n.color);
    g.appendChild(circle);

    if (n.icon) {
      const fo = document.createElementNS(svgNS, "foreignObject");
      fo.setAttribute("width", 18);
      fo.setAttribute("height", 18);
      fo.setAttribute("x", -9);
      fo.setAttribute("y", -9);
      fo.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" style="color:#14110d">${iconSvg(n.icon, 18)}</div>`;
      g.appendChild(fo);
    }

    const text = document.createElementNS(svgNS, "text");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("y", 26);
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
    for (const n of nodes) {
      nodeEls.get(n.id).setAttribute("transform", `translate(${n.x},${n.y})`);
    }
    for (const [e, line] of lineEls) {
      const a = nodes.find((n) => n.id === e.a);
      const b = nodes.find((n) => n.id === e.b);
      if (!a || !b) continue;
      line.setAttribute("x1", a.x);
      line.setAttribute("y1", a.y);
      line.setAttribute("x2", b.x);
      line.setAttribute("y2", b.y);
    }
  }
  positionAll();

  const holder = document.createElement("div");
  holder.className = "graph-holder";
  holder.appendChild(svg);
  wrap.appendChild(holder);
  wrap.appendChild(buildToolbar());
  wrap.appendChild(buildLegend());
  container.appendChild(wrap);

  simWidth = width;
  simHeight = height;
  simPositionAll = positionAll;
  runSimulation();
  attachInteraction(svg, viewport, width, height, nodeEls, lineByNode);
}

// ── Симуляция ─────────────────────────────────
function runSimulation() {
  const cx = simWidth / 2;
  const cy = simHeight / 2;
  let alpha = 1;

  function tick() {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      if (a.dragging) continue;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
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
      // лёгкое притяжение к центру, чтобы граф не расползался за края
      a.vx += (cx - a.x) * CENTER_PULL * alpha;
      a.vy += (cy - a.y) * CENTER_PULL * alpha;
    }

    for (const e of edges) {
      const a = nodes.find((n) => n.id === e.a);
      const b = nodes.find((n) => n.id === e.b);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const force = (dist - SPRING_LENGTH) * SPRING_STRENGTH * alpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      if (!a.dragging) { a.vx += fx; a.vy += fy; }
      if (!b.dragging) { b.vx -= fx; b.vy -= fy; }
    }

    for (const n of nodes) {
      if (n.dragging) continue;
      n.vx *= DAMPING;
      n.vy *= DAMPING;
      n.x += n.vx;
      n.y += n.vy;
    }

    simPositionAll();
    alpha *= ALPHA_DECAY;
    if (alpha > ALPHA_MIN || nodes.some((n) => n.dragging)) {
      raf = requestAnimationFrame(tick);
    } else {
      raf = null;
    }
  }

  raf = requestAnimationFrame(tick);
}

function reheat() {
  // Перетаскивание будит уже остывшую симуляцию — без этого граф после
  // первого успокоения навсегда становится статичным опять, что и было
  // исходной жалобой на «недостаточно динамичный» граф.
  if (!raf) runSimulation();
}

// ── Панорамирование, зум, перетаскивание узлов, клик ──
let dragState = null;

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
      // держим точку под курсором на месте, а не центр — привычнее, чем
      // зум «от нуля координат»
      view.x += (after.x - before.x) * view.scale;
      view.y += (after.y - before.y) * view.scale;
      applyView();
    },
    { passive: false }
  );

  let panStart = null;
  svg.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".graph-node")) return; // узлы обрабатывают своё перетаскивание отдельно
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

  for (const n of nodes) {
    const g = nodeEls.get(n.id);
    g.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      const start = toGraphPoint(e.clientX, e.clientY);
      dragState = { id: n.id, moved: false, offX: start.x - n.x, offY: start.y - n.y };
      n.dragging = true;
      g.setPointerCapture(e.pointerId);
      reheat();
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
        document.dispatchEvent(new CustomEvent("fictaris:open-entity", { detail: { type: n.type, id: n.id } }));
      }
    };
    g.addEventListener("pointerup", endDrag);
    g.addEventListener("pointercancel", endDrag);
  }

  const resetBtn = container.querySelector(".graph-reset-btn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      view.x = 0;
      view.y = 0;
      view.scale = 1;
      applyView();
    });
  }

  applyView();
}

function highlight(id, lineByNode, nodeEls) {
  const connected = new Set([id]);
  for (const line of lineByNode.get(id) || []) {
    line.setAttribute("stroke", "var(--accent)");
    line.setAttribute("stroke-width", "2.5");
    connected.add(line.dataset.a);
    connected.add(line.dataset.b);
  }
  for (const [nid, g] of nodeEls) {
    g.style.opacity = connected.has(nid) ? "1" : "0.25";
  }
}

function resetHighlight(lineByNode, nodeEls) {
  for (const lines of lineByNode.values()) {
    for (const line of lines) {
      line.setAttribute("stroke", "var(--border)");
      line.setAttribute("stroke-width", "1.5");
    }
  }
  for (const g of nodeEls.values()) g.style.opacity = "1";
}

function buildToolbar() {
  const bar = document.createElement("div");
  bar.className = "graph-toolbar";

  const hint = document.createElement("span");
  hint.className = "graph-hint";
  hint.textContent = i18n("Тащи узлы мышью, крути колесо для зума, клик открывает карточку");
  bar.appendChild(hint);

  const resetBtn = document.createElement("button");
  resetBtn.className = "btn graph-reset-btn";
  resetBtn.textContent = i18n("Сбросить вид");
  bar.appendChild(resetBtn);

  return bar;
}

function buildLegend() {
  const legend = document.createElement("div");
  legend.className = "graph-legend";
  legend.innerHTML = `
    <span><span class="legend-dot" style="background:#c9944a"></span>${i18n("Персонажи")}</span>
    <span><span class="legend-dot" style="background:#6a8fae"></span>${i18n("Локации/фракции — цвет по типу")}</span>
  `;
  return legend;
}
