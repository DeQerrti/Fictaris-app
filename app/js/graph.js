import { apiGet, apiPost, uid } from "./api.js";
import { iconSvg } from "./icons.js";
import { buildEmptyState } from "./chips.js";
import { debounceSave } from "./save-badge.js";
import { pushTrash } from "./trash.js";
import { openPopover, closeMenu } from "./context-menu.js";
import { familyComponents, surnameHouseName, partnerKind, isDead } from "./kinship.js";
import { personAvatarHtml, shortName, readPref, writePref, buildSegmented } from "./entity-view.js";
import { i18n, i18nPlural } from "./i18n.js";

// ══════════════════════════════════════════════
//  ОТНОШЕНИЯ
//
//  Карта отношений между персонажами (модуль по-прежнему "graph" —
//  ради порядка вкладок и подписей, уже сохранённых в настройках).
//  Персонажи стоят рамками по родам (внутри — поколения и пары, как
//  маленькая родословная) или по фракциям, а записи relationships.json
//  идут дугами между ними: цвет — близость или вражда, толщина — сила,
//  на дуге подпись. Протянуть от одного персонажа к другому — новое
//  отношение, щелчок по дуге — правка. Места и фракции здесь не
//  узлы: у них свои вкладки, а прежний «граф всего» повторял их.
// ══════════════════════════════════════════════

const GROUP_KEY = "fictaris_graph_group";
const GROUPS = [
  ["house", "По родам", "Рамки – рода, внутри поколения и пары"],
  ["faction", "По фракциям", "Рамки – фракции, глава первым"],
];

const NS = "http://www.w3.org/2000/svg";
const COL_W = 132;
const ROW_H = 118;
const BOX_GAP = 70;
const BOX_PAD = 20;
const BOX_HEAD = 44;
const MAX_ROW_W = 1500;
const LOOSE_COLS = 4;
const FAMILY_COLOR = "#c9944a";

let container = null;
let characters = [];
let relationships = [];
let factions = [];
let groupBy = readPref(GROUP_KEY, GROUPS.map(([k]) => k), "house");
let query = "";
let selectedId = null;
let view = null; // { x, y, scale } — сдвиг и масштаб сцены, переживает перерисовку
let viewTouched = false; // двигал ли человек сцену — иначе при смене размера вписываем заново
let stageEl = null;
let sideEl = null;
let metaEl = null;
let scene = null; // { pos, boxes, bounds } — последняя раскладка
let stopResizeWatch = null;

const saveRelationships = debounceSave((list) => apiPost("/api/relationships", list));

export async function renderGraph(root) {
  container = root;
  [characters, relationships, factions] = await Promise.all([
    apiGet("/api/characters"),
    apiGet("/api/relationships"),
    apiGet("/api/factions"),
  ]);
  if (selectedId && !characters.some((c) => c.id === selectedId)) selectedId = null;
  view = null;
  viewTouched = false;
  buildShell();
}

const byId = (id) => characters.find((c) => c.id === id);
const relsOf = (id) => relationships.filter((r) => r.charA === id || r.charB === id);
const otherOf = (r, id) => (r.charA === id ? r.charB : r.charA);
const scoreText = (s) => `${s > 0 ? "+" : ""}${s || 0}`;

function scoreColor(s) {
  if (s >= 30) return "#6fa772";
  if (s <= -30) return "#c25a4c";
  return "#a99977";
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
}

function svgEl(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

function isMain(c) {
  const tags = (c.tags || "").split(",").map((t) => t.trim());
  return tags.some((t) => ["Протагонист", "Антагонист", "Рассказчик"].includes(t));
}

// ── Шапка и каркас ─────────────────────────────
function buildShell() {
  container.innerHTML = "";
  if (!characters.length) {
    container.appendChild(buildEmptyState(i18n("Добавь персонажей, чтобы увидеть их отношения."), "network"));
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "relmap-view";

  const bar = document.createElement("div");
  bar.className = "timeline-toolbar";
  const heading = document.createElement("div");
  heading.className = "timeline-heading";
  heading.textContent = i18n("Отношения");
  metaEl = document.createElement("div");
  metaEl.className = "timeline-meta";
  const seg = buildSegmented(GROUPS, groupBy, (key) => {
    groupBy = key;
    writePref(GROUP_KEY, key);
    view = null;
    viewTouched = false;
    buildShell();
  });
  const spacer = document.createElement("div");
  spacer.style.flex = "1";
  const search = document.createElement("input");
  search.type = "search";
  search.className = "characters-search";
  search.placeholder = i18n("Найти персонажа…");
  search.value = query;
  search.addEventListener("input", () => {
    query = search.value;
    drawScene();
  });
  bar.append(heading, metaEl, seg, spacer, search);

  const body = document.createElement("div");
  body.className = "relmap-body";
  stageEl = document.createElement("div");
  stageEl.className = "relmap-stage";
  sideEl = document.createElement("div");
  sideEl.className = "relmap-side";
  body.append(stageEl, sideEl);

  wrap.append(bar, body);
  container.appendChild(wrap);

  // Размер сцены известен только после вставки в документ; rAF в
  // свёрнутом окне не идёт, поэтому setTimeout.
  setTimeout(() => {
    drawScene();
    renderSide();
  }, 0);

  // Окно или сайдбар поменяли размер — viewBox сцены должен совпасть с
  // новым размером, иначе картинка ужимается. Кроме ResizeObserver ещё и
  // resize окна: в свёрнутой панели кадры не идут, и наблюдатель молчит.
  stopResizeWatch?.();
  const stage = stageEl;
  let lastSize = "";
  const check = () => {
    if (!stage.isConnected) return stopResizeWatch?.();
    const size = `${stage.clientWidth}x${stage.clientHeight}`;
    if (size === lastSize) return;
    const first = !lastSize;
    lastSize = size;
    if (first) return;
    if (!viewTouched) view = null;
    drawScene();
  };
  const observer = new ResizeObserver(check);
  observer.observe(stage);
  window.addEventListener("resize", check);
  stopResizeWatch = () => {
    observer.disconnect();
    window.removeEventListener("resize", check);
    stopResizeWatch = null;
  };
  setTimeout(check, 0);
}

function updateMeta() {
  const people = i18nPlural(characters.length, ["{n} персонаж", "{n} персонажа", "{n} персонажей"]);
  const rels = i18nPlural(relationships.length, ["{n} отношение", "{n} отношения", "{n} отношений"]);
  metaEl.textContent = `${people} · ${rels}`;
}

// ── Раскладка ──────────────────────────────────
// Рамки: по родам — связные компоненты по родителям и парам (как в
// Родословной и «Составе» персонажей), одиночки — в общую «Вне родов»;
// по фракциям — состав каждой фракции, человек в первой из своих.
function buildBoxes() {
  if (groupBy === "faction") {
    const placed = new Set();
    const boxes = [];
    for (const f of factions) {
      const ids = [f.leaderId, ...(f.memberIds || [])].filter((id, i, a) => id && a.indexOf(id) === i);
      const members = ids.map(byId).filter((c) => c && !placed.has(c.id));
      if (!members.length) continue;
      members.forEach((c) => placed.add(c.id));
      boxes.push({ title: f.name || i18n("Без названия"), members, leaderId: f.leaderId, grid: true });
    }
    const rest = characters.filter((c) => !placed.has(c.id));
    if (rest.length) boxes.push({ title: i18n("Вне фракций"), members: rest, grid: true, loose: true });
    return boxes;
  }
  const boxes = [];
  const loners = [];
  for (const group of familyComponents(characters)) {
    if (group.length < 2) {
      loners.push(...group);
      continue;
    }
    const ids = new Set(group.map((c) => c.id));
    const eldest = group.find((c) => !(c.parentIds || []).some((p) => ids.has(p))) || group[0];
    const title = surnameHouseName(group) || i18n("Род: {name}", { name: eldest?.name || i18n("Без имени") });
    boxes.push({ title, members: group, grid: false });
  }
  // familyComponents сортирует рода по размеру — порядок внутри рамки
  // возвращаем к порядку персонажей в данных.
  const order = new Map(characters.map((c, i) => [c.id, i]));
  for (const b of boxes) b.members.sort((a, b2) => order.get(a.id) - order.get(b2.id));
  loners.sort((a, b) => order.get(a.id) - order.get(b.id));
  if (loners.length) boxes.push({ title: i18n("Вне родов"), members: loners, grid: true, loose: true });
  return boxes;
}

// Ряды внутри рамки рода: поколение = на одно ниже родителей, пары —
// в одном ряду и рядом (у кого пар больше — посередине, пары по бокам).
function generationRows(members) {
  const ids = new Set(members.map((c) => c.id));
  const depth = new Map(members.map((c) => [c.id, 0]));
  for (let pass = 0; pass < members.length + 1; pass++) {
    let changed = false;
    for (const c of members) {
      for (const p of c.parentIds || []) {
        if (ids.has(p) && depth.get(c.id) < depth.get(p) + 1) { depth.set(c.id, depth.get(p) + 1); changed = true; }
      }
      for (const p of c.partnerIds || []) {
        if (!ids.has(p)) continue;
        const d = Math.max(depth.get(c.id), depth.get(p));
        if (depth.get(c.id) !== d || depth.get(p) !== d) { depth.set(c.id, d); depth.set(p, d); changed = true; }
      }
    }
    if (!changed) break;
  }
  const rows = [];
  for (const c of members) (rows[depth.get(c.id)] ||= []).push(c);
  return rows.filter(Boolean).map((row) => orderRow(row));
}

function orderRow(row) {
  const left = [...row];
  const out = [];
  const partnersIn = (c) => (c.partnerIds || []).map((id) => left.find((x) => x.id === id)).filter(Boolean);
  // В порядке данных; у кого две пары и больше — он посередине.
  while (left.length) {
    const c = left[0];
    const ps = partnersIn(c);
    const chunk = [...ps.slice(1), c, ...ps.slice(0, 1)];
    for (const x of chunk) left.splice(left.indexOf(x), 1);
    out.push(...chunk);
  }
  return out;
}

function layout() {
  const boxes = buildBoxes();
  const pos = new Map();
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const box of boxes) {
    const rows = box.grid
      ? Array.from({ length: Math.ceil(box.members.length / LOOSE_COLS) }, (_, i) => box.members.slice(i * LOOSE_COLS, (i + 1) * LOOSE_COLS))
      : generationRows(box.members);
    const cols = Math.max(...rows.map((r) => r.length));
    const w = cols * COL_W + BOX_PAD * 2;
    const h = rows.length * ROW_H + BOX_HEAD;
    if (x > 0 && x + w > MAX_ROW_W) {
      x = 0;
      y += rowH + BOX_GAP;
      rowH = 0;
    }
    rows.forEach((row, ri) => {
      const off = (cols - row.length) * COL_W / 2;
      row.forEach((c, ci) => pos.set(c.id, { x: x + BOX_PAD + off + ci * COL_W + COL_W / 2, y: y + BOX_HEAD + ri * ROW_H + 30, top: y }));
    });
    box.x = x;
    box.y = y;
    box.w = w;
    box.h = h;
    x += w + BOX_GAP;
    rowH = Math.max(rowH, h);
  }
  const bounds = {
    x0: Math.min(...boxes.map((b) => b.x)),
    y0: Math.min(...boxes.map((b) => b.y)),
    x1: Math.max(...boxes.map((b) => b.x + b.w)),
    y1: Math.max(...boxes.map((b) => b.y + b.h)),
  };
  return { boxes, pos, bounds };
}

// ── Сцена ──────────────────────────────────────
function radiusOf(c) {
  return isMain(c) ? 24 : 19;
}

function drawScene() {
  if (!stageEl) return;
  updateMeta();
  scene = layout();
  const { boxes, pos, bounds } = scene;
  const arcs = arcGeometry(pos);
  for (const a of arcs) bounds.y0 = Math.min(bounds.y0, a.pill.y - 20);
  const w = stageEl.clientWidth || 900;
  const h = stageEl.clientHeight || 600;
  if (!view) view = fitView(bounds, w, h);

  stageEl.innerHTML = "";
  const svg = svgEl("svg", { class: "relmap-svg", viewBox: `0 0 ${w} ${h}` });
  const vp = svgEl("g", { transform: `translate(${view.x},${view.y}) scale(${view.scale})` }, svg);
  const gBoxes = svgEl("g", {}, vp);
  const gFamily = svgEl("g", { class: "relmap-family" }, vp);
  const gRels = svgEl("g", {}, vp);
  const gNodes = svgEl("g", {}, vp);
  const gPills = svgEl("g", {}, vp);
  const gTemp = svgEl("g", {}, vp);

  for (const b of boxes) {
    svgEl("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: 18, class: b.loose ? "relmap-box loose" : "relmap-box" }, gBoxes);
    const t = svgEl("text", { x: b.x + 18, y: b.y + 28, class: "relmap-box-title" }, gBoxes);
    t.textContent = b.title;
  }

  if (groupBy === "house") drawFamily(gFamily, pos);

  for (const { r, d, color } of arcs) {
    const g = svgEl("g", { class: "relmap-rel", "data-rel": r.id, "data-a": r.charA, "data-b": r.charB }, gRels);
    svgEl("path", { d, class: "relmap-rel-hit" }, g);
    svgEl("path", { d, class: "relmap-rel-line", stroke: color, "stroke-width": 1.8 + Math.abs(r.score || 0) / 28 }, g);
  }
  for (const p of arcs.map((a) => a.pill)) {
    const text = [p.r.label, scoreText(p.r.score)].filter(Boolean).join(" ");
    const pw = text.length * 6.3 + 16;
    const g = svgEl("g", { class: "relmap-pill", "data-rel": p.r.id, "data-a": p.r.charA, "data-b": p.r.charB, transform: `translate(${p.x},${p.y})` }, gPills);
    svgEl("rect", { x: -pw / 2, y: -10, width: pw, height: 20, rx: 10, stroke: p.color }, g);
    const t = svgEl("text", { "text-anchor": "middle", dy: "0.35em", fill: p.color }, g);
    t.textContent = text;
  }

  const q = query.trim().toLowerCase();
  for (const c of characters) {
    const p = pos.get(c.id);
    if (!p) continue;
    const r = radiusOf(c);
    const cls = ["relmap-node"];
    if (isDead(c)) cls.push("dead");
    if (c.id === selectedId) cls.push("selected");
    if (q && !(c.name || "").toLowerCase().includes(q)) cls.push("faded");
    const g = svgEl("g", { class: cls.join(" "), "data-id": c.id, transform: `translate(${p.x},${p.y})` }, gNodes);
    svgEl("circle", { r: r + 5, class: "relmap-node-ring" }, g);
    const fo = svgEl("foreignObject", { x: -r, y: -r, width: r * 2, height: r * 2 }, g);
    fo.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" class="relmap-avatar" style="--size:${r * 2}px">${personAvatarHtml(c, "cast-avatar")}</div>`;
    const name = svgEl("text", { y: r + 17, class: isMain(c) ? "relmap-name main" : "relmap-name" }, g);
    name.textContent = c.name || i18n("Без имени");
    const sub = subLabel(c);
    if (sub) {
      const s = svgEl("text", { y: r + 31, class: "relmap-sub" }, g);
      s.textContent = sub.length > 26 ? sub.slice(0, 25) + "…" : sub;
    }
  }

  stageEl.appendChild(svg);
  stageEl.appendChild(buildStageControls(bounds));
  if (!relationships.length) {
    const hint = document.createElement("div");
    hint.className = "relmap-hint";
    hint.textContent = i18n("Протяни линию от одного персонажа к другому – появится отношение");
    stageEl.appendChild(hint);
  }
  attachInteraction(svg, vp, gTemp);
  applyFocus(svg, selectedId);
}

// Дуги поднимаются над рамками обоих персонажей (вершина — выше их
// верхнего края), каждая следующая чуть выше, чтобы дуги между одними
// и теми же рамками не сливались в одну. Почти вертикальные — изгибом
// вбок.
function arcGeometry(pos) {
  const arcs = [];
  relationships.forEach((r, i) => {
    const a = pos.get(r.charA);
    const b = pos.get(r.charB);
    if (!a || !b) return;
    const color = scoreColor(r.score || 0);
    let cx = (a.x + b.x) / 2;
    let cy;
    if (Math.abs(b.x - a.x) > 60) {
      const peak = Math.min(a.top, b.top) - 18 - (i % 4) * 26;
      cy = 2 * peak - (a.y + b.y) / 2;
    } else {
      cx += 70 + (i % 4) * 20;
      cy = (a.y + b.y) / 2;
    }
    const sa = towards(a, { x: cx, y: cy }, radiusOf(byId(r.charA)) + 4);
    const sb = towards(b, { x: cx, y: cy }, radiusOf(byId(r.charB)) + 4);
    arcs.push({
      r,
      color,
      d: `M${sa.x},${sa.y} Q${cx},${cy} ${sb.x},${sb.y}`,
      pill: { r, color, x: (sa.x + 2 * cx + sb.x) / 4, y: (sa.y + 2 * cy + sb.y) / 4 },
    });
  });
  spreadPills(arcs.map((a) => a.pill));
  return arcs;
}

function towards(from, to, dist) {
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: from.x + ((to.x - from.x) / len) * dist, y: from.y + ((to.y - from.y) / len) * dist };
}

// Подписи дуг не должны лежать друг на друге: раздвигаем вверх, в
// пустое место над рамками.
function spreadPills(pills) {
  const sorted = [...pills].sort((a, b) => b.y - a.y);
  for (let i = 0; i < sorted.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = sorted[j];
      const b = sorted[i];
      const wa = ([a.r.label, scoreText(a.r.score)].join(" ").length * 6.3 + 16) / 2;
      const wb = ([b.r.label, scoreText(b.r.score)].join(" ").length * 6.3 + 16) / 2;
      if (Math.abs(a.x - b.x) < wa + wb + 4 && Math.abs(a.y - b.y) < 24) b.y = a.y - 24;
    }
  }
  return sorted;
}

function subLabel(c) {
  if (groupBy === "faction") {
    return factions.some((f) => f.leaderId === c.id) ? i18n("глава") : "";
  }
  const f = factions.find((x) => x.leaderId === c.id) || factions.find((x) => (x.memberIds || []).includes(c.id));
  if (!f) return "";
  return f.leaderId === c.id ? i18n("глава · {name}", { name: f.name }) : f.name;
}

// Семья внутри рамки рода — тонко, чтобы не спорить с отношениями:
// дети уголком от середины пары родителей, пары — прямой (любовники
// пунктиром).
function drawFamily(g, pos) {
  for (const c of characters) {
    const pc = pos.get(c.id);
    if (!pc) continue;
    const parents = (c.parentIds || []).map((id) => pos.get(id)).filter(Boolean);
    if (parents.length) {
      const px = parents.reduce((s, p) => s + p.x, 0) / parents.length;
      const py = Math.max(...parents.map((p) => p.y));
      const midY = (py + pc.y) / 2 - 6;
      const uncertain = (c.uncertainParentIds || []).length > 0;
      const adoptive = (c.adoptiveParentIds || []).length > 0;
      svgEl("path", {
        d: `M${px},${py} V${midY} H${pc.x} V${pc.y - radiusOf(c) - 2}`,
        stroke: FAMILY_COLOR,
        "stroke-dasharray": uncertain ? "1 4" : adoptive ? "5 4" : "",
      }, g);
    }
    for (const id of c.partnerIds || []) {
      if (c.id > id) continue;
      const q = pos.get(id);
      const other = byId(id);
      if (!q || !other) continue;
      const kind = partnerKind(c, id);
      const sa = towards(pc, q, radiusOf(c) + 3);
      const sb = towards(q, pc, radiusOf(other) + 3);
      svgEl("line", {
        x1: sa.x, y1: sa.y, x2: sb.x, y2: sb.y,
        stroke: FAMILY_COLOR,
        "stroke-dasharray": kind === "lover" ? "4 3" : kind === "divorced" ? "1 4" : "",
      }, g);
    }
  }
}

function fitView(bounds, w, h) {
  const pad = 40;
  const bw = bounds.x1 - bounds.x0;
  const bh = bounds.y1 - bounds.y0;
  const scale = Math.min(1.4, Math.max(0.3, Math.min((w - pad * 2) / bw, (h - pad * 2) / bh)));
  return {
    scale,
    x: (w - bw * scale) / 2 - bounds.x0 * scale,
    y: (h - bh * scale) / 2 - bounds.y0 * scale,
  };
}

function buildStageControls(bounds) {
  const box = document.createElement("div");
  box.className = "relmap-zoom";
  const mk = (html, title, fn) => {
    const b = document.createElement("button");
    b.className = "btn";
    b.innerHTML = html;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.addEventListener("click", fn);
    box.appendChild(b);
  };
  const zoomBy = (k) => {
    viewTouched = true;
    const w = stageEl.clientWidth;
    const h = stageEl.clientHeight;
    zoomAround(w / 2, h / 2, k);
    drawScene();
  };
  mk("−", i18n("Отдалить"), () => zoomBy(1 / 1.2));
  mk("+", i18n("Приблизить"), () => zoomBy(1.2));
  mk(iconSvg("focus", 14), i18n("Вписать"), () => {
    view = fitView(bounds, stageEl.clientWidth, stageEl.clientHeight);
    viewTouched = false;
    drawScene();
  });
  return box;
}

function zoomAround(sx, sy, k) {
  const scale = Math.min(2.5, Math.max(0.25, view.scale * k));
  const gx = (sx - view.x) / view.scale;
  const gy = (sy - view.y) / view.scale;
  view = { scale, x: sx - gx * scale, y: sy - gy * scale };
}

// Подсветка: выбранный (или тот, над кем курсор) и его отношения ярко,
// остальное приглушено.
function applyFocus(svg, id) {
  svg.classList.toggle("has-focus", !!id);
  const near = new Set(id ? [id, ...relsOf(id).map((r) => otherOf(r, id))] : []);
  for (const n of svg.querySelectorAll(".relmap-node")) n.classList.toggle("near", near.has(n.dataset.id));
  for (const e of svg.querySelectorAll(".relmap-rel, .relmap-pill")) {
    e.classList.toggle("near", !!id && (e.dataset.a === id || e.dataset.b === id));
  }
}

// ── Мышь: сдвиг, масштаб, выбор, протянуть новое отношение ──
function attachInteraction(svg, vp, gTemp) {
  const toScene = (e) => {
    const rect = svg.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  };
  const toWorld = (e) => {
    const { sx, sy } = toScene(e);
    return { x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale };
  };
  const applyView = () => vp.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.scale})`);
  const capture = (el, id) => { try { el.setPointerCapture(id); } catch {} };

  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const { sx, sy } = toScene(e);
    zoomAround(sx, sy, e.deltaY > 0 ? 0.9 : 1.1);
    viewTouched = true;
    applyView();
  }, { passive: false });

  let drag = null;
  let lastClick = { id: null, at: 0 };
  svg.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const node = e.target.closest(".relmap-node");
    const rel = e.target.closest(".relmap-rel, .relmap-pill");
    if (rel && !node) return;
    capture(svg, e.pointerId);
    if (node) {
      const from = node.dataset.id;
      drag = { kind: "link", from, start: scene.pos.get(from), x: e.clientX, y: e.clientY, moved: false, line: null, target: null };
    } else {
      drag = { kind: "pan", x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
      svg.classList.add("panning");
    }
  });

  svg.addEventListener("pointermove", (e) => {
    if (!drag) {
      if (!selectedId) {
        const node = e.target.closest(".relmap-node");
        const id = node?.dataset.id || null;
        if (svg.dataset.hover !== (id || "")) {
          svg.dataset.hover = id || "";
          applyFocus(svg, id);
        }
      }
      return;
    }
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true;
    if (drag.kind === "pan") {
      view = { ...view, x: drag.vx + (e.clientX - drag.x), y: drag.vy + (e.clientY - drag.y) };
      viewTouched = true;
      applyView();
      return;
    }
    if (!drag.moved) return;
    const p = toWorld(e);
    if (!drag.line) drag.line = svgEl("line", { class: "relmap-temp" }, gTemp);
    drag.line.setAttribute("x1", drag.start.x);
    drag.line.setAttribute("y1", drag.start.y);
    drag.line.setAttribute("x2", p.x);
    drag.line.setAttribute("y2", p.y);
    const under = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".relmap-node");
    const target = under && under.dataset.id !== drag.from ? under.dataset.id : null;
    if (target !== drag.target) {
      svg.querySelector(".relmap-node.drop")?.classList.remove("drop");
      if (target) under.classList.add("drop");
      drag.target = target;
    }
  });

  const end = (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    svg.classList.remove("panning");
    if (d.kind === "pan") {
      if (!d.moved && selectedId) select(null);
      return;
    }
    d.line?.remove();
    if (!d.moved) {
      // Двойной щелчок ловим сами: из-за захвата указателя событие
      // dblclick приходит на svg, а не на узел. Второй щелчок не снимает
      // выбор, а открывает досье.
      const now = Date.now();
      const repeat = lastClick.id === d.from && now - lastClick.at < 400;
      lastClick = repeat ? { id: null, at: 0 } : { id: d.from, at: now };
      if (repeat) document.dispatchEvent(new CustomEvent("fictaris:open-entity", { detail: { type: "character", id: d.from } }));
      else select(selectedId === d.from ? null : d.from);
      return;
    }
    if (d.target) linkPeople(d.from, d.target, e.clientX, e.clientY);
    else svg.querySelector(".relmap-node.drop")?.classList.remove("drop");
  };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", () => {
    drag?.line?.remove();
    drag = null;
    svg.classList.remove("panning");
  });

  svg.addEventListener("click", (e) => {
    const rel = e.target.closest(".relmap-rel, .relmap-pill");
    if (rel) openRelEditor(rel.dataset.rel, e.clientX, e.clientY);
  });

  svg.addEventListener("pointerleave", () => {
    if (!drag && !selectedId) {
      svg.dataset.hover = "";
      applyFocus(svg, null);
    }
  });
}

// Без перерисовки сцены: иначе второй щелчок двойного попадал бы уже в
// новый svg и «открыть досье» по двойному щелчку не срабатывало бы.
function select(id) {
  selectedId = id;
  const svg = stageEl?.querySelector(".relmap-svg");
  if (svg) {
    for (const n of svg.querySelectorAll(".relmap-node")) n.classList.toggle("selected", n.dataset.id === id);
    applyFocus(svg, id);
  }
  renderSide();
}

function linkPeople(a, b, x, y) {
  let rel = relationships.find((r) => (r.charA === a && r.charB === b) || (r.charA === b && r.charB === a));
  if (!rel) {
    rel = { id: uid(), charA: a, charB: b, label: "", score: 0, note: "" };
    relationships.push(rel);
    saveRelationships(relationships);
  }
  selectedId = a;
  drawScene();
  renderSide();
  openRelEditor(rel.id, x, y, true);
}

// ── Правка отношения ───────────────────────────
function openRelEditor(relId, x, y, focusLabel = false) {
  const rel = relationships.find((r) => r.id === relId);
  if (!rel) return;
  const name = (id) => byId(id)?.name || i18n("?");
  const changed = () => {
    saveRelationships(relationships);
    drawScene();
    renderSide();
  };

  const wrap = document.createElement("div");
  wrap.className = "graph-edge-editor";

  const title = document.createElement("div");
  title.className = "graph-edge-editor-title";
  title.textContent = `${name(rel.charA)} ↔ ${name(rel.charB)}`;
  wrap.appendChild(title);

  const label = document.createElement("input");
  label.className = "field-inline-control field-inline-control-bright";
  label.placeholder = i18n("Метка (наставник, вражда…)");
  label.value = rel.label || "";
  label.addEventListener("input", () => {
    rel.label = label.value;
    changed();
  });
  wrap.appendChild(label);

  const sliderRow = document.createElement("div");
  sliderRow.className = "rel-sliders";
  const scoreLabel = document.createElement("span");
  scoreLabel.className = "rel-score-label";
  scoreLabel.textContent = scoreText(rel.score);
  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "rel-slider";
  slider.min = -100;
  slider.max = 100;
  slider.value = rel.score || 0;
  slider.addEventListener("input", () => {
    rel.score = Number(slider.value);
    scoreLabel.textContent = scoreText(rel.score);
    changed();
  });
  sliderRow.append(scoreLabel, slider);
  wrap.appendChild(sliderRow);

  const scale = document.createElement("div");
  scale.className = "relmap-scale";
  scale.innerHTML = `<span>${i18n("вражда")}</span><span>${i18n("близость")}</span>`;
  wrap.appendChild(scale);

  const note = document.createElement("textarea");
  note.className = "field-inline-control rel-note";
  note.placeholder = i18n("Заметка о связи…");
  note.value = rel.note || "";
  note.addEventListener("input", () => {
    rel.note = note.value;
    saveRelationships(relationships);
    renderSide();
  });
  wrap.appendChild(note);

  const delBtn = document.createElement("button");
  delBtn.className = "btn danger graph-edge-editor-del";
  delBtn.textContent = i18n("Удалить связь");
  delBtn.addEventListener("click", async () => {
    await pushTrash("relationship", rel);
    relationships = relationships.filter((r) => r.id !== rel.id);
    await apiPost("/api/relationships", relationships);
    closeMenu();
    drawScene();
    renderSide();
  });
  wrap.appendChild(delBtn);

  openPopover(x, y, wrap, "graph-edge-popover");
  if (focusLabel) setTimeout(() => label.focus(), 0);
}

// ── Панель справа ──────────────────────────────
function renderSide() {
  if (!sideEl) return;
  sideEl.innerHTML = "";
  const c = selectedId && byId(selectedId);
  if (c) renderPersonSide(c);
  else renderAllSide();
  const legend = document.createElement("div");
  legend.className = "relmap-legend";
  legend.innerHTML = `
    <span><i style="border-color:#6fa772"></i>${i18n("близость")}</span>
    <span><i style="border-color:#c25a4c"></i>${i18n("вражда")}</span>
    ${groupBy === "house" ? `<span><i class="thin" style="border-color:${FAMILY_COLOR}"></i>${i18n("родство и пары")}</span>` : ""}
    <span>${i18n("толщина – сила")}</span>`;
  sideEl.appendChild(legend);
}

function sideHead(titleHtml, sub) {
  const head = document.createElement("div");
  head.className = "relmap-side-head";
  head.innerHTML = `${titleHtml}<div class="relmap-side-sub">${escapeHtml(sub)}</div>`;
  sideEl.appendChild(head);
}

function relRow(lead, text, r) {
  const row = document.createElement("button");
  row.className = "relmap-row";
  row.innerHTML = `${lead}<span class="relmap-row-main"><span class="relmap-row-name">${text}</span>${r.label || r.note ? `<span class="relmap-row-note">${escapeHtml([r.label, r.note].filter(Boolean).join(" – "))}</span>` : ""}</span>
    <span class="relmap-row-score" style="color:${scoreColor(r.score || 0)}">${scoreText(r.score)}</span>`;
  row.addEventListener("click", (e) => {
    const rect = row.getBoundingClientRect();
    openRelEditor(r.id, rect.left - 280, rect.top);
    e.stopPropagation();
  });
  return row;
}

function sectionTitle(text) {
  const t = document.createElement("div");
  t.className = "relmap-sec";
  t.textContent = text;
  return t;
}

function renderAllSide() {
  sideHead(`<h3>${i18n("Все отношения")}</h3>`, i18n("От самых сильных. Щелчок по персонажу на карте – только его"));
  const list = document.createElement("div");
  list.className = "relmap-list";
  const sorted = [...relationships].sort((a, b) => Math.abs(b.score || 0) - Math.abs(a.score || 0));
  for (const r of sorted) {
    const a = byId(r.charA);
    const b = byId(r.charB);
    if (!a || !b) continue;
    list.appendChild(relRow("", `${escapeHtml(shortName(a.name))} ↔ ${escapeHtml(shortName(b.name))}`, r));
  }
  if (!sorted.length) {
    const none = document.createElement("div");
    none.className = "relmap-side-sub";
    none.textContent = i18n("Пока ни одного. Протяни линию от персонажа к персонажу на карте.");
    list.appendChild(none);
  }
  sideEl.appendChild(list);

  const lonely = characters.filter((c) => !relsOf(c.id).length);
  if (lonely.length && relationships.length) {
    const sec = document.createElement("div");
    sec.appendChild(sectionTitle(i18n("Без отношений · {n}", { n: lonely.length })));
    const chips = document.createElement("div");
    chips.className = "relmap-chips";
    for (const c of lonely) {
      const chip = document.createElement("button");
      chip.className = "relmap-chip";
      chip.innerHTML = `${personAvatarHtml(c)}<span>${escapeHtml(c.name || i18n("Без имени"))}</span>`;
      chip.addEventListener("click", () => select(c.id));
      chips.appendChild(chip);
    }
    sec.appendChild(chips);
    sideEl.appendChild(sec);
  }
}

function renderPersonSide(c) {
  const rels = relsOf(c.id).sort((a, b) => Math.abs(b.score || 0) - Math.abs(a.score || 0));
  sideHead(
    `<div class="relmap-side-title">${personAvatarHtml(c, "cast-avatar cast-avatar-md")}<h3>${escapeHtml(c.name || i18n("Без имени"))}</h3></div>`,
    rels.length ? i18nPlural(rels.length, ["{n} отношение", "{n} отношения", "{n} отношений"]) : i18n("Пока ни с кем")
  );
  const list = document.createElement("div");
  list.className = "relmap-list";
  for (const r of rels) {
    const other = byId(otherOf(r, c.id));
    if (!other) continue;
    list.appendChild(relRow(personAvatarHtml(other), escapeHtml(other.name || i18n("Без имени")), r));
  }
  sideEl.appendChild(list);

  const hint = document.createElement("div");
  hint.className = "relmap-side-sub";
  hint.textContent = i18n("Новое отношение – протяни линию от персонажа к другому на карте");
  sideEl.appendChild(hint);

  const actions = document.createElement("div");
  actions.className = "relmap-actions";
  const open = document.createElement("button");
  open.className = "btn";
  open.textContent = i18n("Открыть досье");
  open.addEventListener("click", () => document.dispatchEvent(new CustomEvent("fictaris:open-entity", { detail: { type: "character", id: c.id } })));
  const back = document.createElement("button");
  back.className = "btn";
  back.textContent = i18n("Все отношения");
  back.addEventListener("click", () => select(null));
  actions.append(open, back);
  sideEl.appendChild(actions);
}
