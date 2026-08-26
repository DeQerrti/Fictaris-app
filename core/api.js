// ══════════════════════════════════════════════
//  МАРШРУТЫ ДАННЫХ
//
//  v1: только то, что нужно минимальному костяку — Рукопись и
//  Персонажи. Каждый модуль хранится одним JSON-файлом целиком
//  (весь список персонажей / вся рукопись разом), как и было решено в
//  брифе для файлового хранилища.
// ══════════════════════════════════════════════

export class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const EMPTY_MANUSCRIPT = { chapters: [], activeChapterId: null };
const EMPTY_BOARD = { columns: [], cards: {}, cardOrder: {} };
const EMPTY_MAP = { rootIds: [], maps: {} };
const IMAGE_EXT = /^(jpg|jpeg|png|webp)$/i;

export const ROUTES = {
  "GET /api/characters": async ({ vault }) => vault.readJson("characters.json", []),
  "POST /api/characters": async ({ vault, body }) => {
    if (!Array.isArray(body)) throw new ApiError("Ожидался список персонажей");
    return vault.writeJson("characters.json", body);
  },

  "GET /api/manuscript": async ({ vault }) => vault.readJson("manuscript.json", EMPTY_MANUSCRIPT),
  "POST /api/manuscript": async ({ vault, body }) => {
    if (!body || !Array.isArray(body.chapters)) throw new ApiError("Некорректная рукопись");
    return vault.writeJson("manuscript.json", body);
  },

  "GET /api/locations": async ({ vault }) => vault.readJson("locations.json", []),
  "POST /api/locations": async ({ vault, body }) => {
    if (!Array.isArray(body)) throw new ApiError("Ожидался список локаций");
    return vault.writeJson("locations.json", body);
  },

  "GET /api/relationships": async ({ vault }) => vault.readJson("relationships.json", []),
  "POST /api/relationships": async ({ vault, body }) => {
    if (!Array.isArray(body)) throw new ApiError("Ожидался список связей");
    return vault.writeJson("relationships.json", body);
  },

  "GET /api/timeline": async ({ vault }) => vault.readJson("timeline.json", []),
  "POST /api/timeline": async ({ vault, body }) => {
    if (!Array.isArray(body)) throw new ApiError("Ожидался список событий");
    return vault.writeJson("timeline.json", body);
  },

  "GET /api/board": async ({ vault }) => vault.readJson("board.json", EMPTY_BOARD),
  "POST /api/board": async ({ vault, body }) => {
    if (!body || !Array.isArray(body.columns) || !body.cards || !body.cardOrder) {
      throw new ApiError("Некорректная доска");
    }
    return vault.writeJson("board.json", body);
  },

  "GET /api/factions": async ({ vault }) => vault.readJson("factions.json", []),
  "POST /api/factions": async ({ vault, body }) => {
    if (!Array.isArray(body)) throw new ApiError("Ожидался список фракций");
    return vault.writeJson("factions.json", body);
  },

  "GET /api/map": async ({ vault }) => vault.readJson("map.json", EMPTY_MAP),
  "POST /api/map": async ({ vault, body }) => {
    if (!body || typeof body.maps !== "object") throw new ApiError("Некорректная карта");
    return vault.writeJson("map.json", body);
  },

  // Картинка приходит как base64 (сжата на клиенте через <canvas> перед
  // отправкой — см. брифе про compressImage) и уезжает на диск отдельным
  // файлом; map.json хранит только относительный путь к нему. Base64
  // остаётся строкой до самого Vault — декодирует его каждая
  // реализация по-своему (node:fs хочет Buffer, Capacitor Filesystem
  // пишет base64 как есть), а Buffer в WebView на телефоне не существует.
  "POST /api/map/image": async ({ vault, body }) => {
    if (!body.data) throw new ApiError("Нет данных изображения");
    const ext = IMAGE_EXT.test(body.ext) ? body.ext.toLowerCase() : "jpg";
    const name = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.${ext}`;
    // Оценка размера по длине base64 (реальные байты ~0.75×) — точная
    // проверка после декодирования была бы надёжнее, но decode здесь
    // не делаем нарочно (см. выше), а грубой оценки достаточно, чтобы
    // не пустить на диск что-то откровенно огромное.
    if (body.data.length > 28 * 1024 * 1024) throw new ApiError("Изображение слишком большое", 413);
    const relPath = await vault.saveImage(name, body.data);
    return { path: relPath };
  },

  "GET /api/trash": async ({ vault }) => vault.readJson("trash.json", []),
  "POST /api/trash": async ({ vault, body }) => {
    if (!Array.isArray(body)) throw new ApiError("Ожидался список удалённого");
    return vault.writeJson("trash.json", body);
  },

  "GET /api/history": async ({ vault, query }) => vault.history(query.get("file") || ""),
  "POST /api/history/restore": async ({ vault, body }) => {
    if (!body.file || !body.id) throw new ApiError("Не указан файл или версия");
    const data = await vault.versionAt(body.file, body.id);
    return vault.writeJson(body.file, data);
  },
};
