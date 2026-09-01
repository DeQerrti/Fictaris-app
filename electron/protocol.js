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
// ══════════════════════════════════════════════

import { protocol, net } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

export const APP_SCHEME = "app";
export const APP_HOST = "local";

const UI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "ui");

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
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;
  } catch {
    return null;
  }
  return net.fetch(pathToFileURL(filePath).toString());
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
