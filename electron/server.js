// ══════════════════════════════════════════════
//  ЛОКАЛЬНЫЙ СЕРВЕР
//
//  Тот же приём, что в TasteID: страница отдаётся через
//  http://127.0.0.1:<порт>, а не file://, чтобы fetch и абсолютные пути
//  (/js/main.js) работали без переделки фронтенда. Слушаем только
//  127.0.0.1 — хранилище не должно быть видно в сети.
// ══════════════════════════════════════════════

import http from "node:http";
import { promises as fs, createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROUTES, ApiError } from "../core/api.js";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

// Картинки карты живут в хранилище (maps/), а не в составе приложения —
// отдаём их отдельно, по тому же пути, что вернул /api/map/image.
const VAULT_MEDIA = /^\/maps\//;

// Сохранения выполняются строго по одному — иначе два подряд идущих
// автосохранения (например, правка персонажа сразу после правки
// рукописи) могли бы прочитать состояние до записи друг друга и
// затереть чужую правку молча.
let queue = Promise.resolve();
function inQueue(task) {
  const result = queue.then(task, task);
  queue = result.then(
    () => {},
    () => {}
  );
  return result;
}

function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32 * 1024 * 1024) throw new ApiError("Слишком большой запрос", 413);
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError("Bad JSON");
  }
}

async function serveFile(res, filePath) {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    "Content-Length": stat.size,
    "Cache-Control": "no-cache",
  });
  createReadStream(filePath).pipe(res);
  return true;
}

function resolveInside(root, urlPath) {
  const decoded = decodeURIComponent(urlPath).replace(/^\/+/, "");
  const full = path.resolve(root, decoded);
  const rel = path.relative(root, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return full;
}

const UI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "ui");

export function createServer({ appDir, getVault, appRoutes = {} }) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const pathname = url.pathname;

    try {
      // ── API самого приложения (выбор папки и т.п.) — не требует vault ──
      const appHandler = appRoutes[`${req.method} ${pathname}`];
      if (appHandler) {
        const body = req.method === "POST" ? await readBody(req) : {};
        return sendJson(res, (await appHandler({ body, query: url.searchParams })) || { ok: true });
      }

      // ── API данных ──
      if (pathname.startsWith("/api/")) {
        const handler = ROUTES[`${req.method} ${pathname}`];
        if (!handler) return sendJson(res, { error: "Not Found" }, 404);

        const vault = getVault();
        if (!vault) return sendJson(res, { error: "Хранилище не выбрано" }, 503);

        const body = req.method === "POST" ? await readBody(req) : {};
        const run = () => handler({ vault, body, query: url.searchParams });
        const result = req.method === "POST" ? await inQueue(run) : await run();
        return sendJson(res, result);
      }

      if (req.method !== "GET" && req.method !== "HEAD") {
        return sendJson(res, { error: "Method Not Allowed" }, 405);
      }

      // ── Картинки карты — из хранилища ──
      const vaultForMedia = getVault();
      if (vaultForMedia && VAULT_MEDIA.test(pathname)) {
        const target = resolveInside(vaultForMedia.root, pathname);
        if (target && (await serveFile(res, target))) return;
      }

      // ── Экран приветствия ──
      if (pathname === "/welcome" || pathname === "/welcome.html") {
        if (await serveFile(res, path.join(UI_DIR, "welcome.html"))) return;
      }

      // ── Страницы и скрипты приложения ──
      const clean = pathname === "/" ? "/index.html" : pathname;
      const direct = resolveInside(appDir, clean);
      if (direct && (await serveFile(res, direct))) return;

      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Не найдено");
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 500;
      sendJson(res, { error: e.message }, status);
    }
  });
}

// Свой порт, отличный от TasteID (47821) — оба приложения способны
// работать одновременно на одной машине без конфликта.
const PREFERRED_PORT = 47919;

export function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", (err) => {
      if (err.code !== "EADDRINUSE") return reject(err);
      server.removeAllListeners("error");
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve(server.address().port));
    });
    server.listen(PREFERRED_PORT, "127.0.0.1", () => resolve(server.address().port));
  });
}
