import { apiGet } from "./api.js";
import { escapeHtml } from "./chips.js";
import { locationTypeInfo, factionTypeInfo, iconSvg } from "./icons.js";

let nodes = [];
let edges = [];
let container = null;

function buildNodes(characters, locations, factions) {
  const list = [];
  for (const c of characters) list.push({ id: c.id, name: c.name, color: c.color || "#7c7157", icon: null });
  for (const l of locations) {
    const [, , icon, color] = locationTypeInfo(l.type);
    list.push({ id: l.id, name: l.name, color, icon });
  }
  for (const f of factions) {
    const [, , icon, color] = factionTypeInfo(f.type);
    list.push({ id: f.id, name: f.name, color, icon });
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
    empty.textContent = "Добавь персонажей, локаций или фракций, чтобы увидеть граф проекта.";
    container.appendChild(empty);
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "graph-view";

  const size = Math.max(480, Math.min(760, 140 + nodes.length * 26));
  const r = size / 2 - 60;
  const cx = size / 2;
  const cy = size / 2;

  const pos = {};
  nodes.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
    pos[n.id] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);

  const lineByNode = new Map();
  for (const e of edges) {
    const a = pos[e.a];
    const b = pos[e.b];
    if (!a || !b) continue;
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", a.x);
    line.setAttribute("y1", a.y);
    line.setAttribute("x2", b.x);
    line.setAttribute("y2", b.y);
    line.setAttribute("stroke", "var(--border)");
    line.setAttribute("stroke-width", "1.5");
    line.dataset.a = e.a;
    line.dataset.b = e.b;
    svg.appendChild(line);
    for (const id of [e.a, e.b]) {
      if (!lineByNode.has(id)) lineByNode.set(id, []);
      lineByNode.get(id).push(line);
    }
  }

  const nodeEls = new Map();
  for (const n of nodes) {
    const p = pos[n.id];
    const g = document.createElementNS(svgNS, "g");
    g.style.cursor = "default";

    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("cx", p.x);
    circle.setAttribute("cy", p.y);
    circle.setAttribute("r", 14);
    circle.setAttribute("fill", n.color);
    g.appendChild(circle);

    if (n.icon) {
      const fo = document.createElementNS(svgNS, "foreignObject");
      fo.setAttribute("x", p.x - 9);
      fo.setAttribute("y", p.y - 9);
      fo.setAttribute("width", 18);
      fo.setAttribute("height", 18);
      fo.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" style="color:#14110d">${iconSvg(n.icon, 18)}</div>`;
      g.appendChild(fo);
    }

    const text = document.createElementNS(svgNS, "text");
    text.setAttribute("x", p.x);
    text.setAttribute("y", p.y + 26);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", "#a99977");
    text.setAttribute("font-size", "11");
    text.setAttribute("font-family", "Inter,sans-serif");
    text.textContent = n.name || "?";
    g.appendChild(text);

    g.addEventListener("mouseenter", () => highlight(n.id, lineByNode, nodeEls));
    g.addEventListener("mouseleave", () => resetHighlight(lineByNode, nodeEls));

    svg.appendChild(g);
    nodeEls.set(n.id, g);
  }

  const holder = document.createElement("div");
  holder.className = "graph-holder";
  holder.appendChild(svg);
  wrap.appendChild(holder);
  wrap.appendChild(buildLegend());
  container.appendChild(wrap);
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

function buildLegend() {
  const legend = document.createElement("div");
  legend.className = "graph-legend";
  legend.innerHTML = `
    <span><span class="legend-dot" style="background:#c9944a"></span>Персонажи</span>
    <span><span class="legend-dot" style="background:#6a8fae"></span>Локации/фракции — цвет по типу</span>
  `;
  return legend;
}
