// ══════════════════════════════════════════════
//  «ОТ РУКИ»
//
//  Линии, будто нарисованные пером: каждый отрезок — два чуть разных
//  прохода с изгибом. Случайность — от зерна (id фигуры), поэтому
//  при перерисовке рисунок не дрожит. roughness: 0 — ровно, 1 — от руки,
//  2 — набросок.
// ══════════════════════════════════════════════

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) || 1;
}

function rng(seed) {
  let s = typeof seed === "number" ? seed : hash(String(seed));
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

const fmt = (n) => n.toFixed(1);

function segment(r, x1, y1, x2, y2, amp) {
  const j = () => (r() - 0.5) * amp;
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  // Изгиб поперёк отрезка — сильнее у длинных линий, но в меру.
  const bow = (r() - 0.5) * Math.min(len / 12, amp * 3);
  const mx = (x1 + x2) / 2 - ((y2 - y1) / len) * bow;
  const my = (y1 + y2) / 2 + ((x2 - x1) / len) * bow;
  return `M${fmt(x1 + j())},${fmt(y1 + j())} Q${fmt(mx + j())},${fmt(my + j())} ${fmt(x2 + j())},${fmt(y2 + j())}`;
}

function passes(roughness) {
  return roughness === 0 ? 1 : 2;
}

function amplitude(roughness) {
  return [0, 2.2, 4.5][roughness] ?? 2.2;
}

// Ломаная по точкам (замкнутая — closed).
export function roughPolyline(points, seed, roughness = 1, closed = false) {
  if (roughness === 0) {
    const d = points.map(([x, y], i) => `${i ? "L" : "M"}${fmt(x)},${fmt(y)}`).join("");
    return closed ? `${d}Z` : d;
  }
  const r = rng(seed);
  const amp = amplitude(roughness);
  let d = "";
  for (let p = 0; p < passes(roughness); p++) {
    const n = closed ? points.length : points.length - 1;
    for (let i = 0; i < n; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      d += segment(r, x1, y1, x2, y2, amp);
    }
  }
  return d;
}

export function roughRect(x, y, w, h, seed, roughness = 1) {
  return roughPolyline([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], seed, roughness, true);
}

export function roughDiamond(x, y, w, h, seed, roughness = 1) {
  return roughPolyline([[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]], seed, roughness, true);
}

export function roughEllipse(x, y, w, h, seed, roughness = 1) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  if (roughness === 0) return `M${fmt(cx - w / 2)},${fmt(cy)} a${fmt(w / 2)},${fmt(h / 2)} 0 1,0 ${fmt(w)},0 a${fmt(w / 2)},${fmt(h / 2)} 0 1,0 ${fmt(-w)},0`;
  const r = rng(seed);
  const amp = amplitude(roughness);
  let d = "";
  for (let p = 0; p < passes(roughness); p++) {
    const start = r() * Math.PI * 2;
    const pts = [];
    // Чуть больше полного круга — концы заходят друг за друга, как у пера.
    for (let a = 0; a <= Math.PI * 2 + 0.35; a += 0.3) {
      pts.push([cx + Math.cos(start + a) * (w / 2 + (r() - 0.5) * amp), cy + Math.sin(start + a) * (h / 2 + (r() - 0.5) * amp)]);
    }
    d += `M${fmt(pts[0][0])},${fmt(pts[0][1])}` + pts.slice(1).map(([px, py]) => ` L${fmt(px)},${fmt(py)}`).join("");
  }
  return d;
}

// Наконечник стрелки у последней точки.
export function arrowHead(points, seed, roughness = 1, size = 14) {
  const [x2, y2] = points[points.length - 1];
  const [x1, y1] = points[points.length - 2] || [x2 - 1, y2];
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const wing = (da) => [x2 - size * Math.cos(ang + da), y2 - size * Math.sin(ang + da)];
  return roughPolyline([wing(0.45), [x2, y2], wing(-0.45)], `${seed}h`, roughness, false);
}

// Плавная кривая карандаша — без дрожи, рука и так неровная.
export function penPath(points) {
  if (points.length < 3) return points.map(([x, y], i) => `${i ? "L" : "M"}${fmt(x)},${fmt(y)}`).join("");
  let d = `M${fmt(points[0][0])},${fmt(points[0][1])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    d += ` Q${fmt(x)},${fmt(y)} ${fmt((x + nx) / 2)},${fmt((y + ny) / 2)}`;
  }
  const [lx, ly] = points[points.length - 1];
  return `${d} L${fmt(lx)},${fmt(ly)}`;
}

// Узор заливки: штрих или сетка своего цвета. id — уникальный на документ.
export function fillPattern(id, color, style) {
  const lines = style === "cross"
    ? `<path d="M0 4h8M4 0v8" stroke="${color}" stroke-width="1.2" opacity=".7"/>`
    : `<path d="M0 4h8" stroke="${color}" stroke-width="1.5" opacity=".75"/>`;
  return `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-40)">${lines}</pattern>`;
}
