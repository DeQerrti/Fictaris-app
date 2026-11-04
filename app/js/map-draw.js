import { escapeHtml } from "./chips.js";
import { uid } from "./api.js";
import { i18n } from "./i18n.js";

// ══════════════════════════════════════════════
//  МАСТЕРСКАЯ КАРТ
//
//  Карта, нарисованная в самом приложении, — не картинка, а набор фигур
//  (map.json → maps[id].drawing): суша и вода — замкнутые контуры,
//  реки и дороги — линии, горы, лес, города — значки, надписи. Всё в
//  пикселях холста drawing.width × drawing.height; метки (pins) как и
//  раньше — в процентах, поэтому лежат поверх рисунка так же, как поверх
//  загруженной картинки. Если у карты есть и картинка, рисунок ложится
//  на неё сверху (без своего моря), — так можно обвести готовую карту.
//
//  Границы областей (border) — замкнутые контуры с цветом, по желанию
//  привязанные к фракции: тогда подпись и цвет берутся у неё. Оформление
//  всего рисунка — drawing.style (пергамент, атлас, чернила), прозрачность
//  картинки-подложки — drawing.underlay (0–1).
//
//  Здесь — сам рисунок (drawingSvg) и инструменты (attachWorkshop);
//  масштаб, сдвиг и метки — в map.js, общие с просмотром.
// ══════════════════════════════════════════════

export const DRAW_TOOLS = [
  ["select", "Выбор и перемещение", '<path d="M5 3l14 8-6 2-2 6z"/>'],
  ["land", "Суша – обведите контур", '<path d="M4 15c1-5 5-9 9-8s6 4 7 7-3 6-8 6-9-1-8-5z"/>'],
  ["water", "Вода – озеро или залив", '<path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z"/>'],
  ["river", "Река", '<path d="M4 4c6 2 2 7 8 8s2 6 8 8"/>'],
  ["road", "Дорога", '<path d="M4 20c4-2 4-8 8-8s4-6 8-8" stroke-dasharray="2 3"/>'],
  ["mountain", "Горы – щёлкните или ведите", '<path d="M2 20 9 7l4 6 3-4 6 11z"/>'],
  ["forest", "Лес – щёлкните или ведите", '<path d="M12 3 6 13h3l-3 5h12l-3-5h3z"/><path d="M12 18v3"/>'],
  ["city", "Город", '<path d="M4 21V9l3 2V7l3 2V5l2-2 2 2v4l3-2v4l3-2v12z"/>'],
  ["castle", "Замок или крепость", '<path d="M4 21V9h3v3h3V9h4v3h3V9h3v12z"/><path d="M10 21v-4h4v4"/>'],
  ["village", "Деревня", '<path d="M3 21V12l5-4 5 4v9z"/><path d="M13 21v-6l4-3 4 3v6z"/>'],
  ["border", "Граница области – обведите контур", '<path d="M4 7l6-3 9 4 1 9-8 4-8-5z" stroke-dasharray="3 2"/>'],
  ["label", "Надпись", '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'],
];

export const LABEL_STYLES = [
  ["place", "Название места"],
  ["region", "Область"],
  ["sea", "Море"],
  ["title", "Заголовок карты"],
];

export const MAP_STYLES = [
  ["parchment", "Пергамент"],
  ["atlas", "Атлас"],
  ["ink", "Чернила"],
];

// Слои рисунка, которые можно прятать; суша и вода видны всегда.
export const DRAW_LAYERS = [
  ["relief", "Горы и лес"],
  ["settlements", "Города и замки"],
  ["rivers", "Реки"],
  ["roads", "Дороги"],
  ["borders", "Границы областей"],
  ["labels", "Надписи на карте"],
];

export function shapeLayer(s) {
  if (s.kind === "stamp") return s.icon === "mountain" || s.icon === "forest" ? "relief" : "settlements";
  return { river: "rivers", road: "roads", border: "borders", label: "labels" }[s.kind] || null;
}

// Цвета границ на выбор — те же, что у карточек персонажей.
export const BORDER_COLORS = ["#a4483c", "#c9944a", "#4f7d74", "#6a8fae", "#7d6a9e", "#9a9250", "#b5636b", "#5a8a5f"];

const STAMP_SIZE = { mountain: 44, forest: 22, city: 34, castle: 30, village: 28 };
// Шаг значков при ведении кистью: горы — грядой, лес — гуще.
const SPRAY_STEP = { mountain: 30, forest: 15 };

export function blankDrawing(width = 1200, height = 800) {
  return { width, height, shapes: [] };
}

export function toolIcon(path, size = 20) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

// ── Рисунок ────────────────────────────────────

// Сглаживание ломаной (Чайкин): от руки контур выходит угловатым.
function smooth(points, closed, rounds = 2) {
  let pts = points;
  for (let r = 0; r < rounds; r++) {
    const out = [];
    const n = pts.length;
    const last = closed ? n : n - 1;
    if (!closed) out.push(pts[0]);
    for (let i = 0; i < last; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % n];
      out.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25], [x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]);
    }
    if (!closed) out.push(pts[n - 1]);
    pts = out;
  }
  return pts;
}

function pathD(points, closed) {
  if (!points.length) return "";
  const pts = points.length > 2 ? smooth(points, closed) : points;
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  return closed ? `${d}Z` : d;
}

// Палитры оформления. land — две точки градиента суши.
const PALETTES = {
  parchment: {
    sea: "#b9c4ba", wave: "#7d8f8a", land: ["#ead9b4", "#d3b98a"], coast: "#5a4a30", rough: 5,
    river: "#6f8a96", road: "#6b5434",
    mountain: ["#cdb48a", "#5a4a30"], forest: ["#7d8a5a", "#4a4a2a"], house: ["#e8d6ad", "#3a2f1e"], house2: "#dcc89c", castle: "#cfc0a0",
    ink: "#3a2f1e", halo: "#ead9b4", seaText: "#4f6460",
  },
  atlas: {
    sea: "#9fc3d6", wave: "#6f9cb6", land: ["#d9e2b4", "#b9c98e"], coast: "#4a5a3a", rough: 2,
    river: "#4d86b0", road: "#8a5a3a",
    mountain: ["#c2a47a", "#5a4630"], forest: ["#5f8a4a", "#2f4a26"], house: ["#f2e6cf", "#3a2f1e"], house2: "#e6d6b6", castle: "#d8ccb4",
    ink: "#2a2a22", halo: "#e6edcf", seaText: "#2f5f7a",
  },
  ink: {
    sea: "#e4ddcd", wave: "#2a241c", land: ["#fdfbf6", "#f4efe3"], coast: "#1f1a14", rough: 3,
    river: "#1f1a14", road: "#1f1a14",
    mountain: ["#fbf8f1", "#1f1a14"], forest: ["#fbf8f1", "#1f1a14"], house: ["#fbf8f1", "#1f1a14"], house2: "#f1ebdd", castle: "#fbf8f1",
    ink: "#1f1a14", halo: "#fbf8f1", seaText: "#1f1a14",
  },
};

function paletteOf(drawing) {
  return PALETTES[drawing.style] || PALETTES.parchment;
}

// У каждого svg свои id градиентов и значков: на одной странице бывает
// несколько рисунков в разных стилях (миниатюры на «Все карты»), а
// url(#id) берёт первый попавшийся в документе.
let svgCounter = 0;

function defs(p, id) {
  const waves = p === PALETTES.ink
    ? `<path d="M0 7 h40" stroke="${p.wave}" stroke-width=".8" opacity=".35"/>`
    : `<path d="M0 7 q10 -6 20 0 t20 0" fill="none" stroke="${p.wave}" stroke-width="1" opacity=".45"/>`;
  return `
  <defs>
    <linearGradient id="${id}land" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.land[0]}"/><stop offset="1" stop-color="${p.land[1]}"/></linearGradient>
    <pattern id="${id}waves" width="40" height="14" patternUnits="userSpaceOnUse">${waves}</pattern>
    <symbol id="${id}mountain" viewBox="0 0 40 30"><path d="M2 28 L18 4 L30 20 L34 14 L39 28 Z" fill="${p.mountain[0]}" stroke="${p.mountain[1]}" stroke-width="1.4" stroke-linejoin="round"/><path d="M18 4 L22 28" stroke="${p.mountain[1]}" stroke-width="1" opacity=".5"/></symbol>
    <symbol id="${id}forest" viewBox="0 0 20 24"><path d="M10 1 L3 15 H17 Z" fill="${p.forest[0]}" stroke="${p.forest[1]}" stroke-width="1.1" stroke-linejoin="round"/><path d="M10 15v7" stroke="${p.forest[1]}" stroke-width="1.2"/></symbol>
    <symbol id="${id}city" viewBox="0 0 32 32"><path d="M4 28V14l5 3v-6l5 3V8l3-4 3 4v6l5-3v6l3-2v13z" fill="${p.house[0]}" stroke="${p.house[1]}" stroke-width="1.4" stroke-linejoin="round"/></symbol>
    <symbol id="${id}castle" viewBox="0 0 28 28"><path d="M4 26V10h4v3h3v-3h6v3h3v-3h4v16z" fill="${p.castle}" stroke="${p.house[1]}" stroke-width="1.4"/><path d="M12 26v-6h4v6" stroke="${p.house[1]}" stroke-width="1.2" fill="none"/></symbol>
    <symbol id="${id}village" viewBox="0 0 28 24"><path d="M2 22V12l6-5 6 5v10z" fill="${p.house[0]}" stroke="${p.house[1]}" stroke-width="1.3" stroke-linejoin="round"/><path d="M14 22v-7l5-4 6 4v7z" fill="${p.house2}" stroke="${p.house[1]}" stroke-width="1.3" stroke-linejoin="round"/></symbol>
    <filter id="${id}rough"><feTurbulence baseFrequency="0.02" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="${p.rough}"/></filter>
  </defs>`;
}

function labelCss(style, p) {
  return {
    title: `font: 600 40px Newsreader, Georgia, serif; fill: ${p.ink}; letter-spacing: 1px;`,
    region: `font: 600 16px Inter, sans-serif; fill: ${p.ink}; letter-spacing: 5px; opacity: .85;`,
    place: `font: 600 17px Newsreader, Georgia, serif; fill: ${p.ink}; paint-order: stroke; stroke: ${p.halo}; stroke-width: 4px;`,
    sea: `font: italic 30px Newsreader, Georgia, serif; fill: ${p.seaText}; letter-spacing: 10px;`,
  }[style] || labelCss("place", p);
}

// Цвет и подпись границы: свои или фракции, к которой она привязана.
export function borderInfo(s, factions = []) {
  const faction = s.factionId ? factions.find((f) => f.id === s.factionId) : null;
  return {
    faction,
    color: s.color || "#a4483c",
    name: (s.name || "").trim() || faction?.name || "",
  };
}

// Подпись области — в середине контура (центр масс вершин).
function centroid(points) {
  const n = points.length || 1;
  return points.reduce(([x, y], [px, py]) => [x + px / n, y + py / n], [0, 0]);
}

function shapeSvg(s, selected, p, id, factions) {
  const sel = selected ? ' class="fx-selected"' : "";
  const attrs = `data-shape="${escapeHtml(s.id)}"${sel}`;
  switch (s.kind) {
    case "land":
      return `<path ${attrs} d="${pathD(s.points, true)}" fill="url(#${id}land)" stroke="${p.coast}" stroke-width="2.2" stroke-linejoin="round" filter="url(#${id}rough)"/>`;
    case "water":
      return `<g ${attrs}><path d="${pathD(s.points, true)}" fill="${p.sea}" stroke="${p.coast}" stroke-width="2" filter="url(#${id}rough)"/><path d="${pathD(s.points, true)}" fill="url(#${id}waves)" pointer-events="none"/></g>`;
    case "river":
      return `<path ${attrs} d="${pathD(s.points, false)}" fill="none" stroke="${p.river}" stroke-width="${s.width || 3}" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "road":
      return `<path ${attrs} d="${pathD(s.points, false)}" fill="none" stroke="${p.road}" stroke-width="${s.width || 2}" stroke-dasharray="2 6" stroke-linecap="round"/>`;
    case "border": {
      const { color, name } = borderInfo(s, factions);
      const fill = s.fill ?? 0.12;
      const dash = s.line === "solid" ? "" : ' stroke-dasharray="9 6"';
      const [cx, cy] = centroid(s.points);
      const label = name
        ? `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" pointer-events="none" style="font: 600 16px Inter, sans-serif; letter-spacing: 5px; fill: ${color}; opacity: .9; paint-order: stroke; stroke: ${p.halo}; stroke-width: 3px;">${escapeHtml(name.toUpperCase())}</text>`
        : "";
      return `<g ${attrs}><path d="${pathD(s.points, true)}" fill="${color}" fill-opacity="${fill}" stroke="${color}" stroke-width="2.2"${dash} stroke-linejoin="round"/>${label}</g>`;
    }
    case "stamp": {
      const size = s.size || STAMP_SIZE[s.icon] || 30;
      const h = s.icon === "mountain" ? size * 0.75 : size;
      return `<use ${attrs} href="#${id}${s.icon}" x="${(s.x - size / 2).toFixed(1)}" y="${(s.y - h / 2).toFixed(1)}" width="${size}" height="${h.toFixed(1)}"/>`;
    }
    case "label": {
      const size = s.size ? `font-size: ${s.size}px;` : "";
      // text-transform в SVG не работает — область пишем заглавными сами.
      const text = s.style === "region" ? (s.text || "").toUpperCase() : s.text || "";
      return `<text ${attrs} x="${s.x.toFixed(1)}" y="${s.y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" style="${labelCss(s.style, p)}${size}">${escapeHtml(text)}</text>`;
    }
    default:
      return "";
  }
}

// withSea — своё море под сушей; у карты с картинкой-подложкой его нет.
// hidden — слои (DRAW_LAYERS), которые сейчас спрятаны; factions — для
// подписей и цветов границ.
export function drawingSvg(drawing, { selectedId = null, withSea = true, hidden = {}, factions = [] } = {}) {
  const { width, height, shapes = [] } = drawing;
  const p = paletteOf(drawing);
  const id = `fx${++svgCounter}-`;
  const sea = withSea
    ? `<rect width="${width}" height="${height}" fill="${p.sea}"/><rect width="${width}" height="${height}" fill="url(#${id}waves)"/>`
    : "";
  // Границы — под значками и надписями, над сушей, реками и дорогами.
  const order = (s) => (s.kind === "land" || s.kind === "water" ? 0 : s.kind === "border" ? 2 : s.kind === "river" || s.kind === "road" ? 1 : 3);
  const visible = shapes
    .filter((s) => !hidden[shapeLayer(s)])
    .map((s, i) => ({ s, i }))
    .sort((a, b) => order(a.s) - order(b.s) || a.i - b.i)
    .map(({ s }) => s);
  return `<svg class="map-drawing-svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
    ${defs(p, id)}${sea}${visible.map((s) => shapeSvg(s, s.id === selectedId, p, id, factions)).join("")}
  </svg>`;
}

// ── Инструменты ────────────────────────────────

// ctx — что даёт map.js: host (куда класть svg рисунка), preview (svg
// для недорисованной линии), toPoint(clientX, clientY) → [x, y] в
// пикселях рисунка, zoom() — текущий масштаб, onChange() — сохранить,
// onSelect(shape|null) — перерисовать панель свойств, onTool(tool) —
// инструмент сменился сам (после значка города — снова «Выбор»).
// ctx.history { undo, redo } и ctx.tool живут в map.js — экран
// перерисовывается целиком, а отмена и инструмент должны это пережить.
// ctx.hidden() — спрятанные слои, ctx.factions — для границ.
function isClosed(tool) {
  return tool === "land" || tool === "water" || tool === "border";
}

export function attachWorkshop(drawing, ctx) {
  let tool = ctx.tool || "select";
  let selectedId = ctx.selectedId || null;
  let stroke = null;
  const { undo, redo } = ctx.history;

  const render = () => {
    ctx.host.innerHTML = drawingSvg(drawing, { selectedId, withSea: ctx.withSea, hidden: ctx.hidden(), factions: ctx.factions });
  };
  const snapshot = () => JSON.stringify({ shapes: drawing.shapes, style: drawing.style, underlay: drawing.underlay });
  const restore = (text) => {
    const saved = JSON.parse(text);
    drawing.shapes = saved.shapes;
    for (const key of ["style", "underlay"]) {
      if (saved[key] === undefined) delete drawing[key];
      else drawing[key] = saved[key];
    }
  };
  const remember = () => {
    undo.push(snapshot());
    if (undo.length > 60) undo.shift();
    redo.length = 0;
  };
  const changed = () => {
    render();
    ctx.onChange();
  };
  const selected = () => drawing.shapes.find((s) => s.id === selectedId) || null;
  const select = (id) => {
    selectedId = id;
    render();
    ctx.onSelect(selected());
  };
  const addShape = (shape) => {
    drawing.shapes.push({ id: uid(), ...shape });
    return drawing.shapes[drawing.shapes.length - 1];
  };
  const preview = (points, closed) => {
    ctx.preview.innerHTML = points.length > 1
      ? `<path d="${pathD(points, false)}${closed ? "Z" : ""}" fill="${closed ? "rgba(201,148,74,.15)" : "none"}" stroke="#c9944a" stroke-width="${2 / ctx.zoom()}" stroke-dasharray="${6 / ctx.zoom()} ${4 / ctx.zoom()}"/>`
      : "";
  };

  render();

  return {
    get tool() { return tool; },
    setTool(next) {
      tool = next;
      ctx.onTool(tool);
      if (tool !== "select") select(null);
    },
    selected,
    canUndo: () => undo.length > 0,
    canRedo: () => redo.length > 0,
    undo() {
      if (!undo.length) return;
      redo.push(snapshot());
      restore(undo.pop());
      selectedId = null;
      changed();
      ctx.onSelect(null);
    },
    redo() {
      if (!redo.length) return;
      undo.push(snapshot());
      restore(redo.pop());
      selectedId = null;
      changed();
      ctx.onSelect(null);
    },
    // Правка свойств выбранного из панели справа.
    update(patch) {
      const s = selected();
      if (!s) return;
      remember();
      Object.assign(s, patch);
      changed();
    },
    // Свойства всего рисунка: стиль, прозрачность подложки.
    updateDrawing(patch) {
      remember();
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete drawing[key];
        else drawing[key] = value;
      }
      changed();
    },
    rerender: render,
    removeSelected() {
      if (!selectedId) return;
      remember();
      drawing.shapes = drawing.shapes.filter((s) => s.id !== selectedId);
      selectedId = null;
      changed();
      ctx.onSelect(null);
    },
    deselect: () => select(null),

    // Нажатие на холсте; false — не наше (тогда map.js двигает карту).
    pointerDown(e) {
      const pt = ctx.toPoint(e.clientX, e.clientY);
      if (tool === "select") {
        const hit = e.target.closest?.("[data-shape]");
        if (!hit) {
          if (selectedId) select(null);
          return false;
        }
        select(hit.dataset.shape);
        stroke = { kind: "move", last: pt, moved: false };
        return true;
      }
      if (tool === "land" || tool === "water" || tool === "border" || tool === "river" || tool === "road") {
        stroke = { kind: "line", points: [pt] };
        preview(stroke.points, isClosed(tool));
        return true;
      }
      if (tool === "mountain" || tool === "forest") {
        remember();
        addShape({ kind: "stamp", icon: tool, x: pt[0], y: pt[1] });
        stroke = { kind: "spray", last: pt };
        render();
        return true;
      }
      if (tool === "city" || tool === "castle" || tool === "village") {
        remember();
        const s = addShape({ kind: "stamp", icon: tool, x: pt[0], y: pt[1] });
        changed();
        tool = "select";
        ctx.onTool(tool);
        select(s.id);
        return true;
      }
      if (tool === "label") {
        remember();
        const s = addShape({ kind: "label", style: "place", text: i18n("Надпись"), x: pt[0], y: pt[1] });
        changed();
        tool = "select";
        ctx.onTool(tool);
        select(s.id);
        ctx.focusText?.();
        return true;
      }
      return false;
    },
    pointerMove(e) {
      if (!stroke) return;
      const pt = ctx.toPoint(e.clientX, e.clientY);
      if (stroke.kind === "line") {
        const [lx, ly] = stroke.points[stroke.points.length - 1];
        if (Math.hypot(pt[0] - lx, pt[1] - ly) < 5 / ctx.zoom()) return;
        stroke.points.push(pt);
        preview(stroke.points, isClosed(tool));
      } else if (stroke.kind === "spray") {
        const step = SPRAY_STEP[tool] || 20;
        if (Math.hypot(pt[0] - stroke.last[0], pt[1] - stroke.last[1]) < step) return;
        const jitter = step * 0.35;
        addShape({ kind: "stamp", icon: tool, x: pt[0] + (Math.random() - 0.5) * jitter, y: pt[1] + (Math.random() - 0.5) * jitter });
        stroke.last = pt;
        render();
      } else if (stroke.kind === "move") {
        const s = selected();
        if (!s) return;
        const dx = pt[0] - stroke.last[0];
        const dy = pt[1] - stroke.last[1];
        if (!stroke.moved) {
          if (Math.hypot(dx, dy) < 3 / ctx.zoom()) return;
          remember();
          stroke.moved = true;
        }
        if (s.points) s.points = s.points.map(([x, y]) => [x + dx, y + dy]);
        else {
          s.x += dx;
          s.y += dy;
        }
        stroke.last = pt;
        render();
      }
    },
    pointerUp() {
      if (!stroke) return;
      const done = stroke;
      stroke = null;
      ctx.preview.innerHTML = "";
      if (done.kind === "line") {
        if (done.points.length < (isClosed(tool) ? 3 : 2)) return;
        remember();
        const points = done.points.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
        if (tool === "border") {
          // Новую границу сразу выбираем — назвать и привязать к фракции.
          const used = drawing.shapes.filter((x) => x.kind === "border").length;
          const shape = addShape({ kind: "border", points, color: BORDER_COLORS[used % BORDER_COLORS.length] });
          changed();
          tool = "select";
          ctx.onTool(tool);
          select(shape.id);
          return;
        }
        addShape({ kind: tool, points });
        changed();
      } else if (done.kind === "spray" || (done.kind === "move" && done.moved)) {
        changed();
      }
    },
  };
}
