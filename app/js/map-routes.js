import { i18n } from "./i18n.js";

// ══════════════════════════════════════════════
//  РАССТОЯНИЯ НА КАРТЕ
//
//  Линейка (map.js): щелчки ставят точки пути, двойной щелчок — конец.
//  Путь можно сохранить: map.maps[id].routes = [{ id, name, fromPinId,
//  toPinId, points: [[x%, y%], …], len }] — точки в процентах карты, как
//  метки; len — длина в пикселях карты (картинки или холста рисунка).
//  Масштаб — map.maps[id].scale = { km, px }: km километров на px
//  пикселей карты (задаётся как «ширина карты – N км»). Скорости
//  передвижения — map.travelSpeeds = [{ name, km }] (км в день), общие
//  для мира; без них — стандартные.
// ══════════════════════════════════════════════

export function defaultSpeeds() {
  return [
    { name: i18n("Пешком"), km: 30 },
    { name: i18n("Верхом"), km: 60 },
    { name: i18n("Обоз"), km: 20 },
    { name: i18n("По реке"), km: 80 },
  ];
}

export function speedsOf(mapData) {
  const list = Array.isArray(mapData?.travelSpeeds) ? mapData.travelSpeeds.filter((s) => s && s.name && Number(s.km) > 0) : [];
  return list.length ? list : defaultSpeeds();
}

// Длина пути в пикселях карты: точки — проценты ширины и высоты.
export function pxLength(points, w, h) {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(((points[i][0] - points[i - 1][0]) / 100) * w, ((points[i][1] - points[i - 1][1]) / 100) * h);
  }
  return len;
}

export function kmOf(len, scale) {
  if (!scale || !(scale.km > 0) || !(scale.px > 0)) return null;
  return (len * scale.km) / scale.px;
}

export function fmtKm(km) {
  if (km == null) return "";
  return km >= 100 ? `${Math.round(km)} ${i18n("км")}` : `${km.toFixed(1).replace(/\.0$/, "")} ${i18n("км")}`;
}

export function fmtDays(km, perDay) {
  const d = km / perDay;
  if (d < 1) {
    const h = Math.max(1, Math.round(d * 24));
    return i18n("{n} ч", { n: h });
  }
  return i18n("{n} дн.", { n: d >= 10 ? Math.round(d) : d.toFixed(1).replace(/\.0$/, "") });
}

// Ближайшая метка к точке (в процентах) — у начала и конца пути.
export function nearestPin(pins, pt, maxPct = 4) {
  let best = null;
  let bestD = maxPct;
  for (const p of pins || []) {
    const d = Math.hypot(p.x - pt[0], p.y - pt[1]);
    if (d < bestD) { best = p; bestD = d; }
  }
  return best;
}

const ROUTE_COLORS = ["#a4483c", "#4f7d74", "#6a8fae", "#7d6a9e", "#9a9250", "#b5636b"];
export const routeColor = (i) => ROUTE_COLORS[i % ROUTE_COLORS.length];

export function routeName(route, pins) {
  if (route.name) return route.name;
  const a = pins.find((p) => p.id === route.fromPinId)?.label;
  const b = pins.find((p) => p.id === route.toPinId)?.label;
  return a && b ? `${a} → ${b}` : a || b || i18n("Путь");
}

// Пути, которые начинаются или кончаются у метки этого места — на всех картах.
export function routesForLocation(mapData, locationId) {
  const out = [];
  for (const m of Object.values(mapData?.maps || {})) {
    const pins = m.pins || [];
    for (const r of m.routes || []) {
      const from = pins.find((p) => p.id === r.fromPinId);
      const to = pins.find((p) => p.id === r.toPinId);
      let other = null;
      if (from?.locationId === locationId) other = to;
      else if (to?.locationId === locationId) other = from;
      else continue;
      const km = kmOf(r.len, m.scale);
      if (km == null) continue;
      out.push({ map: m, route: r, other: other?.label || i18n("Без названия"), km });
    }
  }
  return out.sort((a, b) => a.km - b.km);
}

// SVG путей поверх карты: viewBox — проценты, линия не толстеет при масштабе.
export function routesSvgInner(routes, ruler, activeId) {
  const line = (pts, color, width, dash, cls = "") =>
    `<polyline class="${cls}" points="${pts.map((p) => `${p[0]},${p[1]}`).join(" ")}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
  let out = "";
  (routes || []).forEach((r, i) => {
    if (r.points?.length > 1) out += line(r.points, routeColor(i), r.id === activeId ? 6 : 4, "", r.id === activeId ? "active" : "");
  });
  if (ruler?.length > 1) out += line(ruler, "#ffffff", 7, "", "ruler-halo") + line(ruler, "#a4483c", 4, "10 7", "ruler");
  return out;
}
