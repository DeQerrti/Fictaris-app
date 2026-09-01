// ══════════════════════════════════════════════
//  ЛОКАЛЬНАЯ СХЕМА app://
//
//  Раньше страница шла через http://127.0.0.1:<порт> — ровно затем,
//  чтобы абсолютные пути (/js/main.js, /maps/...) работали без
//  переделки фронтенда. Обычный file:// для этого не годится: под ним
//  "/js/main.js" резолвится в корень диска, а не в appDir. Своя
//  privileged-схема даёт то же самое (fetch, абсолютные пути, ES-модули
//  как на обычном origin), но без открытого сетевого порта и вообще без
//  HTTP — приём Obsidian для app://.
//
//  Отдаём байты напрямую через fs.readFile, а не net.fetch(file://...):
//  вложенный сетевой запрос изнутри protocol.handle на Windows иногда
//  зависает намертво при первом запуске (сеть Electron ещё не готова) —
//  окно тогда остаётся невидимым навсегда (ready-to-show не наступает),
//  хотя процесс жив и виден в диспетчере задач. Обычное чтение файла —
//  без сетевого стека вообще, без этого риска.
// ══════════════════════════════════════════════

import { protocol } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const APP_SCHEME = "app";
export const APP_HOST = "local";

const UI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "ui");

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

// Вызывается один раз, до app.whenReady() — Electron требует регистрацию
// привилегий схемы до готовности приложения.
export function registerAppScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ]);
}

function resolveInside(root, urlPath) {
  const decoded = decodeURIComponent(urlPath).replace(/^\/+/, "");
  const full = path.resolve(root, decoded);
  const rel = path.relative(root, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return full;
}

async function fileResponse(filePath) {
  let data;
  try {
    data = await fs.readFile(filePath);
  } catch {
    return null;
  }
  const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
  return new Response(data, { status: 200, headers: { "Content-Type": type } });
}

// Вызывается после app.whenReady(). getVault — та же функция-геттер, что
// уходит в appRoutes()/ipcMain-обработчик — на момент запроса хранилище
// может быть ещё не выбрано (экран приветствия).
export function registerAppProtocol({ appDir, getVault }) {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // ── Картинки карты — из хранилища, не из appDir ──
    if (pathname.startsWith("/maps/")) {
      const vault = getVault();
      const target = vault && resolveInside(vault.root, pathname);
      const res = target && (await fileResponse(target));
      if (res) return res;
      return new Response("Не найдено", { status: 404 });
    }

    // ── /api/* сюда попадать не должно (см. app/js/electron-bridge.js —
    // такие запросы уходят через IPC) — если всё же дошло, значит мост
    // не подключился, и это должно быть видно явной ошибкой, а не
    // молча отдавать index.html вместо JSON.
    if (pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "IPC bridge not connected" }), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    // ── Экран приветствия ──
    if (pathname === "/welcome" || pathname === "/welcome.html") {
      const res = await fileResponse(path.join(UI_DIR, "welcome.html"));
      if (res) return res;
    }

    // ── Страницы и скрипты приложения (с откатом на index.html) ──
    const clean = pathname === "/" ? "/index.html" : pathname;
    const direct = resolveInside(appDir, clean);
    const res = direct && (await fileResponse(direct));
    if (res) return res;

    const fallback = await fileResponse(path.join(appDir, "index.html"));
    return fallback || new Response("Не найдено", { status: 404 });
  });
}

export function appUrl(pathname) {
  return `${APP_SCHEME}://${APP_HOST}${pathname}`;
}
