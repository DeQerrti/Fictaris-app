import { apiGet, apiPost, uid } from "./api.js";
import { i18n } from "./i18n.js";
import { openEntityModal } from "./entity-modal.js";

// ══════════════════════════════════════════════
//  РОДОСЛОВНАЯ
//
//  Отдельно от общего графа связей (graph.js — все сущности разом,
//  без направления): здесь только персонажи и только связь
//  «родитель → ребёнок» (character.parentIds, задаётся в карточке
//  персонажа), уложенная по поколениям сверху вниз, как и положено
//  генеалогическому дереву.
//
//  Раньше это была голая витрина — только чтение, нельзя было ни
//  добавить, ни отредактировать персонажа прямо тут. Теперь можно:
//  «+ Добавить персонажа» заводит нового и сразу открывает его
//  карточку модалкой (entity-modal.js) для имени/родителей, клик по
//  уже существующему узлу открывает ту же модалку на нём — дерево
//  перерисовывается сразу после закрытия (см. onClose).
//
//  Несколько родов — не отдельная сущность в данных, а отдельные
//  связные компоненты графа parentIds (два рода, между которыми нет ни
//  одной связи «родитель-ребёнок», технически и есть два разных рода):
//  раньше все они рисовались вперемешку в одной координатной сетке,
//  теперь каждый — отдельная подписанная карточка с собственной
//  раскладкой.
// ══════════════════════════════════════════════

let root = null;
let characters = [];

const PALETTE = [
  "#c9944a", "#4f7d74", "#a4483c", "#7d6a9e",
  "#6a8fae", "#9a9250", "#b5636b", "#5a8a5f",
];

function computeDepths(list) {
  const byId = new Map(list.map((c) => [c.id, c]));
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

  for (const c of list) depthOf(c.id, new Set());
  return depth;
}

// Связные компоненты по parentIds — отдельный род, если ни один
// персонаж одной группы не является родителем/ребёнком персонажа
// другой (напрямую или через цепочку).
function connectedComponents(list) {
  const byId = new Map(list.map((c) => [c.id, c]));
  const adj = new Map(list.map((c) => [c.id, new Set()]));
  for (const c of list) {
    for (const p of c.parentIds || []) {
      if (!byId.has(p)) continue;
      adj.get(c.id).add(p);
      adj.get(p).add(c.id);
    }
  }
  const seen = new Set();
  const groups = [];
  for (const c of list) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const stack = [c.id];
    const group = [];
    while (stack.length) {
      const id = stack.pop();
      group.push(byId.get(id));
      for (const nb of adj.get(id)) {
        if (!seen.has(nb)) {
          seen.add(nb);
          stack.push(nb);
        }
      }
    }
    groups.push(group);
  }
  groups.sort((a, b) => b.length - a.length); // крупные роды сверху
  return groups;
}

// Модалка (characters.js) правит и сохраняет свой собственный, отдельный
// от этого модуля список персонажей — после закрытия нужно перечитать
// его заново с диска, а не просто перерисовать дерево по уже устаревшим
// characters, иначе правки в модалке (имя, родители) не появятся здесь
// до следующего полного открытия вкладки.
async function refresh() {
  characters = await apiGet("/api/characters");
  draw();
}

function openCharacter(id) {
  openEntityModal("characters", id, { onClose: refresh });
}

async function addCharacter() {
  const c = {
    id: uid(),
    name: i18n("Новый персонаж"),
    color: PALETTE[characters.length % PALETTE.length],
    role: "", age: "", appearance: "", personality: "",
    motivation: "", goal: "", flaws: "", backstory: "", tags: "",
    parentIds: [],
  };
  characters.push(c);
  await apiPost("/api/characters", characters);
  openCharacter(c.id);
}

function buildTreeCard(list, index) {
  const depth = computeDepths(list);
  const rows = new Map();
  for (const c of list) {
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
  for (const [d, rowList] of rows) {
    const rowWidth = rowList.length * COL_W;
    const startX = centerX - rowWidth / 2 + COL_W / 2;
    rowList.forEach((c, i) => {
      pos[c.id] = { x: startX + i * COL_W, y: TOP + d * ROW_H };
    });
  }

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  for (const c of list) {
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

  for (const c of list) {
    const p = pos[c.id];
    const g = document.createElementNS(svgNS, "g");
    g.classList.add("ftree-node");
    g.style.cursor = "pointer";

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

    g.addEventListener("click", () => openCharacter(c.id));
    svg.appendChild(g);
  }

  const holder = document.createElement("div");
  holder.className = "graph-holder";
  holder.style.overflowX = "auto";
  holder.appendChild(svg);

  const card = document.createElement("div");
  card.className = "ftree-card";

  const roots = (rows.get(0) || []).map((c) => c.name || i18n("Без имени"));
  const title = document.createElement("div");
  title.className = "ftree-card-title";
  title.textContent = list.length > 1 ? roots.join(" · ") : i18n("Род {n}", { n: index + 1 });
  card.appendChild(title);

  card.appendChild(holder);
  return card;
}

function draw() {
  root.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "ftree-wrap";

  const toolbar = document.createElement("div");
  toolbar.className = "ftree-toolbar";
  const addBtn = document.createElement("button");
  addBtn.className = "btn";
  addBtn.textContent = i18n("+ Добавить персонажа");
  addBtn.addEventListener("click", addCharacter);
  const hint = document.createElement("span");
  hint.className = "ftree-hint";
  hint.textContent = i18n("Клик по узлу открывает карточку — родителей назначают там же.");
  toolbar.append(addBtn, hint);
  wrap.appendChild(toolbar);

  const hasChild = new Set();
  for (const c of characters) for (const p of c.parentIds || []) hasChild.add(p);
  const inTree = characters.filter((c) => (c.parentIds || []).length || hasChild.has(c.id));

  if (!inTree.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = i18n("Пока пусто — укажи родителей в карточке персонажа (или добавь нового прямо здесь), чтобы здесь появилось дерево.");
    wrap.appendChild(empty);
    root.appendChild(wrap);
    return;
  }

  const groups = connectedComponents(inTree);
  groups.forEach((group, i) => wrap.appendChild(buildTreeCard(group, i)));

  root.appendChild(wrap);
}

export async function renderFamilyTree(rootEl) {
  root = rootEl;
  characters = await apiGet("/api/characters");
  draw();
}
