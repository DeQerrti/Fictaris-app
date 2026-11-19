// ══════════════════════════════════════════════
//  ПРОВЕРКА ДАННЫХ ПРИ ЧТЕНИИ
//
//  Файлы проекта меняют не только Fictaris: синхронизация с GitHub,
//  импорт, ИИ-агенты и сам человек. Разделы вставляют цвета, координаты
//  и пути картинок прямо в HTML и SVG (style="background:…",
//  x="…", src="…"), поэтому строка вроде `red"><img onerror=…>` в поле
//  color могла выполнить код в окне приложения. Здесь, на одном входе
//  (apiGet в api.js), такие поля приводятся к тому, чем они должны быть:
//  цвет — #hex, координата — число, картинка — файл из maps/. Остальное
//  (имена, тексты, свои поля анкет) не трогаем — их экранируют при выводе.
// ══════════════════════════════════════════════

const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;
const IMAGE_PATH = /^maps\/[\w.-]+\.(jpe?g|png|webp)$/i;
const ICON_NAME = /^[a-z][a-z0-9-]*$/i;

export function safeColor(value, fallback = null) {
  return typeof value === "string" && HEX_COLOR.test(value.trim()) ? value.trim() : fallback;
}

export function safeImagePath(value) {
  return typeof value === "string" && IMAGE_PATH.test(value) ? value : null;
}

function num(value, fallback = 0) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function fixColor(obj, key) {
  if (obj && typeof obj === "object" && key in obj && obj[key] !== null && obj[key] !== undefined) {
    obj[key] = safeColor(obj[key]);
  }
}

function fixImages(entity) {
  if (entity && Array.isArray(entity.images)) entity.images = entity.images.map(safeImagePath).filter(Boolean);
}

// Персонажи, места, фракции: цвет карточки и картинки — на верхнем
// уровне. Поля анкет лежат там же под своими ключами, но они текстовые
// и выводятся через escapeHtml, поэтому их не трогаем.
function entities(list) {
  if (!Array.isArray(list)) return list;
  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    fixColor(e, "color");
    fixImages(e);
  }
  return list;
}

// Поля фигур на рисунке карты и на холсте, которые должны быть числами.
const NUMERIC = ["x", "y", "w", "h", "size", "width", "height", "strokeWidth", "fontSize", "roughness", "underlay"];
const COLORS = ["color", "stroke", "labelColor"];

function points(list) {
  return Array.isArray(list) ? list.filter(Array.isArray).map(([x, y]) => [num(x), num(y)]) : list;
}

function shape(s) {
  if (!s || typeof s !== "object") return s;
  for (const key of NUMERIC) if (key in s && s[key] !== null && s[key] !== undefined) s[key] = num(s[key]);
  for (const key of COLORS) fixColor(s, key);
  // fill — у фигур холста цвет, у границ на карте — непрозрачность 0–1.
  if ("fill" in s && s.fill !== null && s.fill !== undefined && typeof s.fill !== "number") {
    s.fill = HEX_COLOR.test(String(s.fill)) ? s.fill : Number.isFinite(Number(s.fill)) ? Number(s.fill) : null;
  }
  if ("points" in s) s.points = points(s.points);
  if ("icon" in s && !(typeof s.icon === "string" && ICON_NAME.test(s.icon))) s.icon = "city";
  if ("src" in s) s.src = safeImagePath(s.src);
  return s;
}

function mapData(data) {
  if (!data || typeof data !== "object" || !data.maps || typeof data.maps !== "object") return data;
  for (const m of Object.values(data.maps)) {
    if (!m || typeof m !== "object") continue;
    if ("imageRelPath" in m) m.imageRelPath = safeImagePath(m.imageRelPath);
    if (m.drawing && typeof m.drawing === "object") {
      if ("width" in m.drawing) m.drawing.width = num(m.drawing.width, 1200);
      if ("height" in m.drawing) m.drawing.height = num(m.drawing.height, 800);
      if ("underlay" in m.drawing) m.drawing.underlay = num(m.drawing.underlay, 1);
      if (Array.isArray(m.drawing.shapes)) m.drawing.shapes.forEach(shape);
    }
    if (Array.isArray(m.pins)) for (const p of m.pins) if (p && typeof p === "object") { p.x = num(p.x); p.y = num(p.y); }
  }
  return data;
}

function canvasData(data) {
  if (!data || typeof data !== "object" || !data.canvases || typeof data.canvases !== "object") return data;
  for (const cv of Object.values(data.canvases)) {
    if (!cv || typeof cv !== "object") continue;
    for (const key of ["cards", "groups", "shapes"]) if (Array.isArray(cv[key])) cv[key].forEach(shape);
  }
  return data;
}

function boardData(data) {
  const boards = Array.isArray(data?.boards) ? data.boards : data && typeof data === "object" ? [data] : [];
  for (const b of boards) {
    if (!b || typeof b.cards !== "object" || !b.cards) continue;
    for (const card of Object.values(b.cards)) fixColor(card, "labelColor");
  }
  return data;
}

function settingsData(s) {
  if (!s || typeof s !== "object") return s;
  if (Array.isArray(s.chapterStatuses)) s.chapterStatuses.forEach((x) => fixColor(x, "color"));
  if (Array.isArray(s.calendar?.holidays)) s.calendar.holidays.forEach((x) => fixColor(x, "color"));
  // Дни в месяце — число от 1: строка «30» из ручной правки ломала счёт
  // дней в году, 0 и отрицательные — сетку месяца.
  if (Array.isArray(s.calendar?.months)) {
    for (const m of s.calendar.months) if (m && typeof m === "object") m.days = Math.max(1, Math.round(num(m.days, 30)));
  }
  if ("accent" in s && s.accent !== null) s.accent = safeColor(s.accent);
  return s;
}

// Свои разделы: цвет раздела, у записей — картинки (sections.js).
function entriesData(data) {
  if (!data || typeof data !== "object") return data;
  if (Array.isArray(data.sections)) data.sections.forEach((s) => fixColor(s, "color"));
  entities(data.entries);
  return data;
}

const BY_FILE = {
  entries: entriesData,
  characters: entities,
  locations: entities,
  factions: entities,
  map: mapData,
  canvas: canvasData,
  board: boardData,
  "site-settings": settingsData,
};

// name — имя файла без .json, как в пути API (/api/characters → characters).
export function sanitizeVaultData(name, data) {
  const fn = BY_FILE[name];
  if (!fn) return data;
  try {
    return fn(data);
  } catch {
    return data; // проверка не должна ронять чтение
  }
}
