import { uid } from "./api.js";
import { escapeHtml } from "./chips.js";
import { iconSvg } from "./icons.js";
import { i18n, i18nPlural } from "./i18n.js";
import { chapterLabel } from "./books.js";
import { sectionHeading, buildNone, buildSelect, buildSegmented, autoGrow, openEntity } from "./entity-view.js";
import { roughRect, roughDiamond, roughEllipse, roughPolyline, arrowHead, penPath, fillPattern } from "./sketch.js";

// ══════════════════════════════════════════════
//  ХОЛСТ — САМА ДОСКА
//
//  Бесконечное поле: карточки, стрелки между ними, группы-рамки.
//  Щелчок выбирает (Shift — добавить к выбранному), перетаскивание
//  фона — рамка выбора, перетаскивание выбранного — сдвиг всех разом.
//  Двойной щелчок по полю — новая карточка, по карточке — правка текста.
//  Стрелку тянут из точки на краю карточки: отпустили на другой — связь,
//  на пустом месте — новая карточка, уже связанная. Справа — свойства
//  выбранного вместо меню правой кнопки. Ctrl+Z / Ctrl+Shift+Z — отмена
//  и повтор, Delete — удалить, пробел или правая кнопка — двигать поле.
//
//  Данные — те же canvas.json → canvases[id]: cards, edges и groups
//  (рамки { id, x, y, w, h, title, color }), shapes — фигуры, линии,
//  карандаш и надписи (см. vault-guide.md), style — "hand" («От руки»:
//  всё будто нарисовано пером, рукописный шрифт) или нет поля (аккуратно).
// ══════════════════════════════════════════════

export const CARD_COLORS = [null, "#c9944a", "#4f7d74", "#a4483c", "#7d6a9e", "#6a8fae", "#5a8a5f"];
const MIN_W = 140;
const MIN_H = 70;
const MIN_SCALE = 0.2;
const MAX_SCALE = 2.5;
const SVG_NS = "http://www.w3.org/2000/svg";

// Инструменты рисования: [ключ, подпись, значок, клавиши].
const SHAPE_TOOLS = [
  ["rect", "Прямоугольник", '<rect x="4" y="6" width="16" height="12" rx="1"/>', "r к"],
  ["diamond", "Ромб", '<path d="M12 3l9 9-9 9-9-9z"/>', "d в"],
  ["ellipse", "Эллипс", '<ellipse cx="12" cy="12" rx="9" ry="7"/>', "o щ"],
  ["arrow", "Стрелка", '<path d="M4 20 20 4M20 4h-7M20 4v7"/>', "a ф"],
  ["line", "Линия", '<path d="M4 20 20 4"/>', "l д"],
  ["pen", "Карандаш", '<path d="M4 20c4-1 5-6 8-6s3 4 8 2"/>', "p з"],
  ["text", "Надпись", '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>', "t е"],
];
// Цвета фигур; null — цвет текста темы.
const INK_COLORS = [null, "#c76a5c", "#6fa35a", "#5a8fd0", "#d6a75c", "#9a86c4"];
const FONTS = { hand: "Caveat, 'Segoe Print', cursive", ui: "var(--font-ui)", book: "var(--font-book)" };

function shapeBox(s) {
  if (s.points) {
    const xs = s.points.map((p) => p[0]);
    const ys = s.points.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  if (s.kind === "text") {
    const lines = (s.text || " ").split("\n");
    const size = s.fontSize || 24;
    return { x: s.x, y: s.y, w: Math.max(...lines.map((l) => l.length)) * size * 0.5 + 8, h: lines.length * size * 1.25 };
  }
  // Прямоугольник рисуют в любую сторону — w/h могут быть отрицательными.
  return { x: Math.min(s.x, s.x + s.w), y: Math.min(s.y, s.y + s.h), w: Math.abs(s.w), h: Math.abs(s.h) };
}

// История отмены — на холст, переживает перерисовку экрана.
const histories = new Map();
// Масштаб и сдвиг — тоже на холст, только на время работы.
const views = new Map();

export function blankCard(x, y) {
  return { id: uid(), x, y, w: 220, h: 130, text: "", title: "", chapterId: null, color: null };
}

function cardBox(c) {
  return { x: c.x, y: c.y, w: c.w || 220, h: c.h || 130 };
}

// Точка на краю карточки, ближайшем к другой, и направление выхода.
function anchor(a, b) {
  const A = cardBox(a);
  const B = cardBox(b);
  const dx = B.x + B.w / 2 - (A.x + A.w / 2);
  const dy = B.y + B.h / 2 - (A.y + A.h / 2);
  if (Math.abs(dx) * A.h > Math.abs(dy) * A.w) {
    return dx > 0 ? { x: A.x + A.w, y: A.y + A.h / 2, nx: 1, ny: 0 } : { x: A.x, y: A.y + A.h / 2, nx: -1, ny: 0 };
  }
  return dy > 0 ? { x: A.x + A.w / 2, y: A.y + A.h, nx: 0, ny: 1 } : { x: A.x + A.w / 2, y: A.y, nx: 0, ny: -1 };
}

// Плавная стрелка от края к краю; mid — середина кривой для подписи.
export function edgeGeometry(a, b) {
  const p = anchor(a, b);
  const q = anchor(b, a);
  const k = Math.min(90, Math.hypot(q.x - p.x, q.y - p.y) / 2.5);
  const c1 = { x: p.x + p.nx * k, y: p.y + p.ny * k };
  const c2 = { x: q.x + q.nx * k, y: q.y + q.ny * k };
  const mid = {
    x: 0.125 * p.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * q.x,
    y: 0.125 * p.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * q.y,
  };
  return { p, q, c1, c2, mid, d: `M${p.x},${p.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${q.x},${q.y}` };
}

// ctx — что даёт canvas.js: cv (холст), chapters, books, persist(),
// onBack(), focusCardId, onRename().
export function buildBoard(ctx) {
  const { cv } = ctx;
  if (!Array.isArray(cv.groups)) cv.groups = [];
  if (!Array.isArray(cv.shapes)) cv.shapes = [];
  const hand = () => cv.style === "hand";
  if (!histories.has(cv.id)) histories.set(cv.id, { undo: [], redo: [] });
  const history = histories.get(cv.id);

  // Выбор: карточки и рамки — множеством, стрелка — одна.
  let selCards = new Set();
  let selGroups = new Set();
  let selEdge = null;
  let selShapes = new Set();
  let editingId = null;
  let tool = "select";
  let spaceDown = false;

  const pane = document.createElement("div");
  pane.className = "characters-pane cboard";

  // ── Шапка
  const bar = document.createElement("div");
  bar.className = "timeline-toolbar";
  const back = document.createElement("button");
  back.className = "btn";
  back.textContent = i18n("← Все холсты");
  back.addEventListener("click", ctx.onBack);
  const nameInput = document.createElement("input");
  nameInput.className = "cboard-name";
  nameInput.value = cv.name || "";
  nameInput.placeholder = i18n("Название холста");
  nameInput.addEventListener("input", () => {
    cv.name = nameInput.value;
    ctx.persist();
  });
  const meta = document.createElement("div");
  meta.className = "timeline-meta";
  const styleSwitch = buildSegmented([["clean", "Аккуратно"], ["hand", "От руки"]], hand() ? "hand" : "clean", (key) => {
    remember();
    if (key === "hand") cv.style = "hand";
    else delete cv.style;
    styleSwitch.querySelectorAll(".segmented-btn").forEach((b, i) => b.classList.toggle("active", (i === 1) === hand()));
    changed();
  });
  bar.append(back, nameInput, meta, styleSwitch);
  pane.appendChild(bar);

  // ── Поле
  const stage = document.createElement("div");
  stage.className = "cboard-stage";
  const world = document.createElement("div");
  world.className = "cboard-world";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.classList.add("cboard-svg");
  const layer = document.createElement("div");
  layer.className = "cboard-layer";
  const shapesSvg = document.createElementNS(SVG_NS, "svg");
  shapesSvg.classList.add("cboard-svg", "cboard-shapes");
  world.append(svg, layer, shapesSvg);
  const marquee = document.createElement("div");
  marquee.className = "cboard-marquee";
  marquee.hidden = true;
  stage.append(world, marquee);
  pane.appendChild(stage);

  const side = document.createElement("aside");
  side.className = "cboard-side";
  stage.appendChild(side);

  // ── Вид
  let view = views.get(cv.id) || null;
  const applyView = () => {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    zoomLabel.textContent = `${Math.round(view.scale * 100)}%`;
  };
  const toWorld = (clientX, clientY) => {
    const r = stage.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.scale, y: (clientY - r.top - view.y) / view.scale };
  };
  const zoomAt = (factor, sx, sy) => {
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
    view.x = sx - ((sx - view.x) * scale) / view.scale;
    view.y = sy - ((sy - view.y) * scale) / view.scale;
    view.scale = scale;
    applyView();
  };
  const bounds = () => {
    const boxes = [...cv.cards.map(cardBox), ...cv.groups, ...cv.shapes.map(shapeBox)];
    if (!boxes.length) return null;
    const x1 = Math.min(...boxes.map((b) => b.x));
    const y1 = Math.min(...boxes.map((b) => b.y));
    const x2 = Math.max(...boxes.map((b) => b.x + b.w));
    const y2 = Math.max(...boxes.map((b) => b.y + b.h));
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  };
  const fit = () => {
    const r = stage.getBoundingClientRect();
    const b = bounds();
    if (!b || !r.width) {
      view = { x: r.width / 2, y: r.height / 2, scale: 1 };
    } else {
      const scale = Math.min(1.2, Math.max(MIN_SCALE, Math.min((r.width - 120) / b.w, (r.height - 140) / b.h)));
      view = { scale, x: r.width / 2 - (b.x + b.w / 2) * scale, y: r.height / 2 - (b.y + b.h / 2) * scale };
    }
    views.set(cv.id, view);
    applyView();
  };
  const centerOn = (c) => {
    const r = stage.getBoundingClientRect();
    const b = cardBox(c);
    view.x = r.width / 2 - (b.x + b.w / 2) * view.scale;
    view.y = r.height / 2 - (b.y + b.h / 2) * view.scale;
    applyView();
  };

  // ── История
  const snapshot = () => JSON.stringify({ cards: cv.cards, edges: cv.edges, groups: cv.groups, shapes: cv.shapes, style: cv.style });
  const remember = () => {
    history.undo.push(snapshot());
    if (history.undo.length > 80) history.undo.shift();
    history.redo.length = 0;
  };
  const restore = (text) => {
    const s = JSON.parse(text);
    cv.cards = s.cards;
    cv.edges = s.edges;
    cv.groups = s.groups || [];
    cv.shapes = s.shapes || [];
    if (s.style) cv.style = s.style;
    else delete cv.style;
    styleSwitch.querySelectorAll(".segmented-btn").forEach((b, i) => b.classList.toggle("active", (i === 1) === hand()));
  };
  const undo = () => {
    if (!history.undo.length) return;
    history.redo.push(snapshot());
    restore(history.undo.pop());
    clearSelection();
    changed();
  };
  const redo = () => {
    if (!history.redo.length) return;
    history.undo.push(snapshot());
    restore(history.redo.pop());
    clearSelection();
    changed();
  };
  // Одна запись в историю на всю серию правок поля ввода, а не на
  // каждую букву: первая правка после фокуса — remember().
  const rememberOnce = (input) => {
    let done = false;
    input.addEventListener("focus", () => { done = false; });
    return () => {
      if (!done) {
        remember();
        done = true;
      }
    };
  };

  const changed = () => {
    ctx.persist();
    renderScene();
    renderSide();
  };
  const clearSelection = () => {
    selCards = new Set();
    selGroups = new Set();
    selShapes = new Set();
    selEdge = null;
    editingId = null;
  };

  // ── Сцена
  function renderScene() {
    meta.textContent = [
      i18nPlural(cv.cards.length, ["{n} карточка", "{n} карточки", "{n} карточек"]),
      cv.edges.length ? i18nPlural(cv.edges.length, ["{n} стрелка", "{n} стрелки", "{n} стрелок"]) : "",
      cv.groups.length ? i18nPlural(cv.groups.length, ["{n} группа", "{n} группы", "{n} групп"]) : "",
    ].filter(Boolean).join(" · ");
    undoBtn.disabled = !history.undo.length;
    redoBtn.disabled = !history.redo.length;

    stage.classList.toggle("hand-style", hand());
    svg.innerHTML = `<defs><marker id="cboard-arrow-${cv.id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--accent)"/></marker></defs>`;
    layer.innerHTML = "";
    const byId = new Map(cv.cards.map((c) => [c.id, c]));

    for (const g of cv.groups) {
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", g.x);
      rect.setAttribute("y", g.y);
      rect.setAttribute("width", g.w);
      rect.setAttribute("height", g.h);
      rect.setAttribute("rx", 14);
      rect.classList.add("cboard-group");
      rect.style.setProperty("--group-color", g.color || "var(--accent)");
      svg.appendChild(rect);
      const tab = document.createElement("div");
      tab.className = "cboard-group-title";
      tab.dataset.group = g.id;
      tab.style.left = `${g.x + 14}px`;
      tab.style.top = `${g.y - 12}px`;
      tab.style.setProperty("--group-color", g.color || "var(--accent)");
      tab.textContent = g.title || i18n("Группа");
      layer.appendChild(tab);
      const handle = document.createElement("div");
      handle.className = "cboard-resize cboard-group-resize";
      handle.dataset.resizeGroup = g.id;
      handle.style.left = `${g.x + g.w - 8}px`;
      handle.style.top = `${g.y + g.h - 8}px`;
      layer.appendChild(handle);
    }

    const labels = [];
    for (const e of cv.edges) {
      const a = byId.get(e.fromId);
      const b = byId.get(e.toId);
      if (!a || !b) continue;
      const geo = edgeGeometry(a, b);
      const path = document.createElementNS(SVG_NS, "path");
      path.classList.add("cboard-edge");
      path.dataset.edgeId = e.id;
      if (hand()) {
        // Кривая — по точкам, а точки — пером.
        const pts = [];
        for (let i = 0; i <= 8; i++) {
          const t = i / 8;
          const u = 1 - t;
          pts.push([
            u * u * u * geo.p.x + 3 * u * u * t * geo.c1.x + 3 * u * t * t * geo.c2.x + t * t * t * geo.q.x,
            u * u * u * geo.p.y + 3 * u * u * t * geo.c1.y + 3 * u * t * t * geo.c2.y + t * t * t * geo.q.y,
          ]);
        }
        path.setAttribute("d", roughPolyline(pts, e.id, 1) + arrowHead(pts, e.id, 1));
      } else {
        path.setAttribute("d", geo.d);
        path.setAttribute("marker-end", `url(#cboard-arrow-${cv.id})`);
      }
      svg.appendChild(path);
      const hit = document.createElementNS(SVG_NS, "path");
      hit.setAttribute("d", geo.d);
      hit.classList.add("cboard-edge-hit");
      hit.dataset.edge = e.id;
      svg.appendChild(hit);
      if (e.label) {
        // Подписи — поверх карточек: между соседними карточками иначе их не видно.
        const label = document.createElement("div");
        label.className = "cboard-edge-label";
        label.dataset.edge = e.id;
        label.style.left = `${geo.mid.x}px`;
        label.style.top = `${geo.mid.y}px`;
        label.textContent = e.label;
        labels.push(label);
      }
    }

    if (hand()) {
      // Карточка от руки — контур пером под прозрачной карточкой; цветная
      // — со штриховкой своего цвета.
      const defs = svg.querySelector("defs");
      for (const c of cv.cards) {
        const b = cardBox(c);
        if (c.color) {
          defs.insertAdjacentHTML("beforeend", fillPattern(`cbh-${c.id}`, c.color, "hachure"));
          const fill = document.createElementNS(SVG_NS, "rect");
          for (const [k, v] of Object.entries({ x: b.x + 3, y: b.y + 3, width: b.w - 6, height: b.h - 6, fill: `url(#cbh-${c.id})` })) fill.setAttribute(k, v);
          svg.appendChild(fill);
        }
        const outline = document.createElementNS(SVG_NS, "path");
        outline.setAttribute("d", roughRect(b.x, b.y, b.w, b.h, c.id, 1));
        outline.classList.add("cboard-card-sketch");
        if (c.color) outline.style.stroke = c.color;
        svg.appendChild(outline);
      }
    }
    for (const c of cv.cards) layer.appendChild(buildCard(c));
    layer.append(...labels);
    renderShapes();
    markSelection();
  }

  // Фигуры, линии, карандаш, надписи — над карточками.
  function renderShapes() {
    const defs = [];
    let html = "";
    for (const s of cv.shapes) {
      const rough = hand() ? (s.roughness ?? 1) : 0;
      const stroke = s.stroke || "var(--text)";
      const width = s.strokeWidth || 2;
      const b = shapeBox(s);
      let outline = "";
      let fillD = "";
      if (s.kind === "rect" || s.kind === "diamond" || s.kind === "ellipse") {
        const make = { rect: roughRect, diamond: roughDiamond, ellipse: roughEllipse }[s.kind];
        outline = make(b.x, b.y, b.w, b.h, s.id, rough);
        fillD = make(b.x, b.y, b.w, b.h, `${s.id}f`, 0);
      } else if (s.kind === "line" || s.kind === "arrow") {
        outline = roughPolyline(s.points, s.id, rough) + (s.kind === "arrow" ? arrowHead(s.points, s.id, rough, 10 + width * 3) : "");
      } else if (s.kind === "pen") {
        outline = penPath(s.points);
      }
      let fill = "";
      if (s.fill && fillD) {
        if (s.fillStyle === "solid") fill = `<path d="${fillD}" fill="${s.fill}" fill-opacity=".45" stroke="none"/>`;
        else {
          const id = `cbf-${s.id}`;
          defs.push(fillPattern(id, s.fill, s.fillStyle === "cross" ? "cross" : "hachure"));
          fill = `<path d="${fillD}" fill="url(#${id})" stroke="none"/>`;
        }
      }
      let body = "";
      if (s.kind === "text") {
        const size = s.fontSize || 24;
        const font = FONTS[s.font || (hand() ? "hand" : "ui")] || FONTS.ui;
        const lines = (s.text || "").split("\n");
        body = `<text x="${s.x}" y="${s.y}" fill="${stroke}" style="font-family:${font};font-size:${size}px">${lines
          .map((line, i) => `<tspan x="${s.x}" dy="${i ? size * 1.25 : size}">${escapeHtml(line) || " "}</tspan>`).join("")}</text>`;
      } else {
        body = `${fill}<path d="${outline}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
      }
      // Невидимая широкая обводка — по ней легко попасть мышью.
      const hitD = s.kind === "text" ? "" : (fillD || (s.kind === "pen" ? outline : roughPolyline(s.points || [], s.id, 0)));
      const hit = s.kind === "text"
        ? `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" class="cboard-shape-hit filled"/>`
        : `<path d="${hitD}" class="cboard-shape-hit${s.fill ? " filled" : ""}"/>`;
      html += `<g data-shape="${escapeHtml(s.id)}">${body}${hit}</g>`;
      if (selShapes.has(s.id)) {
        html += `<rect x="${b.x - 6}" y="${b.y - 6}" width="${b.w + 12}" height="${b.h + 12}" class="cboard-shape-sel"/>`;
        if (selShapes.size === 1 && !s.points) {
          html += `<rect x="${b.x + b.w}" y="${b.y + b.h}" width="12" height="12" class="cboard-shape-handle" data-resize-shape="${escapeHtml(s.id)}"/>`;
        }
      }
    }
    shapesSvg.innerHTML = `<defs>${defs.join("")}</defs>${html}`;
  }

  // Выбор меняет только классы — без перерисовки, иначе узел под
  // курсором подменяется между щелчками и двойной щелчок не доходит.
  function markSelection() {
    layer.querySelectorAll("[data-card]").forEach((el) => el.classList.toggle("selected", selCards.has(el.dataset.card)));
    layer.querySelectorAll(".cboard-group-title").forEach((el) => el.classList.toggle("selected", selGroups.has(el.dataset.group)));
    layer.querySelectorAll("[data-resize-group]").forEach((el) => el.classList.toggle("selected", selGroups.has(el.dataset.resizeGroup)));
    svg.querySelectorAll(".cboard-group").forEach((el, i) => el.classList.toggle("selected", selGroups.has(cv.groups[i]?.id)));
    svg.querySelectorAll(".cboard-edge:not(.cboard-edge-ghost)").forEach((el) => el.classList.toggle("selected", el.dataset.edgeId === selEdge));
    layer.querySelectorAll(".cboard-edge-label").forEach((el) => el.classList.toggle("selected", el.dataset.edge === selEdge));
    stage.classList.toggle("single", selCards.size === 1 && !selGroups.size && !selShapes.size);
    stage.classList.toggle("single-group", selGroups.size === 1 && !selCards.size);
  }

  function buildCard(c) {
    const b = cardBox(c);
    const el = document.createElement("div");
    el.className = "cboard-card" + (c.color ? " colored" : "") + (hand() ? " hand" : "");
    el.dataset.card = c.id;
    el.style.left = `${b.x}px`;
    el.style.top = `${b.y}px`;
    el.style.width = `${b.w}px`;
    el.style.height = `${b.h}px`;
    if (c.color) el.style.setProperty("--card-color", c.color);

    if (editingId === c.id) {
      const title = document.createElement("input");
      title.className = "cboard-card-title-input";
      title.placeholder = i18n("Заголовок");
      title.value = c.title || "";
      const text = document.createElement("textarea");
      text.className = "cboard-card-text-input";
      text.placeholder = i18n("Текст карточки");
      text.value = c.text || "";
      const once = rememberOnce(title);
      const once2 = rememberOnce(text);
      title.addEventListener("input", () => { once(); c.title = title.value; ctx.persist(); });
      text.addEventListener("input", () => { once2(); c.text = text.value; ctx.persist(); });
      // Ушли из обоих полей — правка кончилась.
      const finish = () => setTimeout(() => {
        if (el.contains(document.activeElement)) return;
        if (editingId === c.id) {
          editingId = null;
          renderScene();
          renderSide();
        }
      }, 0);
      title.addEventListener("blur", finish);
      text.addEventListener("blur", finish);
      for (const input of [title, text]) {
        input.addEventListener("keydown", (e) => {
          if (e.key === "Escape") input.blur();
          if (e.key === "Enter" && input === title) text.focus();
        });
      }
      el.append(title, text);
      setTimeout(() => (c.text || c.title ? text : title).focus(), 0);
    } else {
      if (c.title) {
        const t = document.createElement("div");
        t.className = "cboard-card-title";
        t.textContent = c.title;
        el.appendChild(t);
      }
      const body = document.createElement("div");
      body.className = "cboard-card-text";
      body.textContent = c.text || "";
      if (!c.text && !c.title) {
        body.classList.add("empty");
        body.textContent = i18n("Двойной щелчок – написать");
      }
      el.appendChild(body);
      const linked = c.chapterId ? ctx.chapters.find((ch) => ch.id === c.chapterId) : null;
      const chapterText = linked ? chapterLabel(linked, ctx.books) : c.chapterLabel;
      if (chapterText) {
        const chip = document.createElement(linked ? "button" : "span");
        chip.className = "cboard-chip";
        chip.innerHTML = `${iconSvg("manuscript", 11)}<span>${escapeHtml(chapterText)}</span>`;
        if (linked) {
          chip.title = i18n("Открыть главу");
          chip.dataset.openChapter = linked.id;
        }
        el.appendChild(chip);
      }
    }

    // Точки для стрелок — по краям; рычажок размера — у одной выбранной.
    for (const side of ["top", "right", "bottom", "left"]) {
      const port = document.createElement("span");
      port.className = `cboard-port ${side}`;
      port.dataset.port = c.id;
      port.title = i18n("Тяните к другой карточке – стрелка; на пустое место – новая карточка");
      el.appendChild(port);
    }
    // Видно только у единственной выбранной (CSS: .cboard-stage.single).
    if (editingId !== c.id) {
      const handle = document.createElement("span");
      handle.className = "cboard-resize";
      handle.dataset.resizeCard = c.id;
      el.appendChild(handle);
    }
    return el;
  }

  // ── Панель свойств
  const field = (label, control) => {
    const row = document.createElement("label");
    row.className = "cboard-field";
    const span = document.createElement("span");
    span.textContent = label;
    row.append(span, control);
    side.appendChild(row);
    return row;
  };
  const colorRow = (current, onPick) => {
    const row = document.createElement("div");
    row.className = "color-row cboard-colors";
    for (const color of CARD_COLORS) {
      const sw = document.createElement("div");
      sw.className = "swatch" + (color ? "" : " swatch-none") + ((current || null) === color ? " selected" : "");
      if (color) sw.style.background = color;
      sw.title = color ? "" : i18n("Без цвета");
      sw.addEventListener("click", () => onPick(color));
      row.appendChild(sw);
    }
    return row;
  };
  const deleteButton = (label) => {
    const del = document.createElement("button");
    del.className = "btn danger cboard-delete";
    del.innerHTML = `${iconSvg("trash", 14)}<span>${escapeHtml(label)}</span>`;
    del.addEventListener("click", removeSelection);
    side.appendChild(del);
  };

  function renderSide() {
    side.innerHTML = "";
    const cards = cv.cards.filter((c) => selCards.has(c.id));
    const groups = cv.groups.filter((g) => selGroups.has(g.id));
    const shapes = cv.shapes.filter((x) => selShapes.has(x.id));
    const edge = cv.edges.find((e) => e.id === selEdge);
    side.hidden = !cards.length && !groups.length && !edge && !shapes.length;
    if (side.hidden) return;

    if (shapes.length && !cards.length && !groups.length) {
      buildShapeSide(shapes);
      return;
    }

    if (cards.length === 1 && !groups.length) {
      const c = cards[0];
      side.appendChild(sectionHeading(i18n("Карточка")));
      const title = document.createElement("input");
      title.className = "characters-search";
      title.value = c.title || "";
      title.placeholder = i18n("Без заголовка");
      const once = rememberOnce(title);
      title.addEventListener("input", () => { once(); c.title = title.value; ctx.persist(); renderScene(); });
      field(i18n("Заголовок"), title);
      const text = document.createElement("textarea");
      text.className = "cboard-textarea";
      text.rows = 3;
      text.value = c.text || "";
      text.placeholder = i18n("Текст карточки");
      autoGrow(text);
      const once2 = rememberOnce(text);
      text.addEventListener("input", () => { once2(); c.text = text.value; ctx.persist(); renderScene(); });
      field(i18n("Текст"), text);
      const chapterOptions = [["", "– не привязана –"], ...ctx.chapters.map((ch) => [ch.id, chapterLabel(ch, ctx.books)])];
      const chapter = buildSelect(chapterOptions, c.chapterId || "", (value) => {
        remember();
        c.chapterId = value || null;
        if (value) c.chapterLabel = "";
        changed();
      }, "kin-kind-select cboard-select");
      field(i18n("Глава"), chapter);
      field(i18n("Цвет"), colorRow(c.color, (color) => {
        remember();
        c.color = color;
        changed();
      }));
      side.appendChild(sectionHeading(i18n("Связи")));
      const touching = cv.edges.filter((e) => e.fromId === c.id || e.toId === c.id);
      for (const e of touching) {
        const other = cv.cards.find((x) => x.id === (e.fromId === c.id ? e.toId : e.fromId));
        if (!other) continue;
        const row = document.createElement("button");
        row.className = "dossier-link-row";
        row.innerHTML = `<span class="dossier-row-icon">${e.fromId === c.id ? "→" : "←"}</span><span class="dossier-link-text">${escapeHtml(other.title || (other.text || "").slice(0, 30) || i18n("Без заголовка"))}</span>${e.label ? `<small>${escapeHtml(e.label)}</small>` : ""}`;
        row.addEventListener("click", () => {
          clearSelection();
          selCards.add(other.id);
          renderScene();
          renderSide();
          centerOn(other);
        });
        side.appendChild(row);
      }
      if (!touching.length) side.appendChild(buildNone(i18n("Тяните стрелку из точки на краю карточки")));
      deleteButton(i18n("Удалить карточку"));
      return;
    }

    if (edge && !cards.length && !groups.length) {
      side.appendChild(sectionHeading(i18n("Стрелка")));
      const label = document.createElement("input");
      label.className = "characters-search cboard-edge-input";
      label.value = edge.label || "";
      label.placeholder = i18n("Подпись (необязательно)");
      const once = rememberOnce(label);
      label.addEventListener("input", () => { once(); edge.label = label.value; ctx.persist(); renderScene(); });
      field(i18n("Подпись"), label);
      const flip = document.createElement("button");
      flip.className = "btn cboard-wide";
      flip.textContent = i18n("Развернуть стрелку");
      flip.addEventListener("click", () => {
        remember();
        [edge.fromId, edge.toId] = [edge.toId, edge.fromId];
        changed();
      });
      side.appendChild(flip);
      deleteButton(i18n("Удалить стрелку"));
      return;
    }

    if (groups.length === 1 && !cards.length) {
      const g = groups[0];
      side.appendChild(sectionHeading(i18n("Группа")));
      const title = document.createElement("input");
      title.className = "characters-search";
      title.value = g.title || "";
      title.placeholder = i18n("Группа");
      const once = rememberOnce(title);
      title.addEventListener("input", () => { once(); g.title = title.value; ctx.persist(); renderScene(); });
      field(i18n("Название"), title);
      field(i18n("Цвет"), colorRow(g.color, (color) => {
        remember();
        g.color = color;
        changed();
      }));
      side.appendChild(buildNone(i18n("Тяните за название – рамка поедет вместе с карточками внутри")));
      deleteButton(i18n("Убрать рамку"));
      return;
    }

    // Несколько сразу
    side.appendChild(sectionHeading(i18n("Выбрано: {n}", { n: cards.length + groups.length })));
    if (cards.length) {
      field(i18n("Цвет карточек"), colorRow(null, (color) => {
        remember();
        for (const c of cards) c.color = color;
        changed();
      }));
      const group = document.createElement("button");
      group.className = "btn cboard-wide";
      group.textContent = i18n("Объединить в группу");
      group.addEventListener("click", () => groupSelection());
      side.appendChild(group);
    }
    deleteButton(i18n("Удалить выбранное"));
  }

  // Свойства фигур — сразу для всех выбранных.
  function buildShapeSide(shapes) {
    const one = shapes.length === 1 ? shapes[0] : null;
    const names = { rect: "Прямоугольник", diamond: "Ромб", ellipse: "Эллипс", arrow: "Стрелка", line: "Линия", pen: "Карандаш", text: "Надпись" };
    side.appendChild(sectionHeading(one ? i18n(names[one.kind]) : i18n("Выбрано: {n}", { n: shapes.length })));
    const apply = (patch) => {
      remember();
      for (const sh of shapes) {
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined || v === null) delete sh[k];
          else sh[k] = v;
        }
      }
      changed();
    };
    const swatches = (current, onPick, withNone) => {
      const row = document.createElement("div");
      row.className = "color-row cboard-colors";
      for (const color of withNone ? [undefined, ...INK_COLORS.slice(1)] : INK_COLORS) {
        const sw = document.createElement("div");
        sw.className = "swatch" + (color ? "" : " swatch-none") + ((current || undefined) === (color || undefined) ? " selected" : "");
        if (color) sw.style.background = color;
        else if (!withNone) sw.style.background = "var(--text)";
        sw.title = color ? "" : i18n(withNone ? "Без заливки" : "Цвет текста");
        sw.addEventListener("click", () => onPick(color));
        row.appendChild(sw);
      }
      return row;
    };
    const first = shapes[0];
    if (one?.kind === "text") {
      const text = document.createElement("textarea");
      text.className = "cboard-textarea cboard-shape-text";
      text.rows = 2;
      text.value = one.text || "";
      autoGrow(text);
      const once = rememberOnce(text);
      text.addEventListener("input", () => { once(); one.text = text.value; ctx.persist(); renderShapes(); });
      field(i18n("Текст"), text);
    }
    field(i18n("Обводка"), swatches(first.stroke, (color) => apply({ stroke: color })));
    const closed = shapes.every((x) => ["rect", "diamond", "ellipse"].includes(x.kind));
    if (closed) {
      field(i18n("Фон"), swatches(first.fill, (color) => apply({ fill: color }), true));
      if (shapes.some((x) => x.fill)) {
        field(i18n("Заливка"), buildSegmented([["hachure", "Штрих"], ["cross", "Сетка"], ["solid", "Сплошная"]], first.fillStyle || "hachure",
          (key) => apply({ fillStyle: key === "hachure" ? undefined : key })));
      }
    }
    if (!shapes.some((x) => x.kind === "text")) {
      field(i18n("Толщина"), buildSegmented([["1", "Тонко"], ["2", "Обычно"], ["4", "Жирно"]], String(first.strokeWidth || 2),
        (key) => apply({ strokeWidth: key === "2" ? undefined : Number(key) })));
      if (hand() && !shapes.some((x) => x.kind === "pen")) {
        field(i18n("Небрежность"), buildSegmented([["0", "Ровно"], ["1", "От руки"], ["2", "Набросок"]], String(first.roughness ?? 1),
          (key) => apply({ roughness: key === "1" ? undefined : Number(key) })));
      }
    }
    if (shapes.every((x) => x.kind === "text")) {
      field(i18n("Шрифт"), buildSegmented([["hand", "Рука"], ["ui", "Обычный"], ["book", "Книжный"]], first.font || (hand() ? "hand" : "ui"),
        (key) => apply({ font: key })));
      const size = document.createElement("input");
      size.type = "range";
      size.min = 12;
      size.max = 72;
      size.value = first.fontSize || 24;
      size.addEventListener("change", () => apply({ fontSize: Number(size.value) }));
      field(i18n("Размер"), size);
    }
    deleteButton(shapes.length > 1 ? i18n("Удалить выбранное") : i18n("Удалить"));
  }

  // ── Действия
  function addCardAt(x, y, edit = true) {
    remember();
    const card = blankCard(Math.round(x - 110), Math.round(y - 65));
    cv.cards.push(card);
    clearSelection();
    selCards.add(card.id);
    if (edit) editingId = card.id;
    changed();
    return card;
  }

  function groupSelection() {
    remember();
    const boxes = [...cv.cards.filter((c) => selCards.has(c.id)).map(cardBox), ...cv.groups.filter((g) => selGroups.has(g.id))];
    let g;
    if (boxes.length) {
      const pad = 30;
      const x1 = Math.min(...boxes.map((b) => b.x)) - pad;
      const y1 = Math.min(...boxes.map((b) => b.y)) - pad;
      const x2 = Math.max(...boxes.map((b) => b.x + b.w)) + pad;
      const y2 = Math.max(...boxes.map((b) => b.y + b.h)) + pad;
      g = { id: uid(), x: x1, y: y1, w: x2 - x1, h: y2 - y1, title: i18n("Группа"), color: null };
    } else {
      const r = stage.getBoundingClientRect();
      const c = toWorld(r.left + r.width / 2, r.top + r.height / 2);
      g = { id: uid(), x: Math.round(c.x - 220), y: Math.round(c.y - 140), w: 440, h: 280, title: i18n("Группа"), color: null };
    }
    cv.groups.push(g);
    clearSelection();
    selGroups.add(g.id);
    changed();
  }

  function removeSelection() {
    if (!selCards.size && !selGroups.size && !selEdge && !selShapes.size) return;
    remember();
    cv.shapes = cv.shapes.filter((x) => !selShapes.has(x.id));
    cv.cards = cv.cards.filter((c) => !selCards.has(c.id));
    cv.edges = cv.edges.filter((e) => e.id !== selEdge && !selCards.has(e.fromId) && !selCards.has(e.toId));
    cv.groups = cv.groups.filter((g) => !selGroups.has(g.id));
    clearSelection();
    changed();
  }

  // Что поедет: выбранные карточки, фигуры и рамки, а с рамкой — то,
  // что внутри. Для линий и карандаша запоминаем все точки.
  function movingSet() {
    const moving = new Map();
    const remember = (item) => {
      if (!moving.has(item)) moving.set(item, item.points ? { points: item.points.map((p) => [...p]) } : { x: item.x, y: item.y });
    };
    for (const c of cv.cards) if (selCards.has(c.id)) remember(c);
    for (const x of cv.shapes) if (selShapes.has(x.id)) remember(x);
    for (const g of cv.groups) {
      if (!selGroups.has(g.id)) continue;
      remember(g);
      for (const c of cardsInside(g)) remember(c);
    }
    return moving;
  }

  // Карточки, чей центр внутри рамки, — едут вместе с ней.
  function cardsInside(g) {
    return cv.cards.filter((c) => {
      const b = cardBox(c);
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      return cx > g.x && cx < g.x + g.w && cy > g.y && cy < g.y + g.h;
    });
  }

  // ── Нажатия
  let gesture = null;
  const pointers = new Map();

  stage.addEventListener("pointerdown", (e) => {
    if (!view || e.target.closest(".cboard-side, .cboard-bar, input, textarea, select")) return;
    if (e.target.closest(".cboard-chip[data-open-chapter]")) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {
      // указатель уже отпущен (бывает у пера и при быстром щелчке)
    }
    const pt = toWorld(e.clientX, e.clientY);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { kind: "pinch", dist: Math.hypot(a.x - b.x, a.y - b.y) };
      return;
    }
    const panning = e.button === 1 || e.button === 2 || spaceDown || tool === "hand";
    if (panning) {
      gesture = { kind: "pan", x: e.clientX, y: e.clientY };
      stage.classList.add("panning");
      return;
    }
    // Инструмент рисования — новая фигура там, где нажали.
    const drawTool = SHAPE_TOOLS.find(([key]) => key === tool);
    if (drawTool && e.button === 0) {
      remember();
      let shape;
      const base = { id: uid(), kind: tool };
      if (tool === "text") {
        shape = { ...base, x: Math.round(pt.x), y: Math.round(pt.y), text: i18n("Надпись"), fontSize: 24 };
        cv.shapes.push(shape);
        clearSelection();
        selShapes.add(shape.id);
        setTool("select");
        changed();
        // Без этого браузер по умолчанию отдаст фокус полю под курсором —
        // и первые буквы пропадут мимо надписи.
        e.preventDefault();
        const input = side.querySelector(".cboard-shape-text");
        input?.focus();
        input?.select();
        return;
      }
      if (tool === "rect" || tool === "diamond" || tool === "ellipse") shape = { ...base, x: pt.x, y: pt.y, w: 0, h: 0 };
      else shape = { ...base, points: tool === "pen" ? [[pt.x, pt.y]] : [[pt.x, pt.y], [pt.x, pt.y]] };
      cv.shapes.push(shape);
      gesture = { kind: "draw", shape, start: pt };
      return;
    }
    const resizeShape = e.target.closest("[data-resize-shape]");
    if (resizeShape) {
      const item = cv.shapes.find((x) => x.id === resizeShape.dataset.resizeShape);
      const b = shapeBox(item);
      Object.assign(item, item.kind === "text" ? {} : { x: b.x, y: b.y, w: b.w, h: b.h });
      gesture = { kind: "resize", item, start: pt, w: b.w, h: b.h, moved: false, isShape: true };
      return;
    }
    const shapeEl = e.target.closest("[data-shape]");
    if (shapeEl) {
      const id = shapeEl.dataset.shape;
      if (e.shiftKey) {
        if (selShapes.has(id)) selShapes.delete(id);
        else selShapes.add(id);
      } else if (!selShapes.has(id)) {
        clearSelection();
        selShapes.add(id);
      }
      gesture = { kind: "move", start: pt, moving: movingSet(), moved: false };
      renderShapes();
      markSelection();
      renderSide();
      return;
    }
    const port = e.target.closest("[data-port]");
    if (port) {
      gesture = { kind: "connect", fromId: port.dataset.port, start: pt };
      return;
    }
    const resizeCard = e.target.closest("[data-resize-card]");
    const resizeGroup = e.target.closest("[data-resize-group]");
    if (resizeCard || resizeGroup) {
      const item = resizeCard ? cv.cards.find((c) => c.id === resizeCard.dataset.resizeCard) : cv.groups.find((g) => g.id === resizeGroup.dataset.resizeGroup);
      const b = resizeCard ? cardBox(item) : item;
      gesture = { kind: "resize", item, start: pt, w: b.w, h: b.h, moved: false, isCard: Boolean(resizeCard) };
      return;
    }
    const cardEl = e.target.closest("[data-card]");
    const groupEl = e.target.closest("[data-group]");
    const edgeEl = e.target.closest("[data-edge]");
    if (cardEl || groupEl) {
      const id = cardEl ? cardEl.dataset.card : groupEl.dataset.group;
      // clearSelection() заводит новые множества — берём их заново.
      const set = () => (cardEl ? selCards : selGroups);
      if (e.shiftKey) {
        if (set().has(id)) set().delete(id);
        else set().add(id);
      } else if (!set().has(id)) {
        clearSelection();
        set().add(id);
      }
      selEdge = null;
      if (editingId && editingId !== id) editingId = null;
      gesture = { kind: "move", start: pt, moving: movingSet(), moved: false };
      renderShapes();
      markSelection();
      renderSide();
      return;
    }
    if (edgeEl) {
      clearSelection();
      selEdge = edgeEl.dataset.edge;
      gesture = null;
      renderShapes();
      markSelection();
      renderSide();
      return;
    }
    // Пустое место — рамка выбора.
    gesture = { kind: "marquee", start: pt, sx: e.clientX, sy: e.clientY, add: e.shiftKey, moved: false };
  });

  stage.addEventListener("pointermove", (e) => {
    if (!gesture) return;
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pt = toWorld(e.clientX, e.clientY);
    const r = stage.getBoundingClientRect();
    if (gesture.kind === "pinch" && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt(dist / gesture.dist, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      gesture.dist = dist;
    } else if (gesture.kind === "pan") {
      view.x += e.clientX - gesture.x;
      view.y += e.clientY - gesture.y;
      gesture.x = e.clientX;
      gesture.y = e.clientY;
      applyView();
    } else if (gesture.kind === "move") {
      const dx = pt.x - gesture.start.x;
      const dy = pt.y - gesture.start.y;
      if (!gesture.moved && Math.hypot(dx, dy) * view.scale < 4) return;
      if (!gesture.moved) {
        remember();
        gesture.moved = true;
        if (editingId) editingId = null;
      }
      for (const [item, from] of gesture.moving) {
        if (from.points) item.points = from.points.map(([x, y]) => [Math.round(x + dx), Math.round(y + dy)]);
        else {
          item.x = Math.round(from.x + dx);
          item.y = Math.round(from.y + dy);
        }
      }
      if ([...gesture.moving.keys()].every((item) => cv.shapes.includes(item))) renderShapes();
      else renderScene();
    } else if (gesture.kind === "resize") {
      if (!gesture.moved) {
        remember();
        gesture.moved = true;
      }
      const item = gesture.item;
      if (gesture.isShape) {
        if (item.kind === "text") item.fontSize = Math.max(10, Math.min(120, Math.round((gesture.h + pt.y - gesture.start.y) / 1.25)));
        else {
          item.w = Math.max(8, Math.round(gesture.w + pt.x - gesture.start.x));
          item.h = Math.max(8, Math.round(gesture.h + pt.y - gesture.start.y));
        }
        renderShapes();
        return;
      }
      item.w = Math.max(gesture.isCard ? MIN_W : 200, Math.round(gesture.w + pt.x - gesture.start.x));
      item.h = Math.max(gesture.isCard ? MIN_H : 120, Math.round(gesture.h + pt.y - gesture.start.y));
      renderScene();
    } else if (gesture.kind === "draw") {
      const sh = gesture.shape;
      if (sh.kind === "pen") {
        const [lx, ly] = sh.points[sh.points.length - 1];
        if (Math.hypot(pt.x - lx, pt.y - ly) * view.scale < 3) return;
        sh.points.push([Math.round(pt.x * 10) / 10, Math.round(pt.y * 10) / 10]);
      } else if (sh.points) {
        sh.points[1] = [Math.round(pt.x), Math.round(pt.y)];
      } else {
        sh.w = Math.round(pt.x - gesture.start.x);
        sh.h = Math.round(pt.y - gesture.start.y);
        // Shift — ровный квадрат или круг.
        if (e.shiftKey) {
          const side = Math.max(Math.abs(sh.w), Math.abs(sh.h));
          sh.w = Math.sign(sh.w || 1) * side;
          sh.h = Math.sign(sh.h || 1) * side;
        }
      }
      renderShapes();
    } else if (gesture.kind === "connect") {
      const from = cv.cards.find((c) => c.id === gesture.fromId);
      const b = cardBox(from);
      const ghost = { x: pt.x - 1, y: pt.y - 1, w: 2, h: 2 };
      const geo = edgeGeometry({ ...b }, ghost);
      let line = svg.querySelector(".cboard-edge-ghost");
      if (!line) {
        line = document.createElementNS(SVG_NS, "path");
        line.classList.add("cboard-edge", "cboard-edge-ghost");
        line.setAttribute("marker-end", `url(#cboard-arrow-${cv.id})`);
        svg.appendChild(line);
      }
      line.setAttribute("d", geo.d);
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-card]");
      layer.querySelectorAll(".cboard-card.drop-target").forEach((x) => x.classList.remove("drop-target"));
      if (over && over.dataset.card !== gesture.fromId) over.classList.add("drop-target");
    } else if (gesture.kind === "marquee") {
      const x = Math.min(e.clientX, gesture.sx) - r.left;
      const y = Math.min(e.clientY, gesture.sy) - r.top;
      const w = Math.abs(e.clientX - gesture.sx);
      const h = Math.abs(e.clientY - gesture.sy);
      if (!gesture.moved && w + h < 6) return;
      gesture.moved = true;
      marquee.hidden = false;
      Object.assign(marquee.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
      const x1 = Math.min(pt.x, gesture.start.x);
      const y1 = Math.min(pt.y, gesture.start.y);
      const x2 = Math.max(pt.x, gesture.start.x);
      const y2 = Math.max(pt.y, gesture.start.y);
      const inside = (b) => b.x >= x1 && b.y >= y1 && b.x + b.w <= x2 && b.y + b.h <= y2;
      if (!gesture.add) clearSelection();
      gesture.base ||= { cards: new Set(selCards), groups: new Set(selGroups) };
      gesture.base.shapes ||= new Set(selShapes);
      selCards = new Set([...gesture.base.cards, ...cv.cards.filter((c) => inside(cardBox(c))).map((c) => c.id)]);
      selGroups = new Set([...gesture.base.groups, ...cv.groups.filter(inside).map((g) => g.id)]);
      selShapes = new Set([...gesture.base.shapes, ...cv.shapes.filter((x) => inside(shapeBox(x))).map((x) => x.id)]);
      renderShapes();
      markSelection();
    }
  });

  const endGesture = (e) => {
    pointers.delete(e.pointerId);
    const g = gesture;
    if (pointers.size === 0) gesture = null;
    stage.classList.remove("panning");
    if (!g) return;
    if (g.kind === "draw") {
      const sh = g.shape;
      const b = shapeBox(sh);
      const tiny = sh.kind === "pen" ? sh.points.length < 2 : b.w + b.h < 6;
      if (tiny) {
        // Щелчок без протяжки — фигуры нет, и в истории её нет.
        cv.shapes = cv.shapes.filter((x) => x !== sh);
        history.undo.pop();
        renderShapes();
        return;
      }
      if (sh.w !== undefined) Object.assign(sh, b);
      clearSelection();
      selShapes.add(sh.id);
      // Карандаш остаётся в руке, остальное — снова «Выбор».
      if (sh.kind !== "pen") setTool("select");
      changed();
    } else if (g.kind === "move" || g.kind === "resize") {
      if (g.moved) ctx.persist();
      renderSide();
    } else if (g.kind === "connect") {
      svg.querySelector(".cboard-edge-ghost")?.remove();
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-card]");
      const pt = toWorld(e.clientX, e.clientY);
      if (over && over.dataset.card !== g.fromId) {
        const toId = over.dataset.card;
        if (!cv.edges.some((x) => x.fromId === g.fromId && x.toId === toId)) {
          remember();
          const edge = { id: uid(), fromId: g.fromId, toId, label: "" };
          cv.edges.push(edge);
          clearSelection();
          selEdge = edge.id;
          changed();
          side.querySelector(".cboard-edge-input")?.focus();
        }
      } else if (!over && Math.hypot(pt.x - g.start.x, pt.y - g.start.y) > 40) {
        // На пустое место — новая карточка, сразу со стрелкой к ней.
        remember();
        const card = blankCard(Math.round(pt.x - 110), Math.round(pt.y - 65));
        cv.cards.push(card);
        cv.edges.push({ id: uid(), fromId: g.fromId, toId: card.id, label: "" });
        clearSelection();
        selCards.add(card.id);
        editingId = card.id;
        changed();
      } else {
        renderScene();
      }
    } else if (g.kind === "marquee") {
      marquee.hidden = true;
      if (!g.moved && !g.add) {
        const wasEditing = editingId;
        clearSelection();
        if (wasEditing) renderScene();
        else renderShapes();
      }
      markSelection();
      renderSide();
    }
  };
  stage.addEventListener("pointerup", endGesture);
  stage.addEventListener("pointercancel", endGesture);
  stage.addEventListener("contextmenu", (e) => e.preventDefault());

  stage.addEventListener("wheel", (e) => {
    if (!view || e.target.closest(".cboard-side")) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  stage.addEventListener("dblclick", (e) => {
    if (tool !== "select" || e.target.closest(".cboard-side, .cboard-bar, input, textarea")) return;
    if (e.target.closest("[data-shape]")) {
      side.querySelector(".cboard-shape-text")?.focus();
      return;
    }
    const cardEl = e.target.closest("[data-card]");
    if (cardEl) {
      editingId = cardEl.dataset.card;
      renderScene();
      return;
    }
    const edgeEl = e.target.closest("[data-edge]");
    if (edgeEl) {
      side.querySelector(".cboard-edge-input")?.focus();
      return;
    }
    if (e.target.closest("[data-group]")) {
      side.querySelector("input")?.focus();
      return;
    }
    const pt = toWorld(e.clientX, e.clientY);
    addCardAt(pt.x, pt.y);
  });

  layer.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-open-chapter]");
    if (chip) openEntity("chapter", chip.dataset.openChapter);
  });

  // ── Нижняя панель
  const tools = document.createElement("div");
  tools.className = "cboard-bar";
  const toolBtn = (key, label, svgPath) => {
    const b = document.createElement("button");
    b.className = "cboard-tool" + (tool === key ? " active" : "");
    b.title = label;
    b.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${svgPath}</svg>`;
    b.dataset.tool = key;
    b.addEventListener("click", () => setTool(key));
    return b;
  };
  function setTool(key) {
    tool = key;
    tools.querySelectorAll(".cboard-tool").forEach((x) => x.classList.toggle("active", x.dataset.tool === key));
    stage.classList.toggle("hand", tool === "hand");
    stage.classList.toggle("drawing", SHAPE_TOOLS.some(([k]) => k === tool));
  }
  const action = (label, onClick, title) => {
    const b = document.createElement("button");
    b.className = "cboard-action";
    b.innerHTML = label;
    if (title) b.title = title;
    b.addEventListener("click", onClick);
    return b;
  };
  const sep = () => {
    const s = document.createElement("span");
    s.className = "cboard-sep";
    return s;
  };
  const undoBtn = action("↶", undo, i18n("Отменить (Ctrl+Z)"));
  const redoBtn = action("↷", redo, i18n("Повторить (Ctrl+Shift+Z)"));
  const zoomLabel = document.createElement("span");
  zoomLabel.className = "cboard-zoom";
  tools.append(
    toolBtn("select", i18n("Выбор (V)"), '<path d="M5 3l14 8-6 2-2 6z"/>'),
    toolBtn("hand", i18n("Рука – двигать поле (H, пробел)"), '<path d="M7 11V5a1.5 1.5 0 0 1 3 0v5m0-6a1.5 1.5 0 0 1 3 0v6m0-5a1.5 1.5 0 0 1 3 0v6m0-3a1.5 1.5 0 0 1 3 0v5a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-3l-3-5a1.5 1.5 0 0 1 2.5-1.6L7 13"/>'),
    sep(),
    ...SHAPE_TOOLS.map(([key, label, path, keys]) => toolBtn(key, `${i18n(label)} (${keys.split(" ")[0].toUpperCase()})`, path)),
    sep(),
    action(escapeHtml(i18n("+ Карточка")), () => {
      const r = stage.getBoundingClientRect();
      const c = toWorld(r.left + r.width / 2, r.top + r.height / 2);
      addCardAt(c.x, c.y);
    }),
    action(escapeHtml(i18n("Группа")), () => groupSelection(), i18n("Рамка вокруг выбранного или пустая")),
    sep(),
    undoBtn,
    redoBtn,
    sep(),
    action("−", () => { const r = stage.getBoundingClientRect(); zoomAt(1 / 1.2, r.width / 2, r.height / 2); }, i18n("Уменьшить")),
    zoomLabel,
    action("+", () => { const r = stage.getBoundingClientRect(); zoomAt(1.2, r.width / 2, r.height / 2); }, i18n("Увеличить")),
    action(iconSvg("focus", 14), fit, i18n("Вписать")),
  );
  stage.appendChild(tools);

  const hint = document.createElement("div");
  hint.className = "map-hint cboard-hint";
  hint.textContent = i18n("Двойной щелчок – новая карточка · тяните фон – выделить · пробел или правая кнопка – двигать поле · Shift – ровная фигура");
  stage.appendChild(hint);

  // ── Клавиши
  const onKey = (e) => {
    if (!pane.isConnected) {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keyup", onKeyUp);
      return;
    }
    if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && key === "y") {
      e.preventDefault();
      redo();
    } else if (mod && key === "a") {
      e.preventDefault();
      selCards = new Set(cv.cards.map((c) => c.id));
      selGroups = new Set(cv.groups.map((g) => g.id));
      selShapes = new Set(cv.shapes.map((x) => x.id));
      selEdge = null;
      renderScene();
      renderSide();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeSelection();
    } else if (e.key === "Escape") {
      clearSelection();
      setTool("select");
      renderScene();
      renderSide();
    } else if (e.key === " ") {
      e.preventDefault();
      spaceDown = true;
      stage.classList.add("hand");
    } else if (!mod && (key === "v" || key === "м")) {
      setTool("select");
    } else if (!mod && (key === "h" || key === "р")) {
      setTool("hand");
    } else if (!mod) {
      const found = SHAPE_TOOLS.find(([, , , keys]) => keys.split(" ").includes(key));
      if (found) setTool(found[0]);
    }
  };
  const onKeyUp = (e) => {
    if (e.key === " ") {
      spaceDown = false;
      stage.classList.toggle("hand", tool === "hand");
    }
  };
  document.addEventListener("keydown", onKey);
  document.addEventListener("keyup", onKeyUp);

  // Размер поля известен только в документе — вид считаем после вставки.
  setTimeout(() => {
    if (!view) fit();
    else applyView();
    const focus = ctx.focusCardId && cv.cards.find((c) => c.id === ctx.focusCardId);
    if (focus) {
      selCards.add(focus.id);
      renderScene();
      renderSide();
      centerOn(focus);
    }
  }, 0);

  renderScene();
  renderSide();
  return pane;
}
