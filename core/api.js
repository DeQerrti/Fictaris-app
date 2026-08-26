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
};
