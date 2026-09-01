// ══════════════════════════════════════════════
//  МАРШРУТЫ ДАННЫХ
//
//  v1: только то, что нужно минимальному костяку — Рукопись и
//  Персонажи. Каждый модуль хранится одним JSON-файлом целиком
//  (весь список персонажей / вся рукопись разом), как и было решено в
//  брифе для файлового хранилища.
// ══════════════════════════════════════════════

import { isAllowedFile } from "./files.js";

export class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const EMPTY_MANUSCRIPT = { chapters: [], activeChapterId: null };
const EMPTY_BOARD = { columns: [], cards: {}, cardOrder: {} };
const EMPTY_MAP = { rootIds: [], maps: {} };
const EMPTY_CANVAS = { order: [], canvases: {} };
const IMAGE_EXT = /^(jpg|jpeg|png|webp)$/i;

// Резервная копия/синхронизация (app/js/sync.js) — весь проект одним
// объектом: JSON-файлы как есть, картинки карты как base64. Формат
// специально не зовётся "backup", а помечен версией — на случай, если
// однажды понадобится развести схему на несовместимые.
const BACKUP_FORMAT = "fictaris-backup";
const BACKUP_VERSION = 1;
const BACKUP_FILES = [
  "characters.json",
  "manuscript.json",
  "locations.json",
  "relationships.json",
  "timeline.json",
  "board.json",
  "factions.json",
  "map.json",
  "canvas.json",
];

async function exportBackup({ vault }) {
  const files = {};
  for (const name of BACKUP_FILES) {
    files[name] = await vault.readJson(
      name,
      name === "manuscript.json"
        ? EMPTY_MANUSCRIPT
        : name === "board.json"
        ? EMPTY_BOARD
        : name === "map.json"
        ? EMPTY_MAP
        : name === "canvas.json"
        ? EMPTY_CANVAS
        : []
    );
  }

  // По одной и с перехватом: копия без одной картинки несравнимо лучше,
  // чем отсутствие копии вообще (тот же приём, что у TasteID).
  const images = {};
  let skippedImages = 0;
  for (const relPath of await vault.listImages()) {
    try {
      images[relPath] = await vault.readImage(relPath);
    } catch {
      skippedImages++;
    }
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    files,
    images,
    ...(skippedImages ? { skippedImages } : {}),
  };
}

async function restoreBackup({ vault, body }) {
  if (body?.format !== BACKUP_FORMAT) throw new ApiError("Это не файл резервной копии Fictaris");

  const files = body.files;
  if (files && typeof files === "object" && !Array.isArray(files)) {
    // site-settings.json (тема, акцент) — не в BACKUP_FILES и сюда не
    // попадает нарочно: это предпочтение конкретного устройства, а не
    // часть мира, и синхронизация не должна перекрашивать чужой экран.
    const names = Object.keys(files).filter((name) => isAllowedFile(name) && name !== "site-settings.json");
    for (const name of names) await vault.writeJson(name, files[name]);
  }

  let restoredImages = 0;
  const images = body.images;
  if (images && typeof images === "object" && !Array.isArray(images)) {
    for (const [relPath, base64] of Object.entries(images)) {
      if (typeof base64 !== "string" || !base64) continue;
      try {
        await vault.writeImage(relPath, base64);
        restoredImages++;
      } catch {
        // Порченый или подставной путь — пропускаем один файл, а не всё восстановление.
      }
    }
  }

  return { ok: true, restoredImages };
}

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

  "GET /api/canvas": async ({ vault }) => vault.readJson("canvas.json", EMPTY_CANVAS),
  "POST /api/canvas": async ({ vault, body }) => {
    if (!body || typeof body.canvases !== "object" || !Array.isArray(body.order)) {
      throw new ApiError("Некорректный холст");
    }
    return vault.writeJson("canvas.json", body);
  },

  "GET /api/trash": async ({ vault }) => vault.readJson("trash.json", []),
  "POST /api/trash": async ({ vault, body }) => {
    if (!Array.isArray(body)) throw new ApiError("Ожидался список удалённого");
    return vault.writeJson("trash.json", body);
  },

  // Тема, акцент — всё, что настраивает вид приложения, а не его данные
  // (см. app/js/theme.js). Отдельный файл, а не часть какого-то модуля:
  // он читается раньше всего остального, до того как выбран экран.
  "GET /api/site-settings": async ({ vault }) => vault.readJson("site-settings.json", {}),
  "POST /api/site-settings": async ({ vault, body }) => {
    if (!body || typeof body !== "object") throw new ApiError("Некорректные настройки");
    return vault.writeJson("site-settings.json", body);
  },

  "GET /api/export-backup": exportBackup,
  "POST /api/restore-backup": restoreBackup,

  "GET /api/history": async ({ vault, query }) => vault.history(query.get("file") || ""),
  "POST /api/history/restore": async ({ vault, body }) => {
    if (!body.file || !body.id) throw new ApiError("Не указан файл или версия");
    const data = await vault.versionAt(body.file, body.id);
    return vault.writeJson(body.file, data);
  },
  "POST /api/history/delete": async ({ vault, body }) => {
    if (!body.file || !body.id) throw new ApiError("Не указан файл или версия");
    await vault.deleteVersion(body.file, body.id);
    return { ok: true };
  },
  // days — 0 значит "никогда не запускать" и сюда не доходит (см.
  // AUTO_CLEANUP_OPTIONS в app/js/data-panel.js), но на всякий случай
  // не даём случайно стереть всё разом отрицательным/нулевым сроком.
  "POST /api/history/cleanup": async ({ vault, body }) => {
    const days = Number(body.days);
    if (!Number.isFinite(days) || days <= 0) throw new ApiError("Некорректный срок");
    const removed = await vault.cleanupHistory(days);
    return { removed };
  },
};
