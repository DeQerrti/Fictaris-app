// ══════════════════════════════════════════════
//  МОБИЛЬНАЯ ОБВЯЗКА
//
//  На компьютере страницы говорят с диском через локальный HTTP-сервер
//  на 127.0.0.1. На телефоне поднять его негде — но переписывать из-за
//  этого фронтенд не нужно: страница по-прежнему делает
//  fetch("/api/characters") и т.д., а здесь эти запросы перехватываются
//  и уходят в файловую систему телефона через Capacitor. core/api.js
//  делят настольная и мобильная версии — отличается только Vault под
//  ним. Тот же приём, что у TasteID (mobile/src/main.js).
//
//  Собирается в один обычный скрипт (app/js/mobile.bundle.js), не
//  модуль: модули откладываются до конца разбора страницы, а main.js
//  делает fetch("/api/app/info") уже во время разбора — перехват
//  опоздал бы.
//
//  Вне телефона файл не делает ничего: на компьютере есть настоящий
//  сервер, и подменять ему fetch незачем.
// ══════════════════════════════════════════════

import { Filesystem, Directory } from "@capacitor/filesystem";
import { App } from "@capacitor/app";
import { ROUTES, ApiError } from "../../core/api.js";
import { MobileVault } from "./vault.js";

const NATIVE = typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.();

// Метка на карте — единственное место, где Fictaris хранит бинарные
// файлы отдельно от JSON (см. Vault.saveImage). <img src="/maps/…"> —
// не fetch, а загрузка ресурса, перехватить её подменой window.fetch
// нельзя; вместо этого путь переписывается на настоящий файловый адрес
// через Capacitor.convertFileSrc — см. installImages() ниже.
const MAP_IMAGE = /^\/maps\/.+/i;

let appVersionCache = null;
async function appVersion() {
  if (appVersionCache !== null) return appVersionCache;
  try {
    appVersionCache = (await App.getInfo()).version || "";
  } catch {
    appVersionCache = "";
  }
  return appVersionCache;
}

// ── Несколько проектов ─────────────────────────
// На компьютере список {id,name,path} живёт в конфиге, путь выбирают
// проводником. На телефоне своего проводника нет — список просто
// {id,name} в localStorage, а путь на диске всегда выводится из id
// (см. vaultDir в vault.js). Поэтому здесь нет «выбрать папку», есть
// только «дать имя» — фронтенд (project-switcher.js) знает про это по
// флагу mobile:true в ответе /api/app/info.
const VAULTS_KEY = "fictaris_vaults";
const CURRENT_VAULT_KEY = "fictaris_current_vault";

function genVaultId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function listVaults() {
  let list;
  try {
    list = JSON.parse(localStorage.getItem(VAULTS_KEY) || "null");
  } catch {
    list = null;
  }
  if (!Array.isArray(list) || !list.length) {
    list = [{ id: "default", name: "Мой проект" }];
    saveVaults(list);
  }
  return list;
}

function saveVaults(list) {
  localStorage.setItem(VAULTS_KEY, JSON.stringify(list));
}

function currentVaultId() {
  return localStorage.getItem(CURRENT_VAULT_KEY) || "default";
}

let vault = new MobileVault(currentVaultId());

const srcCache = new Map();
function clearImageCache() {
  srcCache.clear();
}

async function appRoutes(pathname, body) {
  if (pathname === "/api/app/info") {
    return {
      vaultPath: vault.root,
      vaults: listVaults(),
      currentVaultId: currentVaultId(),
      version: await appVersion(),
      mobile: true,
    };
  }
  if (pathname === "/api/app/switch-vault") {
    const entry = listVaults().find((v) => v.id === body?.id);
    if (!entry) throw new Error("Проект не найден");
    localStorage.setItem(CURRENT_VAULT_KEY, entry.id);
    vault = new MobileVault(entry.id);
    await vault.ensure();
    clearImageCache();
    return { ok: true, vault: entry };
  }
  // Аналог desktop-flow pick-vault+use-vault, только вместо папки —
  // имя: на телефоне нечего выбирать, кроме названия.
  if (pathname === "/api/app/add-vault") {
    const name = String(body?.name || "").trim() || "Новый проект";
    const entry = { id: genVaultId(), name };
    saveVaults([...listVaults(), entry]);
    localStorage.setItem(CURRENT_VAULT_KEY, entry.id);
    vault = new MobileVault(entry.id);
    await vault.ensure();
    clearImageCache();
    return { ok: true, vault: entry };
  }
  if (pathname === "/api/app/rename-vault") {
    const name = String(body?.name || "").trim();
    if (!body?.id || !name) throw new Error("Проект не найден");
    saveVaults(listVaults().map((v) => (v.id === body.id ? { ...v, name } : v)));
    return { ok: true };
  }
  if (pathname === "/api/app/remove-vault") {
    const list = listVaults();
    if (list.length <= 1) throw new Error("Нельзя убрать последний проект.");
    if (body?.id === currentVaultId()) throw new Error("Сначала переключись на другой проект.");
    const entry = list.find((v) => v.id === body?.id);
    if (!entry) throw new Error("Проект не найден");
    // В отличие от компьютера — это настоящее удаление файлов, а не
    // просто снятие с полки: заново открыть отвязанный проект на
    // телефоне нечем, проводника нет.
    await new MobileVault(entry.id).remove();
    saveVaults(list.filter((v) => v.id !== entry.id));
    return { ok: true };
  }
  // Открыть папку в системном проводнике на телефоне нечем — молча
  // отвечаем ok, кнопка эту возможность на мобильном и не показывает.
  if (pathname === "/api/app/open-vault-folder") return { ok: true };
  // Остальное (pick-vault и т.п.) с телефона неприменимо, но отвечать
  // всё равно надо — иначе застрявший на компьютерном пути fetch
  // просто зависнет без ответа.
  if (pathname.startsWith("/api/app/")) return { ok: true };
  return null;
}

// ── Перехват запросов ──────────────────────────

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function handle(pathname, search, init) {
  const method = (init?.method || "GET").toUpperCase();
  const body = init?.body ? JSON.parse(init.body) : {};

  if (pathname.startsWith("/api/app/")) {
    try {
      const res = await appRoutes(pathname, body);
      if (res) return jsonResponse(res);
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  if (pathname.startsWith("/api/")) {
    const handler = ROUTES[`${method} ${pathname}`];
    if (!handler) return jsonResponse({ error: "Not Found" }, 404);
    try {
      const query = new URLSearchParams(search || "");
      return jsonResponse((await handler({ vault, body, query })) || { ok: true });
    } catch (e) {
      return jsonResponse({ error: e.message }, e instanceof ApiError ? e.status : 500);
    }
  }

  return null; // не наше — пусть идёт обычным путём (страницы приложения)
}

function installFetch() {
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url || "";
    if (url.startsWith("/")) {
      const [pathname, search] = url.split("?");
      const merged = typeof input === "object" && input ? { ...input, ...init } : init;
      const res = await handle(pathname, search, merged);
      if (res) return res;
    }
    return original(input, init);
  };
}

// ── Картинки карты ──────────────────────────────

async function mapImageSrc(pathname) {
  if (srcCache.has(pathname)) return srcCache.get(pathname);
  const promise = (async () => {
    const rel = decodeURIComponent(pathname).replace(/^\/+/, "");
    const { uri } = await Filesystem.getUri({ path: `${vault.root}/${rel}`, directory: Directory.Data });
    return window.Capacitor.convertFileSrc(uri);
  })();
  srcCache.set(pathname, promise);
  return promise;
}

function rewriteImage(img) {
  const src = img.getAttribute("src") || "";
  if (!MAP_IMAGE.test(src)) return;
  if (img.dataset.mapSrc === src) return;
  img.dataset.mapSrc = src;
  mapImageSrc(src)
    .then((real) => {
      if (img.dataset.mapSrc === src) img.src = real;
    })
    .catch(() => {});
}

function installImages() {
  const scan = (root) => {
    if (root.nodeType !== 1) return;
    if (root.tagName === "IMG") rewriteImage(root);
    root.querySelectorAll?.("img").forEach(rewriteImage);
  };
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "attributes" && r.target.tagName === "IMG") rewriteImage(r.target);
      r.addedNodes?.forEach(scan);
    }
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src"],
  });
  scan(document.documentElement);
}

if (NATIVE) {
  installFetch();
  installImages();
  vault.ensure().catch(() => {});
}
