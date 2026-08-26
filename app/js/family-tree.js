import { apiGet } from "./api.js";
import { i18n } from "./i18n.js";

// ══════════════════════════════════════════════
//  ДЕРЕВО РОДСТВА
//
//  Отдельно от общего графа связей (graph.js — все сущности разом,
//  без направления): здесь только персонажи и только связь
//  «родитель → ребёнок» (character.parentIds, задаётся в карточке
//  персонажа), уложенная по поколениям сверху вниз, как и положено
//  генеалогическому дереву. Позиции считаются заранее (поколение × шаг),
//  а не измеряются через getBoundingClientRect — тот же приём, что у
//  graph.js с его круговой раскладкой.
//
//  Персонажи вне семейных связей (нет ни родителей, ни детей) в дерево
//  не попадают — это не общий список персонажей, а именно родословная.
// ══════════════════════════════════════════════

function computeDepths(characters) {
  const byId = new Map(characters.map((c) => [c.id, c]));
  const depth = new Map();

  function depthOf(id, stack) {
    if (depth.has(id)) return depth.get(id);
    if (stack.has(id)) return 0; // цикл в данных (ошиблись при выборе родителя) — не зависать
    stack.add(id);
    const c = byId.get(id);
    const parents = (c?.parentIds || []).filter((p) => byId.has(p));
    const d = parents.length ? 1 + Math.max(...parents.map((p) => depthOf(p, stack))) : 0;
    stack.delete(id);
    depth.set(id, d);
    return d;
  }

  for (const c of characters) depthOf(c.id, new Set());
  return depth;
}

export async function renderFamilyTree(root) {
  root.innerHTML = "";
  const characters = await apiGet("/api/characters");

  const hasChild = new Set();
  for (const c of characters) for (const p of c.parentIds || []) hasChild.add(p);
  const inTree = characters.filter((c) => (c.parentIds || []).length || hasChild.has(c.id));

  if (!inTree.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = i18n("Пока пусто — укажи родителей в карточке персонажа, чтобы здесь появилось дерево.");
    root.appendChild(empty);
    return;
  }

  const depth = computeDepths(inTree);
  const rows = new Map();
  for (const c of inTree) {
    const d = depth.get(c.id);
    if (!rows.has(d)) rows.set(d, []);
    rows.get(d).push(c);
  }
  const maxDepth = Math.max(...rows.keys());

  const ROW_H = 130;
  const COL_W = 150;
  const TOP = 50;
  const rowWidths = [...rows.values()].map((r) => r.length * COL_W);
  const width = Math.max(400, Math.max(...rowWidths) + COL_W);
  const height = TOP + (maxDepth + 1) * ROW_H;
  const centerX = width / 2;

  const pos = {};
  for (const [d, list] of rows) {
    const rowWidth = list.length * COL_W;
    const startX = centerX - rowWidth / 2 + COL_W / 2;
    list.forEach((c, i) => {
      pos[c.id] = { x: startX + i * COL_W, y: TOP + d * ROW_H };
    });
  }

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  for (const c of inTree) {
    const to = pos[c.id];
    for (const parentId of c.parentIds || []) {
      const from = pos[parentId];
      if (!from) continue;
      const path = document.createElementNS(svgNS, "path");
      const midY = (from.y + to.y) / 2;
      path.setAttribute("d", `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "var(--border)");
      path.setAttribute("stroke-width", "1.5");
      svg.appendChild(path);
    }
  }

  for (const c of inTree) {
    const p = pos[c.id];
    const g = document.createElementNS(svgNS, "g");

    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("cx", p.x);
    circle.setAttribute("cy", p.y);
    circle.setAttribute("r", 18);
    circle.setAttribute("fill", c.color || "#7c7157");
    g.appendChild(circle);

    const initial = document.createElementNS(svgNS, "text");
    initial.setAttribute("x", p.x);
    initial.setAttribute("y", p.y + 5);
    initial.setAttribute("text-anchor", "middle");
    initial.setAttribute("fill", "#14110d");
    initial.setAttribute("font-size", "13");
    initial.setAttribute("font-weight", "600");
    initial.setAttribute("font-family", "Inter,sans-serif");
    initial.textContent = (c.name || "?").trim().slice(0, 1).toUpperCase();
    g.appendChild(initial);

    const text = document.createElementNS(svgNS, "text");
    text.setAttribute("x", p.x);
    text.setAttribute("y", p.y + 34);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", "#a99977");
    text.setAttribute("font-size", "11");
    text.setAttribute("font-family", "Inter,sans-serif");
    text.textContent = c.name || "?";
    g.appendChild(text);

    svg.appendChild(g);
  }

  const holder = document.createElement("div");
  holder.className = "graph-holder";
  holder.appendChild(svg);

  const wrap = document.createElement("div");
  wrap.className = "graph-view";
  wrap.appendChild(holder);
  root.appendChild(wrap);
}
