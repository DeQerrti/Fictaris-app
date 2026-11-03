import { apiGet, apiPost, uid } from "./api.js";
import { i18n, i18nPlural } from "./i18n.js";
import { openEntityModal } from "./entity-modal.js";
import { buildEmptyState, escapeHtml } from "./chips.js";
import { avatarInnerHtml } from "./avatars.js";
import { iconSvg } from "./icons.js";
import { exportElementAsPng } from "./png-export.js";
import { partnerKind, parentKind, isIllegitimate, isDead, relativesOf } from "./kinship.js";

// ══════════════════════════════════════════════
//  РОДОСЛОВНАЯ
//
//  Два режима, переключатель в шапке:
//   — «Древо»: настоящее генеалогическое дерево по поколениям сверху
//     вниз — карточки людей, пара стоит рядом и соединена линией своего
//     вида (брак, помолвка, любовники, развод), дети висят на общей
//     «шине» от середины пары, приёмное родство — пунктиром,
//     предполагаемое — точками со знаком «?». Все рода на одном полотне
//     (или один выбранный в шапке), панорама и зум, «Вписать»;
//   — «Фокус»: один человек в центре, вокруг — кем ему приходятся
//     остальные (kinship.js, relativesOf): родители и отчим/мачеха,
//     братья и сёстры (по отцу/по матери), пары, дети (в том числе
//     внебрачные), внуки, дальше — дяди, двоюродные, родня супруга.
//
//  Род — не отдельная сущность в данных, а связная компонента графа
//  parentIds+partnerIds (два рода, между которыми нет ни одной связи
//  «родитель-ребёнок» и ни одной пары, — технически и есть два разных
//  рода). Название — по общей фамилии (последнее слово имени у
//  большинства), иначе по старшему предку.
// ══════════════════════════════════════════════

let root = null;
let characters = [];

const PALETTE = [
  "#c9944a", "#4f7d74", "#a4483c", "#7d6a9e",
  "#6a8fae", "#9a9250", "#b5636b", "#5a8a5f",
];

const CARD_W = 190;
const CARD_H = 74;
const SLOT_W = 220; // шаг между центрами соседей-партнёров
const UNIT_GAP = 40;
const ROW_H = 170;
const TOP = 0;
const LABEL_W = 104; // колонка «Поколение N» слева от рода
const HEAD_H = 56; // заголовок рода над ним
const HOUSE_GAP = 120;
const BUS_GAP = 28; // шина детей — настолько выше их карточек

// Предпочтения этого устройства, не мира — localStorage.
const PREFS_KEY = "fictaris_familytree";
function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}
function writePrefs(patch) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readPrefs(), ...patch }));
  } catch {
    // приватное окно и т.п. — просто не запомнится
  }
}
let prefs = readPrefs();
let mode = prefs.mode === "focus" ? "focus" : "tree";

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

function focusOn(id) {
  mode = "focus";
  prefs.focusId = id;
  writePrefs({ mode, focusId: id });
  draw();
}

// ── Подписи ───────────────────────────────────

function lifeText(c) {
  const age = (c.age || "").trim();
  if (!age) return "";
  if (isDead(c) && age.length <= 2) {
    return i18n(c.gender === "male" ? "умер" : c.gender === "female" ? "умерла" : "умер(ла)");
  }
  return /^\d+$/.test(age) ? i18nPlural(Number(age), ["{n} год", "{n} года", "{n} лет"]) : age;
}

// Особенности происхождения — одной строкой на карточке: «внебрачный»,
// «приёмный: Ренар», «под вопросом: Эдвин».
function originNotes(c, byId) {
  const notes = [];
  if (isIllegitimate(c, byId)) notes.push(i18n(c.gender === "female" ? "внебрачная" : c.gender === "male" ? "внебрачный" : "внебрачный(ая)"));
  for (const pid of c.parentIds || []) {
    const p = byId.get(pid);
    if (!p) continue;
    const kind = parentKind(c, pid);
    if (kind === "adoptive") notes.push(i18n("приёмный: {name}", { name: p.name }));
    if (kind === "uncertain") notes.push(i18n("под вопросом: {name}", { name: p.name }));
  }
  return notes;
}

// Самое частое последнее слово имени, если оно встречается хотя бы у
// двоих, — «Род Вирен»; иначе по первому предку — «Род Старого Варна»
// звучало бы натужно, поэтому просто «Род: {имя}».
function houseName(group, rows) {
  const counts = new Map();
  for (const c of group) {
    const words = (c.name || "").trim().split(/\s+/);
    if (words.length < 2) continue;
    const last = words[words.length - 1];
    counts.set(last, (counts.get(last) || 0) + 1);
  }
  const [best, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  if (best && n >= 2) return i18n("Род {name}", { name: best });
  const eldest = (rows.get(0) || [])[0]?.members[0];
  const person = group.find((c) => c.id === eldest) || group[0];
  return i18n("Род: {name}", { name: person?.name || i18n("Без имени") });
}

function familyGroups() {
  const hasChild = new Set();
  for (const c of characters) for (const p of c.parentIds || []) hasChild.add(p);
  const inTree = characters.filter((c) => (c.parentIds || []).length || hasChild.has(c.id) || (c.partnerIds || []).length);
  return connectedComponents(inTree).map((list) => {
    const byId = new Map(list.map((c) => [c.id, c]));
    const depth = computeDepths(list, byId);
    const unions = mutualUnions(list, byId);
    const rows = buildUnits(list, depth, primaryPartnerOf(unions, list));
    return { list, byId, depth, unions, rows, name: houseName(list, rows) };
  });
}

// ── Шапка ─────────────────────────────────────

function buildToolbar(groups, currentHouse, treeApi) {
  const bar = document.createElement("div");
  bar.className = "timeline-toolbar ftree-toolbar";

  const title = document.createElement("div");
  title.className = "timeline-heading";
  title.textContent = i18n("Родословная");
  const meta = document.createElement("div");
  meta.className = "timeline-meta";
  const people = groups.reduce((n, g) => n + g.list.length, 0);
  meta.textContent = `${i18nPlural(groups.length, ["{n} род", "{n} рода", "{n} родов"])} · ${i18nPlural(people, ["{n} персонаж", "{n} персонажа", "{n} персонажей"])}`;
  const spacer = document.createElement("div");
  spacer.style.flex = "1";
  bar.append(title, meta, spacer);

  if (mode === "tree" && groups.length > 1) {
    const select = document.createElement("select");
    select.className = "ftree-house-select";
    select.title = i18n("Какой род показать");
    const all = document.createElement("option");
    all.value = "";
    all.textContent = i18n("Все рода");
    select.appendChild(all);
    groups.forEach((g, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = `${g.name} · ${g.list.length}`;
      opt.selected = currentHouse === g;
      select.appendChild(opt);
    });
    select.addEventListener("change", () => {
      const g = groups[Number(select.value)];
      // Запоминаем любого члена рода, а не номер: номера сдвигаются,
      // когда рода растут и меняются местами по размеру.
      prefs.houseMember = select.value === "" ? null : g.list[0].id;
      writePrefs({ houseMember: prefs.houseMember });
      draw();
    });
    bar.appendChild(select);
  }

  const switcher = document.createElement("div");
  switcher.className = "segmented";
  for (const [key, label, hint] of [
    ["tree", "Древо", "Все поколения рода"],
    ["focus", "Фокус", "Кем приходятся остальные одному персонажу"],
  ]) {
    const btn = document.createElement("button");
    btn.className = "segmented-btn" + (mode === key ? " active" : "");
    btn.textContent = i18n(label);
    btn.title = i18n(hint);
    btn.addEventListener("click", () => {
      if (mode === key) return;
      mode = key;
      writePrefs({ mode });
      draw();
    });
    switcher.appendChild(btn);
  }
  bar.appendChild(switcher);

  if (treeApi) {
    const zoom = document.createElement("div");
    zoom.className = "segmented";
    const out = document.createElement("button");
    out.className = "segmented-btn";
    out.textContent = "−";
    out.title = i18n("Отдалить");
    const pct = document.createElement("button");
    pct.className = "segmented-btn ftree-zoom-pct";
    pct.title = i18n("Вписать всё в экран");
    const inn = document.createElement("button");
    inn.className = "segmented-btn";
    inn.textContent = "+";
    inn.title = i18n("Приблизить");
    out.addEventListener("click", () => treeApi.zoomBy(0.8));
    inn.addEventListener("click", () => treeApi.zoomBy(1.25));
    pct.addEventListener("click", () => treeApi.fit());
    treeApi.onScale((s) => { pct.textContent = `${Math.round(s * 100)}%`; });
    zoom.append(out, pct, inn);

    const exportBtn = document.createElement("button");
    exportBtn.className = "btn";
    exportBtn.textContent = i18n("Экспорт в PNG");
    exportBtn.addEventListener("click", () => treeApi.exportPng(exportBtn));
    bar.append(zoom, exportBtn);
  }

  const addBtn = document.createElement("button");
  addBtn.className = "btn accent";
  addBtn.textContent = i18n("+ Персонаж");
  addBtn.addEventListener("click", addCharacter);
  bar.appendChild(addBtn);
  return bar;
}

// ── Древо ─────────────────────────────────────

function personCard(c, byId, x, y) {
  const el = document.createElement("div");
  el.className = "ftree-person" + (isDead(c) ? " dead" : "");
  el.style.left = `${x - CARD_W / 2}px`;
  el.style.top = `${y}px`;
  el.style.width = `${CARD_W}px`;
  el.style.height = `${CARD_H}px`;
  el.style.setProperty("--person-color", c.color || "#7c7157");
  const initial = escapeHtml((c.name || "?").trim().slice(0, 1).toUpperCase());
  const notes = originNotes(c, byId);
  const meta = [lifeText(c), ...notes].filter(Boolean).join(" · ");
  el.title = [c.name, c.role, meta].filter(Boolean).join("\n");
  el.innerHTML = `
    <span class="ftree-person-avatar" style="background:${c.color || "#7c7157"}">${avatarInnerHtml(c, `<span>${initial}</span>`)}</span>
    <span class="ftree-person-text">
      <span class="ftree-person-name">${escapeHtml(c.name || i18n("Без имени"))}</span>
      <span class="ftree-person-role">${escapeHtml(c.role || "")}</span>
      <span class="ftree-person-meta${notes.length ? " notable" : ""}">${escapeHtml(meta)}</span>
    </span>`;
  const focusBtn = document.createElement("button");
  focusBtn.className = "ftree-person-focus";
  focusBtn.title = i18n("Фокус: кем ему приходятся остальные");
  focusBtn.innerHTML = iconSvg("focus", 13);
  focusBtn.addEventListener("click", (e) => { e.stopPropagation(); focusOn(c.id); });
  el.appendChild(focusBtn);
  el.addEventListener("click", () => openCharacter(c.id));
  return el;
}

const svgNS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs, cls) {
  const el = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (cls) el.setAttribute("class", cls);
  return el;
}

// Один род: раскладка по поколениям (layout выше) → карточки, линии пар
// и шины детей, подписи поколений. Возвращает свои размеры, чтобы рода
// встали на общем полотне рядом.
function drawHouse(house, stage, svg, offsetX) {
  const { list, byId, depth, unions, rows } = house;
  const { pos, maxDepth } = layout(rows, byId);
  let minX = Infinity, maxX = -Infinity;
  for (const p of pos.values()) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); }
  const shift = offsetX + LABEL_W + CARD_W / 2 - minX;
  for (const p of pos.values()) { p.x += shift; p.y += HEAD_H; }
  const width = LABEL_W + (maxX - minX) + CARD_W;
  const height = HEAD_H + maxDepth * ROW_H + CARD_H;

  const head = document.createElement("div");
  head.className = "ftree-house-head";
  head.style.left = `${offsetX + LABEL_W}px`;
  head.style.width = `${width - LABEL_W}px`;
  head.innerHTML = `<span>${escapeHtml(house.name)}</span><small>${escapeHtml(i18nPlural(list.length, ["{n} человек", "{n} человека", "{n} человек"]))} · ${escapeHtml(i18nPlural(maxDepth + 1, ["{n} поколение", "{n} поколения", "{n} поколений"]))}</small>`;
  stage.appendChild(head);

  for (let d = 0; d <= maxDepth; d++) {
    const label = document.createElement("div");
    label.className = "ftree-gen";
    label.style.left = `${offsetX}px`;
    label.style.top = `${HEAD_H + d * ROW_H}px`;
    label.style.width = `${LABEL_W - 14}px`;
    label.style.height = `${CARD_H}px`;
    label.textContent = i18n("Поколение {n}", { n: d + 1 });
    stage.appendChild(label);
  }

  // Линии пар — по виду пары. Соседи по ряду — прямая между карточками с
  // отметкой посередине; не соседи (второй брак через одного) — дугой над
  // рядом, чтобы не прятаться за карточкой между ними.
  const arcsPerRow = new Map();
  const unionPoint = new Map(); // "a|b" -> откуда пара «спускает» детей
  for (const u of unions) {
    const a = pos.get(u.a), b = pos.get(u.b);
    if (!a || !b || a.y !== b.y) continue;
    const [l, r] = a.x < b.x ? [a, b] : [b, a];
    const kind = partnerKind(byId.get(u.a), u.b);
    const y = l.y + CARD_H / 2;
    const cls = `ftree-union ftree-union-${kind}`;
    const adjacent = r.x - l.x <= SLOT_W * 1.05;
    let top = y;
    if (adjacent) {
      svg.appendChild(svgEl("line", { x1: l.x + CARD_W / 2, y1: y, x2: r.x - CARD_W / 2, y2: y }, cls));
    } else {
      const k = arcsPerRow.get(l.y) || 0;
      arcsPerRow.set(l.y, k + 1);
      top = l.y - 14 - k * 10;
      svg.appendChild(svgEl("path", { d: `M ${l.x} ${l.y} L ${l.x} ${top} L ${r.x} ${top} L ${r.x} ${r.y}`, fill: "none" }, cls));
    }
    const mx = (l.x + r.x) / 2;
    const my = top;
    unionPoint.set([u.a, u.b].sort().join("|"), { x: mx, y: my });
    if (kind === "married" || kind === "betrothed") svg.appendChild(svgEl("circle", { cx: mx, cy: my, r: 6 }, `ftree-ring ftree-ring-${kind}`));
    if (kind === "divorced") svg.appendChild(svgEl("path", { d: `M ${mx - 6} ${my + 6} L ${mx - 1} ${my - 6} M ${mx + 1} ${my + 6} L ${mx + 6} ${my - 6}` }, "ftree-divorce-mark"));
  }

  // Дети — пучками от середины пары или от одиночного родителя
  // (edgesForChild): ствол вниз до шины над рядом детей, шина вдоль них,
  // от неё — отвод к каждому. Отвод — по происхождению ребёнка от этого
  // пучка: приёмный — пунктир, предполагаемый — точки и «?».
  const bundles = new Map();
  for (const c of list) {
    const to = pos.get(c.id);
    if (!to || !(c.parentIds || []).length) continue;
    for (const bundle of edgesForChild(c, unions)) {
      // Ствол — от отметки пары на её линии (у не-соседей — от дуги над
      // рядом), у одиночного родителя — от низа его карточки.
      const from = bundle.kind === "union"
        ? unionPoint.get([bundle.a, bundle.b].sort().join("|")) || null
        : pos.get(bundle.a) && { x: pos.get(bundle.a).x, y: pos.get(bundle.a).y + CARD_H };
      if (!from) continue;
      const key = `${bundle.a}|${bundle.b || ""}|${to.y}`;
      if (!bundles.has(key)) bundles.set(key, { from, kids: [] });
      const kinds = [bundle.a, bundle.b].filter(Boolean).map((pid) => parentKind(c, pid));
      const kind = kinds.includes("uncertain") ? "uncertain" : kinds.includes("adoptive") ? "adoptive" : "birth";
      bundles.get(key).kids.push({ x: to.x, y: to.y, kind });
    }
  }
  const busesPerRow = new Map();
  for (const b of bundles.values()) {
    const rowY = b.kids[0].y;
    const k = busesPerRow.get(rowY) || 0;
    busesPerRow.set(rowY, k + 1);
    b.busY = rowY - BUS_GAP - k * 12;
  }
  for (const { from, busY, kids } of bundles.values()) {
    const xs = [from.x, ...kids.map((k) => k.x)];
    svg.appendChild(svgEl("path", { d: `M ${from.x} ${from.y} L ${from.x} ${busY} M ${Math.min(...xs)} ${busY} L ${Math.max(...xs)} ${busY}`, fill: "none" }, "ftree-line"));
    for (const k of kids) {
      svg.appendChild(svgEl("line", { x1: k.x, y1: busY, x2: k.x, y2: k.y }, `ftree-line ftree-line-${k.kind}`));
      if (k.kind === "uncertain") {
        svg.appendChild(svgEl("circle", { cx: k.x, cy: (busY + k.y) / 2, r: 8 }, "ftree-q-bg"));
        const q = svgEl("text", { x: k.x, y: (busY + k.y) / 2 + 4, "text-anchor": "middle" }, "ftree-q");
        q.textContent = "?";
        svg.appendChild(q);
      }
    }
  }

  for (const c of list) {
    const p = pos.get(c.id);
    if (p) stage.appendChild(personCard(c, byId, p.x, p.y));
  }
  return { width, height };
}

// Панорама перетаскиванием фона и зум колесом/кнопками — transform на
// сцену; «Вписать» — масштаб, при котором всё полотно в окне (не крупнее
// 100%: маленькое дерево не раздувается, а встаёт по центру).
function attachStage(viewport, stage, contentW, contentH) {
  const view = { x: 0, y: 0, scale: 1 };
  const MIN = 0.3, MAX = 2;
  const listeners = [];
  const apply = () => {
    stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    for (const fn of listeners) fn(view.scale);
  };
  const fit = () => {
    const w = viewport.clientWidth, h = viewport.clientHeight;
    const pad = 40;
    view.scale = Math.max(MIN, Math.min(1, (w - pad * 2) / contentW, (h - pad * 2) / contentH));
    view.x = Math.max(pad, (w - contentW * view.scale) / 2);
    view.y = pad;
    apply();
  };
  const zoomAt = (factor, cx, cy) => {
    const next = Math.min(MAX, Math.max(MIN, view.scale * factor));
    const k = next / view.scale;
    view.x = cx - (cx - view.x) * k;
    view.y = cy - (cy - view.y) * k;
    view.scale = next;
    apply();
  };
  viewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    zoomAt(e.deltaY > 0 ? 0.9 : 1.1, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  let pan = null;
  viewport.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".ftree-person")) return;
    pan = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    viewport.setPointerCapture(e.pointerId);
    viewport.classList.add("panning");
  });
  viewport.addEventListener("pointermove", (e) => {
    if (!pan) return;
    view.x = pan.vx + (e.clientX - pan.x);
    view.y = pan.vy + (e.clientY - pan.y);
    apply();
  });
  const end = () => { pan = null; viewport.classList.remove("panning"); };
  viewport.addEventListener("pointerup", end);
  viewport.addEventListener("pointercancel", end);

  return {
    fit,
    zoomBy: (f) => zoomAt(f, viewport.clientWidth / 2, viewport.clientHeight / 2),
    onScale: (fn) => { listeners.push(fn); fn(view.scale); },
    // Снимок — всего полотна в натуральную величину, а не того, что сейчас
    // видно в окне: на время снимка transform снимается.
    exportPng: async (btn) => {
      const saved = stage.style.transform;
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = i18n("Готовим…");
      stage.style.transform = "none";
      try {
        await exportElementAsPng(stage, `${i18n("родословная")}.png`);
      } catch (e) {
        alert(e.message);
      } finally {
        stage.style.transform = saved;
        btn.disabled = false;
        btn.textContent = label;
      }
    },
  };
}

function buildTree(houses) {
  const viewport = document.createElement("div");
  viewport.className = "ftree-viewport";
  const stage = document.createElement("div");
  stage.className = "ftree-stage";
  const svg = svgEl("svg", {}, "ftree-lines");
  stage.appendChild(svg);

  let x = 0, h = 0;
  for (const house of houses) {
    const size = drawHouse(house, stage, svg, x);
    x += size.width + HOUSE_GAP;
    h = Math.max(h, size.height);
  }
  const w = Math.max(0, x - HOUSE_GAP);
  stage.style.width = `${w}px`;
  stage.style.height = `${h}px`;
  svg.setAttribute("width", w);
  svg.setAttribute("height", h);
  viewport.appendChild(stage);

  const legend = document.createElement("div");
  legend.className = "ftree-legend";
  legend.innerHTML = [
    ["married", "брак"], ["betrothed", "помолвка"], ["lover", "любовники"], ["divorced", "развод"],
  ].map(([k, t]) => `<span><svg width="26" height="10"><line x1="1" y1="5" x2="25" y2="5" class="ftree-union ftree-union-${k}"/></svg>${escapeHtml(i18n(t))}</span>`).join("") +
    `<span><svg width="26" height="10"><line x1="1" y1="5" x2="25" y2="5" class="ftree-line ftree-line-adoptive"/></svg>${escapeHtml(i18n("приёмный"))}</span>` +
    `<span><svg width="26" height="10"><line x1="1" y1="5" x2="25" y2="5" class="ftree-line ftree-line-uncertain"/></svg>${escapeHtml(i18n("под вопросом"))}</span>`;

  const api = attachStage(viewport, stage, w, h);
  return { viewport, legend, api };
}

// ── Фокус ─────────────────────────────────────

function kinCard(entry, big = false) {
  const { c, label } = entry;
  const el = document.createElement("button");
  el.type = "button";
  el.className = "kin-card" + (big ? " big" : "") + (isDead(c) ? " dead" : "");
  el.style.setProperty("--person-color", c.color || "#7c7157");
  const initial = escapeHtml((c.name || "?").trim().slice(0, 1).toUpperCase());
  el.innerHTML = `
    ${label ? `<span class="kin-card-label">${escapeHtml(label)}</span>` : ""}
    <span class="kin-card-body">
      <span class="ftree-person-avatar" style="background:${c.color || "#7c7157"}">${avatarInnerHtml(c, `<span>${initial}</span>`)}</span>
      <span class="ftree-person-text">
        <span class="ftree-person-name">${escapeHtml(c.name || i18n("Без имени"))}</span>
        <span class="ftree-person-role">${escapeHtml([c.role, lifeText(c)].filter(Boolean).join(" · "))}</span>
      </span>
    </span>`;
  if (!big) el.addEventListener("click", () => focusOn(c.id));
  return el;
}

function kinRow(title, entries) {
  if (!entries.length) return null;
  const row = document.createElement("div");
  row.className = "kin-row";
  const head = document.createElement("div");
  head.className = "kin-row-title";
  head.textContent = title;
  const cards = document.createElement("div");
  cards.className = "kin-row-cards";
  for (const e of entries) cards.appendChild(kinCard(e));
  row.append(head, cards);
  return row;
}

function buildFocus(houses) {
  const wrap = document.createElement("div");
  wrap.className = "kin-view";

  // Слева — все персонажи с поиском: фокус можно навести на любого, даже
  // на того, у кого пока нет ни одной семейной связи.
  const side = document.createElement("div");
  side.className = "kin-side";
  const search = document.createElement("input");
  search.className = "kin-search";
  search.placeholder = i18n("Найти персонажа");
  const list = document.createElement("div");
  list.className = "kin-list";
  const fillList = () => {
    const q = search.value.trim().toLowerCase();
    list.innerHTML = "";
    for (const c of characters) {
      if (q && !(c.name || "").toLowerCase().includes(q)) continue;
      const item = document.createElement("button");
      item.className = "kin-list-item" + (c.id === prefs.focusId ? " active" : "");
      item.innerHTML = `<span class="ftree-person-avatar small" style="background:${c.color || "#7c7157"}">${avatarInnerHtml(c, `<span>${escapeHtml((c.name || "?").trim().slice(0, 1).toUpperCase())}</span>`)}</span><span class="ftree-person-text"><span class="ftree-person-name">${escapeHtml(c.name || i18n("Без имени"))}</span><span class="ftree-person-role">${escapeHtml(c.role || "")}</span></span>`;
      item.addEventListener("click", () => focusOn(c.id));
      list.appendChild(item);
    }
  };
  search.addEventListener("input", fillList);
  fillList();
  side.append(search, list);

  const main = document.createElement("div");
  main.className = "kin-main";

  if (!characters.some((c) => c.id === prefs.focusId)) {
    prefs.focusId = houses[0]?.list[0]?.id || characters[0]?.id || null;
  }
  const rel = prefs.focusId ? relativesOf(prefs.focusId, characters) : null;
  if (!rel) {
    main.appendChild(buildEmptyState(i18n("Персонажей пока нет – добавь первого."), "tree"));
    wrap.append(side, main);
    return wrap;
  }

  const center = document.createElement("div");
  center.className = "kin-center";

  const up = [
    kinRow(i18n("Бабушки и дедушки"), rel.grandparents),
    kinRow(i18n("Родители"), [...rel.parents, ...rel.stepParents]),
  ].filter(Boolean);

  const me = document.createElement("div");
  me.className = "kin-me-row";
  const siblings = kinRow(i18n("Братья и сёстры"), rel.siblings);
  const partners = kinRow(i18n("Пары"), rel.partners);
  const meCard = kinCard({ c: rel.me }, true);
  const actions = document.createElement("span");
  actions.className = "kin-me-actions";
  const openBtn = document.createElement("button");
  openBtn.className = "btn";
  openBtn.textContent = i18n("Открыть карточку");
  openBtn.addEventListener("click", () => openCharacter(rel.me.id));
  const treeBtn = document.createElement("button");
  treeBtn.className = "btn";
  treeBtn.textContent = i18n("Показать в древе");
  treeBtn.addEventListener("click", () => {
    mode = "tree";
    const house = houses.find((h) => h.byId.has(rel.me.id));
    prefs.houseMember = house ? rel.me.id : null;
    writePrefs({ mode, houseMember: prefs.houseMember });
    draw();
  });
  actions.append(openBtn, treeBtn);
  meCard.querySelector(".ftree-person-text").appendChild(actions);
  me.append(siblings || document.createElement("div"), meCard, partners || document.createElement("div"));

  const down = [
    kinRow(i18n("Дети"), [...rel.children, ...rel.stepChildren]),
    kinRow(i18n("Внуки"), rel.grandchildren),
  ].filter(Boolean);

  for (const r of up) center.appendChild(r);
  if (up.length) center.appendChild(Object.assign(document.createElement("div"), { className: "kin-link" }));
  center.appendChild(me);
  if (down.length) center.appendChild(Object.assign(document.createElement("div"), { className: "kin-link" }));
  for (const r of down) center.appendChild(r);

  const far = [
    kinRow(i18n("Дяди и тёти"), rel.auntsUncles),
    kinRow(i18n("Двоюродные"), rel.cousins),
    kinRow(i18n("Племянники"), rel.nephews),
    kinRow(i18n("Родня супруга"), rel.inLaws),
  ].filter(Boolean);
  if (far.length) {
    const farBox = document.createElement("div");
    farBox.className = "kin-far";
    for (const r of far) farBox.appendChild(r);
    center.appendChild(farBox);
  }
  if (!up.length && !down.length && !siblings && !partners && !far.length) {
    const hint = document.createElement("div");
    hint.className = "kin-empty";
    hint.textContent = i18n("Родня не указана – отметь родителей или пару в карточке персонажа.");
    center.appendChild(hint);
  }

  main.appendChild(center);
  wrap.append(side, main);
  return wrap;
}

function draw() {
  root.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "ftree-wrap";

  const groups = familyGroups();
  const current = prefs.houseMember ? groups.find((g) => g.byId.has(prefs.houseMember)) || null : null;

  if (mode === "focus") {
    wrap.appendChild(buildToolbar(groups, current, null));
    wrap.appendChild(buildFocus(groups));
    root.appendChild(wrap);
    return;
  }

  if (!groups.length) {
    wrap.appendChild(buildToolbar(groups, null, null));
    const empty = buildEmptyState(
      i18n("Пока пусто – укажи родителей/партнёров в карточке персонажа (или добавь нового прямо здесь), чтобы здесь появилось дерево."),
      "tree"
    );
    empty.classList.add("timeline-empty");
    wrap.appendChild(empty);
    root.appendChild(wrap);
    return;
  }

  const tree = buildTree(current ? [current] : groups);
  wrap.appendChild(buildToolbar(groups, current, tree.api));
  tree.viewport.appendChild(tree.legend);
  wrap.appendChild(tree.viewport);
  root.appendChild(wrap);
  tree.api.fit();
}

export async function renderFamilyTree(rootEl) {
  root = rootEl;
  characters = await apiGet("/api/characters");
  prefs = readPrefs();
  mode = prefs.mode === "focus" ? "focus" : "tree";
  draw();
}
