import { apiGet, apiPost, uid } from "./api.js";
import { i18n } from "./i18n.js";
import { openEntityModal } from "./entity-modal.js";
import { buildEmptyState, escapeHtml } from "./chips.js";
import { avatarInnerHtml } from "./avatars.js";

// ══════════════════════════════════════════════
//  РОДОСЛОВНАЯ
//
//  Отдельно от общего графа связей (graph.js — все сущности разом, без
//  направления, force-layout): здесь только персонажи, только
//  «родитель → ребёнок» (character.parentIds) и «партнёр ↔ партнёр»
//  (character.partnerIds, симметрично — правится в дровере персонажа
//  вместе с родителями, characters.js), уложенные по поколениям сверху
//  вниз, как в настоящем генеалогическом дереве:
//   — пара стоит в ряду рядом, соединённая горизонтальной чертой брака,
//     а не двумя расползающимися к детям диагоналями по отдельности;
//   — партнёр с более короткой цепочкой предков подтягивается на ряд
//     ниже (партнёр разного "поколения" — обычное дело) вниз, к более
//     "старшему" партнёру — пара всегда на одном ряду, дети всегда
//     строго ниже обоих;
//   — приёмный родитель (character.adoptiveParentIds, подмножество
//     parentIds) рисует связь пунктиром, а не сплошной линией;
//   — тёти/дяди/внуки/двоюродные — не отдельные данные, а то, что само
//     проступает на достаточно большом дереве из тех же parentIds/
//     partnerIds несколько поколений подряд.
//
//  Несколько родов — не отдельная сущность в данных, а отдельные связные
//  компоненты графа parentIds+partnerIds (два рода, между которыми нет
//  ни одной связи «родитель-ребёнок» и ни одного брака — технически и
//  есть два разных рода): каждый — отдельная подписанная карточка со
//  своей раскладкой.
// ══════════════════════════════════════════════

let root = null;
let characters = [];

const PALETTE = [
  "#c9944a", "#4f7d74", "#a4483c", "#7d6a9e",
  "#6a8fae", "#9a9250", "#b5636b", "#5a8a5f",
];

const NODE_R = 20;
const SLOT_W = 100;
const UNIT_GAP = 46;
const ROW_H = 150;
const TOP = 60;
const MARGIN = 60;

// ── Данные ────────────────────────────────────

// Глубина (поколение) — самый длинный путь от предка без родителей в
// дереве. Пара после этого выравнивается по большей из двух глубин —
// иначе партнёр с более долгой родословной оказался бы на своём ряду
// отдельно от супруга.
function computeDepths(list, byId) {
  const depth = new Map();
  function depthOf(id, stack) {
    if (depth.has(id)) return depth.get(id);
    if (stack.has(id)) return 0; // цикл в данных — не зависать
    stack.add(id);
    const c = byId.get(id);
    const parents = (c?.parentIds || []).filter((p) => byId.has(p));
    const d = parents.length ? 1 + Math.max(...parents.map((p) => depthOf(p, stack))) : 0;
    stack.delete(id);
    depth.set(id, d);
    return d;
  }
  for (const c of list) depthOf(c.id, new Set());

  let changed = true;
  while (changed) {
    changed = false;
    for (const c of list) {
      for (const pid of c.partnerIds || []) {
        if (!byId.has(pid)) continue;
        const max = Math.max(depth.get(c.id), depth.get(pid));
        if (depth.get(c.id) !== max) { depth.set(c.id, max); changed = true; }
        if (depth.get(pid) !== max) { depth.set(pid, max); changed = true; }
      }
    }
  }
  return depth;
}

// Связные компоненты по parentIds И partnerIds — женитьба объединяет два
// рода в один точно так же, как общий ребёнок: цепочку читаем и вверх
// (родители), и вбок (партнёры), не только вниз.
function connectedComponents(list) {
  const byId = new Map(list.map((c) => [c.id, c]));
  const adj = new Map(list.map((c) => [c.id, new Set()]));
  for (const c of list) {
    for (const p of c.parentIds || []) {
      if (!byId.has(p)) continue;
      adj.get(c.id).add(p);
      adj.get(p).add(c.id);
    }
    for (const p of c.partnerIds || []) {
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

// Взаимные пары ("муж считает жену партнёром" И наоборот — иначе не
// отличить настоящую пару от одностороннего недосмотра при выборе).
function mutualUnions(list, byId) {
  const seen = new Set();
  const unions = [];
  for (const c of list) {
    for (const pid of c.partnerIds || []) {
      const other = byId.get(pid);
      if (!other || !(other.partnerIds || []).includes(c.id)) continue;
      const key = [c.id, pid].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      unions.push({ a: c.id, b: pid });
    }
  }
  return unions;
}

function sharedChildrenCount(aId, bId, list) {
  let n = 0;
  for (const c of list) {
    const p = c.parentIds || [];
    if (p.includes(aId) && p.includes(bId)) n++;
  }
  return n;
}

// Каждому персонажу — не больше одного "соседа по ряду" для раскладки:
// при нескольких браках в ряду рядом окажется только один партнёр,
// остальные всё равно нарисуются чертой брака (см. unions в
// buildTreeCard), просто без места рядом в сетке — рисовать трёх и
// более "соседей" в одномерном ряду одновременно физически некуда.
// Выбирается партнёр с наибольшим числом общих детей — именно от этой
// пары зависит, где в ряду окажутся дети, так что для раскладки эта
// связь важнее, чем более ранний по очереди в данных, но бездетный
// брак. Без детей ни у одной пары — первый по порядку, как и раньше.
function primaryPartnerOf(unions, list) {
  const byPerson = new Map();
  for (const u of unions) {
    if (!byPerson.has(u.a)) byPerson.set(u.a, []);
    if (!byPerson.has(u.b)) byPerson.set(u.b, []);
    const kids = sharedChildrenCount(u.a, u.b, list);
    byPerson.get(u.a).push({ other: u.b, kids });
    byPerson.get(u.b).push({ other: u.a, kids });
  }
  const primary = new Map();
  for (const [id, partners] of byPerson) {
    partners.sort((a, b) => b.kids - a.kids);
    primary.set(id, partners[0].other);
  }
  return primary;
}

// ── Раскладка ─────────────────────────────────

function buildUnits(list, depth, primary) {
  const rows = new Map(); // depth -> unit[]
  const placed = new Set();
  for (const c of list) {
    if (placed.has(c.id)) continue;
    const d = depth.get(c.id);
    const partnerId = primary.get(c.id);
    let members;
    if (partnerId && !placed.has(partnerId) && depth.get(partnerId) === d && list.some((x) => x.id === partnerId)) {
      members = [c.id, partnerId];
      placed.add(partnerId);
    } else {
      members = [c.id];
    }
    placed.add(c.id);
    if (!rows.has(d)) rows.set(d, []);
    rows.get(d).push({ members });
  }
  return rows;
}

function barycenter(unit, byId, pos) {
  const xs = [];
  for (const m of unit.members) {
    for (const pid of byId.get(m)?.parentIds || []) {
      const p = pos.get(pid);
      if (p) xs.push(p.x);
    }
  }
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Infinity;
}

// pos: id -> {x,y}px. Желаемый x ряда d>0 — барицентр уже размещённых
// родителей (честное центрирование под серединой родителей, а не
// просто "тот же порядок с фиксированным шагом"); единицы без известных
// родителей в этом дереве идут в конец. Минимальный отступ по ходу
// слева направо соблюдается принудительным сдвигом вправо — порядок,
// заданный барицентром, при этом не портится, просто где тесно, там
// раскладка чуть менее строго центрирована, а не наезжает друг на друга.
function layout(rows, byId) {
  const maxDepth = Math.max(...rows.keys());
  const pos = new Map();

  for (let d = 0; d <= maxDepth; d++) {
    const units = rows.get(d) || [];
    const withDesired = units.map((u) => ({ u, x: d > 0 ? barycenter(u, byId, pos) : Infinity }));
    withDesired.sort((a, b) => a.x - b.x);

    let prevRight = -Infinity;
    const y = TOP + d * ROW_H;
    for (const { u, x } of withDesired) {
      const width = u.members.length === 2 ? SLOT_W * 2 : SLOT_W;
      const half = width / 2;
      const minX = prevRight === -Infinity ? half : prevRight + UNIT_GAP + half;
      const unitX = Number.isFinite(x) ? Math.max(x, minX) : minX;
      if (u.members.length === 2) {
        pos.set(u.members[0], { x: unitX - SLOT_W / 2, y });
        pos.set(u.members[1], { x: unitX + SLOT_W / 2, y });
      } else {
        pos.set(u.members[0], { x: unitX, y });
      }
      prevRight = unitX + half;
    }
  }
  return { pos, maxDepth };
}

// Для ребёнка — какими "пучками" рисовать связи к родителям: пара из
// unions, оба входящих в parentIds, схлопывается в одну линию от
// середины брака, а не в две отдельные от каждого родителя порознь;
// родитель вне признанного брака (одиночное усыновление, неизвестный
// второй родитель) — как раньше, отдельной линией от себя самого.
function edgesForChild(child, unions) {
  const parentIds = new Set(child.parentIds || []);
  const covered = new Set();
  const bundles = [];
  for (const u of unions) {
    if (parentIds.has(u.a) && parentIds.has(u.b)) {
      bundles.push({ kind: "union", a: u.a, b: u.b });
      covered.add(u.a);
      covered.add(u.b);
    }
  }
  for (const pid of parentIds) {
    if (!covered.has(pid)) bundles.push({ kind: "solo", a: pid });
  }
  return bundles;
}

function isAdoptiveEdge(child, bundle) {
  const adoptive = new Set(child.adoptiveParentIds || []);
  if (bundle.kind === "solo") return adoptive.has(bundle.a);
  return adoptive.has(bundle.a) || adoptive.has(bundle.b);
}

// ── Данные/действия ───────────────────────────

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
    parentIds: [], adoptiveParentIds: [], partnerIds: [],
  };
  characters.push(c);
  await apiPost("/api/characters", characters);
  openCharacter(c.id);
}

// ── Отрисовка одной карточки рода ─────────────

function buildTreeCard(list, index) {
  const byId = new Map(list.map((c) => [c.id, c]));
  const depth = computeDepths(list, byId);
  const unions = mutualUnions(list, byId);
  const primary = primaryPartnerOf(unions, list);
  const rows = buildUnits(list, depth, primary);
  const { pos, maxDepth } = layout(rows, byId);

  // Общий bounding box — по всем узлам сразу, плюс запас слева под
  // подпись поколения и справа/снизу под подписи имён.
  let minX = Infinity, maxX = -Infinity;
  for (const p of pos.values()) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
  }
  const shiftX = MARGIN - minX;
  for (const p of pos.values()) p.x += shiftX;
  const width = maxX - minX + MARGIN * 2;
  const height = TOP + (maxDepth + 1) * ROW_H;

  // Сама SVG — окно фиксированного размера (как у графа проекта,
  // graph.js), а не растянутое под весь контент: контент какой угодно
  // ширины/высоты панорамируется и масштабируется внутри него через
  // transform на viewport-группу (attachTreeInteraction ниже), а не
  // через нативный скролл контейнера.
  const viewportW = Math.max(520, (root?.clientWidth || 900) - 80);
  const viewportH = Math.min(480, Math.max(280, height));

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${viewportW} ${viewportH}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.classList.add("ftree-svg");

  const viewport = document.createElementNS(svgNS, "g");
  viewport.classList.add("ftree-viewport");
  svg.appendChild(viewport);

  // Подписи поколений — слева от самого левого узла своего ряда, внутри
  // того же SVG (едет вместе с рядом при горизонтальном скролле, а не
  // остаётся приклеенной к краю пустого места).
  for (let d = 0; d <= maxDepth; d++) {
    const rowXs = [...pos.entries()].filter(([id]) => depth.get(id) === d).map(([, p]) => p.x);
    if (!rowXs.length) continue;
    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("x", Math.min(...rowXs) - NODE_R - 14);
    label.setAttribute("y", TOP + d * ROW_H + 5);
    label.setAttribute("text-anchor", "end");
    label.setAttribute("fill", "var(--text-faint)");
    label.setAttribute("font-size", "11");
    label.setAttribute("font-family", "Inter,sans-serif");
    label.textContent = i18n("Поколение {n}", { n: d + 1 });
    viewport.appendChild(label);
  }

  // Черта брака — между обоими партнёрами одного признанного союза, где
  // бы они в итоге ни оказались (у второстепенного брака при нескольких
  // партнёрах это может быть не соседняя пара в ряду, а через пробел).
  for (const u of unions) {
    const a = pos.get(u.a);
    const b = pos.get(u.b);
    if (!a || !b || a.y !== b.y) continue;
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", a.x);
    line.setAttribute("y1", a.y);
    line.setAttribute("x2", b.x);
    line.setAttribute("y2", b.y);
    line.setAttribute("stroke", "var(--accent)");
    line.setAttribute("stroke-width", "2");
    viewport.appendChild(line);
  }

  // Связи к детям — пучками (см. edgesForChild): один плавный путь от
  // середины брака или от одиночного родителя, пунктир — если это
  // усыновление (adoptiveParentIds).
  for (const c of list) {
    if (!(c.parentIds || []).length) continue;
    const to = pos.get(c.id);
    if (!to) continue;
    for (const bundle of edgesForChild(c, unions)) {
      const from =
        bundle.kind === "union"
          ? { x: (pos.get(bundle.a).x + pos.get(bundle.b).x) / 2, y: pos.get(bundle.a).y }
          : pos.get(bundle.a);
      if (!from) continue;
      const path = document.createElementNS(svgNS, "path");
      const midY = (from.y + to.y) / 2;
      path.setAttribute("d", `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "var(--border)");
      path.setAttribute("stroke-width", "1.5");
      if (isAdoptiveEdge(c, bundle)) path.setAttribute("stroke-dasharray", "5 4");
      viewport.appendChild(path);
    }
  }

  // Узлы — аватарка (или инициал, если изображения нет) в круге, имя
  // подписью снизу, клик открывает карточку модалкой.
  for (const c of list) {
    const p = pos.get(c.id);
    const g = document.createElementNS(svgNS, "g");
    g.classList.add("ftree-node");
    g.style.cursor = "pointer";

    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("cx", p.x);
    circle.setAttribute("cy", p.y);
    circle.setAttribute("r", NODE_R);
    circle.setAttribute("fill", c.color || "#7c7157");
    g.appendChild(circle);

    const fo = document.createElementNS(svgNS, "foreignObject");
    fo.setAttribute("x", p.x - NODE_R);
    fo.setAttribute("y", p.y - NODE_R);
    fo.setAttribute("width", NODE_R * 2);
    fo.setAttribute("height", NODE_R * 2);
    const initial = (c.name || "?").trim().slice(0, 1).toUpperCase();
    fo.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" class="ftree-node-avatar">${avatarInnerHtml(
      c,
      `<span>${escapeHtml(initial)}</span>`
    )}</div>`;
    g.appendChild(fo);

    const text = document.createElementNS(svgNS, "text");
    text.setAttribute("x", p.x);
    text.setAttribute("y", p.y + NODE_R + 16);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", "#a99977");
    text.setAttribute("font-size", "11");
    text.setAttribute("font-family", "Inter,sans-serif");
    text.textContent = c.name || i18n("Без имени");
    g.appendChild(text);

    g.addEventListener("click", () => openCharacter(c.id));
    viewport.appendChild(g);
  }

  const holder = document.createElement("div");
  holder.className = "graph-holder";
  holder.style.height = `${viewportH}px`;
  holder.appendChild(svg);
  attachTreeInteraction(svg, viewport, viewportW, viewportH);

  const card = document.createElement("div");
  card.className = "ftree-card";

  const roots = (rows.get(0) || []).flatMap((u) => u.members).map((id) => byId.get(id)?.name || i18n("Без имени"));
  const title = document.createElement("div");
  title.className = "ftree-card-title";
  title.textContent = list.length > 1 ? roots.join(" · ") : i18n("Род {n}", { n: index + 1 });
  card.appendChild(title);

  card.appendChild(holder);
  return card;
}

// Панорамирование перетаскиванием фона + зум колесом — тот же приём,
// что и в графе проекта (graph.js): view = {x,y,scale}, transform на
// viewport-группу, пересчёт клика через getBoundingClientRect. Узлы
// (.ftree-node) сами по себе не перетаскиваются — только клик, поэтому
// им достаточно не запускать панораму под собой, отдельного
// pointerdown-обработчика на каждом узле, в отличие от graph.js, не
// нужно.
function attachTreeInteraction(svg, viewport, width, height) {
  const view = { x: 0, y: 0, scale: 1 };
  const MIN_SCALE = 0.4;
  const MAX_SCALE = 2.5;

  function applyView() {
    viewport.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.scale})`);
  }

  function toPoint(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    const sx = ((clientX - rect.left) / rect.width) * width;
    const sy = ((clientY - rect.top) / rect.height) * height;
    return { x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale };
  }

  svg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const before = toPoint(e.clientX, e.clientY);
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      view.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * delta));
      const after = toPoint(e.clientX, e.clientY);
      view.x += (after.x - before.x) * view.scale;
      view.y += (after.y - before.y) * view.scale;
      applyView();
    },
    { passive: false }
  );

  let panStart = null;
  svg.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".ftree-node")) return;
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
    panStart = null;
    svg.classList.remove("panning");
  };
  svg.addEventListener("pointerup", endPan);
  svg.addEventListener("pointerleave", endPan);

  applyView();
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
  hint.textContent = i18n(
    "Тащи фон – панорама, колесо – зум, клик по узлу открывает карточку – родителей и партнёров назначают там же. Пунктир – усыновление."
  );
  toolbar.append(addBtn, hint);
  wrap.appendChild(toolbar);

  const hasChild = new Set();
  for (const c of characters) for (const p of c.parentIds || []) hasChild.add(p);
  const inTree = characters.filter(
    (c) => (c.parentIds || []).length || hasChild.has(c.id) || (c.partnerIds || []).length
  );

  if (!inTree.length) {
    const empty = buildEmptyState(
      i18n("Пока пусто – укажи родителей/партнёров в карточке персонажа (или добавь нового прямо здесь), чтобы здесь появилось дерево."),
      "tree"
    );
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
