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
  ["label", "Надпись", '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'],
];

export const LABEL_STYLES = [
  ["place", "Название места"],
  ["region", "Область"],
  ["sea", "Море"],
  ["title", "Заголовок карты"],
];

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

const DEFS = `
  <defs>
    <linearGradient id="fx-parch" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ead9b4"/><stop offset="1" stop-color="#d3b98a"/></linearGradient>
    <pattern id="fx-sea-waves" width="40" height="14" patternUnits="userSpaceOnUse"><path d="M0 7 q10 -6 20 0 t20 0" fill="none" stroke="#7d8f8a" stroke-width="1" opacity=".45"/></pattern>
    <symbol id="fx-mountain" viewBox="0 0 40 30"><path d="M2 28 L18 4 L30 20 L34 14 L39 28 Z" fill="#cdb48a" stroke="#5a4a30" stroke-width="1.4" stroke-linejoin="round"/><path d="M18 4 L22 28" stroke="#5a4a30" stroke-width="1" opacity=".5"/></symbol>
    <symbol id="fx-forest" viewBox="0 0 20 24"><path d="M10 1 L3 15 H17 Z" fill="#7d8a5a" stroke="#4a4a2a" stroke-width="1.1" stroke-linejoin="round"/><path d="M10 15v7" stroke="#4a4a2a" stroke-width="1.2"/></symbol>
    <symbol id="fx-city" viewBox="0 0 32 32"><path d="M4 28V14l5 3v-6l5 3V8l3-4 3 4v6l5-3v6l3-2v13z" fill="#e8d6ad" stroke="#3a2f1e" stroke-width="1.4" stroke-linejoin="round"/></symbol>
    <symbol id="fx-castle" viewBox="0 0 28 28"><path d="M4 26V10h4v3h3v-3h6v3h3v-3h4v16z" fill="#cfc0a0" stroke="#3a2f1e" stroke-width="1.4"/><path d="M12 26v-6h4v6" stroke="#3a2f1e" stroke-width="1.2" fill="none"/></symbol>
    <symbol id="fx-village" viewBox="0 0 28 24"><path d="M2 22V12l6-5 6 5v10z" fill="#e8d6ad" stroke="#3a2f1e" stroke-width="1.3" stroke-linejoin="round"/><path d="M14 22v-7l5-4 6 4v7z" fill="#dcc89c" stroke="#3a2f1e" stroke-width="1.3" stroke-linejoin="round"/></symbol>
    <filter id="fx-rough"><feTurbulence baseFrequency="0.02" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="5"/></filter>
  </defs>`;

const LABEL_CSS = {
  title: "font: 600 40px Newsreader, Georgia, serif; fill: #3a2f1e; letter-spacing: 1px;",
  region: "font: 600 16px Inter, sans-serif; fill: #6b3a2a; letter-spacing: 5px; opacity: .85;",
  place: "font: 600 17px Newsreader, Georgia, serif; fill: #2a2216; paint-order: stroke; stroke: #ead9b4; stroke-width: 4px;",
  sea: "font: italic 30px Newsreader, Georgia, serif; fill: #4f6460; letter-spacing: 10px;",
};

function shapeSvg(s, selected) {
  const sel = selected ? ' class="fx-selected"' : "";
  const attrs = `data-shape="${escapeHtml(s.id)}"${sel}`;
  switch (s.kind) {
    case "land":
      return `<path ${attrs} d="${pathD(s.points, true)}" fill="url(#fx-parch)" stroke="#5a4a30" stroke-width="2.2" stroke-linejoin="round" filter="url(#fx-rough)"/>`;
    case "water":
      return `<g ${attrs}><path d="${pathD(s.points, true)}" fill="#b9c4ba" stroke="#5a4a30" stroke-width="2" filter="url(#fx-rough)"/><path d="${pathD(s.points, true)}" fill="url(#fx-sea-waves)" pointer-events="none"/></g>`;
    case "river":
      return `<path ${attrs} d="${pathD(s.points, false)}" fill="none" stroke="#6f8a96" stroke-width="${s.width || 3}" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "road":
      return `<path ${attrs} d="${pathD(s.points, false)}" fill="none" stroke="#6b5434" stroke-width="${s.width || 2}" stroke-dasharray="2 6" stroke-linecap="round"/>`;
    case "stamp": {
      const size = s.size || STAMP_SIZE[s.icon] || 30;
      const h = s.icon === "mountain" ? size * 0.75 : size;
      return `<use ${attrs} href="#fx-${s.icon}" x="${(s.x - size / 2).toFixed(1)}" y="${(s.y - h / 2).toFixed(1)}" width="${size}" height="${h.toFixed(1)}"/>`;
    }
    case "label": {
      const size = s.size ? `font-size: ${s.size}px;` : "";
      // text-transform в SVG не работает — область пишем заглавными сами.
      const text = s.style === "region" ? (s.text || "").toUpperCase() : s.text || "";
      return `<text ${attrs} x="${s.x.toFixed(1)}" y="${s.y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" style="${LABEL_CSS[s.style] || LABEL_CSS.place}${size}">${escapeHtml(text)}</text>`;
    }
    default:
      return "";
  }
}

// withSea — своё море под сушей; у карты с картинкой-подложкой его нет.
export function drawingSvg(drawing, { selectedId = null, withSea = true } = {}) {
  const { width, height, shapes = [] } = drawing;
  const sea = withSea
    ? `<rect width="${width}" height="${height}" fill="#b9c4ba"/><rect width="${width}" height="${height}" fill="url(#fx-sea-waves)"/>`
    : "";
  return `<svg class="map-drawing-svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
    ${DEFS}${sea}${shapes.map((s) => shapeSvg(s, s.id === selectedId)).join("")}
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
export function attachWorkshop(drawing, ctx) {
  let tool = ctx.tool || "select";
  let selectedId = ctx.selectedId || null;
  let stroke = null;
  const { undo, redo } = ctx.history;

  const render = () => {
    ctx.host.innerHTML = drawingSvg(drawing, { selectedId, withSea: ctx.withSea });
  };
  const snapshot = () => JSON.stringify(drawing.shapes);
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
      drawing.shapes = JSON.parse(undo.pop());
      selectedId = null;
      changed();
      ctx.onSelect(null);
    },
    redo() {
      if (!redo.length) return;
      undo.push(snapshot());
      drawing.shapes = JSON.parse(redo.pop());
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
      if (tool === "land" || tool === "water" || tool === "river" || tool === "road") {
        stroke = { kind: "line", points: [pt] };
        preview(stroke.points, tool === "land" || tool === "water");
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
        preview(stroke.points, tool === "land" || tool === "water");
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
        const closed = tool === "land" || tool === "water";
        if (done.points.length < (closed ? 3 : 2)) return;
        remember();
        addShape({ kind: tool, points: done.points.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]) });
        changed();
      } else if (done.kind === "spray" || (done.kind === "move" && done.moved)) {
        changed();
      }
    },
  };
}
