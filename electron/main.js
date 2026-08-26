// ══════════════════════════════════════════════
//  ОКНО ПРИЛОЖЕНИЯ
//
//  Несколько хранилищ (проектов) — список живёт в конфиге вместе с
//  currentVaultId, по образцу TasteID (electron/main.js). Путь остаётся
//  ключом: повторный выбор той же папки не заводит вторую запись, а
//  переключает на уже существующую. Порядок запуска:
//    текущее хранилище известно и на месте  → сразу главная
//    хранилища нет, оно пропало, или это первый запуск → экран приветствия
// ══════════════════════════════════════════════

import { app, BrowserWindow, dialog, shell, Menu } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Vault } from "./vault.js";
import { createServer, listen } from "./server.js";
import { findUpdate, openDownload } from "./update.js";
// Именно так, а не `import { autoUpdater } from "electron-updater"` — см.
// тот же приём и тот же комментарий в electron/main.js у TasteID:
// electron-updater — модуль CommonJS, и в упакованном app.asar именованный
// импорт падает с SyntaxError прямо при старте. Через default-импорт и
// деструктуризацию работает и из исходников, и из собранного .exe.
import pkg from "electron-updater";
const { autoUpdater } = pkg;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.join(HERE, "..", "app");

// Без замка на один экземпляр второй запуск при уже открытом окне
// заводит второй процесс поверх первого — тот же случай, что и в
// TasteID (electron/main.js), см. комментарий там.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const configFile = () => path.join(app.getPath("userData"), "config.json");

let vault = null;
let win = null;
let port = null;
let config = {};

async function readConfig() {
  try {
    return JSON.parse(await fs.readFile(configFile(), "utf8"));
  } catch {
    return {};
  }
}

async function saveConfig(patch) {
  config = { ...config, ...patch };
  await fs.mkdir(path.dirname(configFile()), { recursive: true });
  await fs.writeFile(configFile(), JSON.stringify(config, null, 2));
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function askForVault() {
  const suggested = path.join(app.getPath("documents"), "Fictaris");
  const { canceled, filePaths } = await dialog.showOpenDialog(win ?? undefined, {
    title: "Где хранить проект",
    defaultPath: suggested,
    properties: ["openDirectory", "createDirectory"],
    buttonLabel: "Выбрать папку",
  });
  return canceled ? null : filePaths[0];
}

async function useVault(root) {
  vault = new Vault(root);
  await vault.ensure();
}

// ── Несколько проектов ─────────────────────────
// Раньше был только vaultPath — при первом запуске после обновления он
// переезжает сюда единственной записью и дальше не используется.

function genVaultId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function migrateVaults() {
  if (config.vaults || !config.vaultPath) return;
  const id = genVaultId();
  await saveConfig({
    vaults: [{ id, name: path.basename(config.vaultPath) || "Проект", path: config.vaultPath }],
    currentVaultId: id,
  });
}

function currentVaultEntry() {
  return (config.vaults || []).find((v) => v.id === config.currentVaultId) || null;
}

async function addVaultEntry(root, name) {
  const id = genVaultId();
  const entry = { id, name: name || path.basename(root) || "Проект", path: root };
  await useVault(root);
  await saveConfig({ vaults: [...(config.vaults || []), entry], currentVaultId: id });
  return entry;
}

async function switchVaultTo(id) {
  const entry = (config.vaults || []).find((v) => v.id === id);
  if (!entry) throw new Error("Хранилище не найдено");
  await useVault(entry.path);
  await saveConfig({ currentVaultId: id });
  return entry;
}

// Тот же путь мог уже быть в списке под своим именем — тогда просто
// переключаемся на запись, а не заводим дубликат с тем же адресом на
// диске.
async function useVaultPath(root, name) {
  const existing = (config.vaults || []).find((v) => path.resolve(v.path) === path.resolve(root));
  if (existing) return switchVaultTo(existing.id);
  return addVaultEntry(root, name);
}

function appRoutes() {
  return {
    "GET /api/app/info": async () => ({
      vaultPath: vault?.root || null,
      vaults: (config.vaults || []).map(({ id, name, path: p }) => ({ id, name, path: p })),
      currentVaultId: config.currentVaultId || null,
      version: app.getVersion(),
    }),

    // Полоска обновления в интерфейсе (app/js/update-banner.js) не
    // тянет ipc — опрашивает этот адрес обычным поллингом, как и всё
    // остальное общение страницы с диском.
    "GET /api/app/update-status": async () => {
      if (pendingUpdateInfo) return { type: "ready", version: pendingUpdateInfo.version };
      if (macUpdateInfo) return { type: "available", version: macUpdateInfo.version };
      return { type: null };
    },

    "POST /api/app/update-restart": async () => {
      if (!pendingUpdateInfo) return { ok: false };
      // Второй аргумент — isForceRunAfter: без него electron-updater не
      // гарантирует перезапуск после тихой (oneClick) установки на
      // Windows, и приложение просто закрывалось, не открываясь обратно.
      autoUpdater.quitAndInstall(false, true);
      return { ok: true };
    },

    "POST /api/app/update-download": async () => {
      if (macUpdateInfo) openDownload(macUpdateInfo);
      return { ok: true };
    },

    "POST /api/app/update-dismiss": async ({ body }) => {
      await saveConfig({ dismissedUpdate: body.version });
      pendingUpdateInfo = null;
      macUpdateInfo = null;
      return { ok: true };
    },

    // Кнопка «Проверить обновления» в разделе «Данные» — в отличие от
    // тихой проверки при запуске, всегда возвращает статус и снимает
    // прошлый отказ («Позже»), если человек попросил проверить сам.
    "POST /api/app/check-update": async () => checkForUpdatesManual(),

    "POST /api/app/pick-vault": async () => ({ path: await askForVault() }),

    "POST /api/app/use-vault": async ({ body }) => {
      if (!body.path) throw new Error("Не указана папка");
      const entry = await useVaultPath(body.path, body.name);
      openMain();
      return { ok: true, vault: entry };
    },

    "POST /api/app/switch-vault": async ({ body }) => {
      if (!body.id) throw new Error("Хранилище не найдено");
      const entry = await switchVaultTo(body.id);
      return { ok: true, vault: entry };
    },

    "POST /api/app/rename-vault": async ({ body }) => {
      const name = String(body.name || "").trim();
      if (!body.id || !name) throw new Error("Хранилище не найдено");
      const vaults = (config.vaults || []).map((v) => (v.id === body.id ? { ...v, name } : v));
      await saveConfig({ vaults });
      return { ok: true };
    },

    "POST /api/app/remove-vault": async ({ body }) => {
      const vaults = config.vaults || [];
      if (vaults.length <= 1) throw new Error("Нельзя убрать последний проект.");
      if (body.id === config.currentVaultId) throw new Error("Сначала переключись на другой проект.");
      if (!vaults.some((v) => v.id === body.id)) throw new Error("Хранилище не найдено");
      await saveConfig({ vaults: vaults.filter((v) => v.id !== body.id) });
      return { ok: true };
    },

    "POST /api/app/open-vault-folder": async () => {
      if (vault) await shell.openPath(vault.root);
      return { ok: true };
    },
  };
}

// ── Обновления ─────────────────────────────────
// На Windows и Linux — тихо: electron-updater сам качает файл в фоне,
// полоска в интерфейсе (update-status) появляется только когда всё уже
// готово и осталось лишь перезапустить. На macOS так не выходит —
// Gatekeeper блокирует подмену приложения в фоне без платной подписи, а
// её здесь нет и не планируется (см. electron/update.js). Поэтому мак
// остаётся на пути «нашли — предложили открыть страницу загрузки».
//
// Отказ («Позже») запоминается в конфиге по номеру версии, чтобы про
// одну и ту же версию не спрашивать при каждом запуске подряд.
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = false;

// pendingUpdateInfo — файл уже скачан (Windows/Linux), macUpdateInfo —
// на GitHub есть более новая версия (macOS). Оба читает GET
// /api/app/update-status, оба сбрасывает POST /api/app/update-dismiss.
let pendingUpdateInfo = null;
let macUpdateInfo = null;

autoUpdater.on("update-downloaded", (info) => {
  if (config.dismissedUpdate === info.version) return;
  pendingUpdateInfo = info;
});

async function checkForUpdatesMac() {
  try {
    const update = await findUpdate(app.getVersion());
    if (!update || config.dismissedUpdate === update.version) return;
    macUpdateInfo = update;
  } catch {
    // Нет сети или GitHub недоступен — не повод тревожить человека.
  }
}

// Ручная проверка — кнопка «Проверить обновления» в разделе «Данные».
// В отличие от автоматической, всегда снимает прошлый отказ: если
// человек однажды нажал «Позже», а потом сам попросил проверить снова,
// молчать в ответ на dismissedUpdate было бы странно.
async function checkForUpdatesManual() {
  if (!app.isPackaged) return { status: "dev" };
  await saveConfig({ dismissedUpdate: null });

  if (process.platform === "darwin") {
    try {
      const update = await findUpdate(app.getVersion());
      if (!update) return { status: "latest" };
      macUpdateInfo = update;
      return { status: "available", version: update.version };
    } catch {
      return { status: "error" };
    }
  }

  if (pendingUpdateInfo) return { status: "available", version: pendingUpdateInfo.version };
  try {
    const result = await autoUpdater.checkForUpdates();
    const version = result?.updateInfo?.version;
    if (!version || version === app.getVersion()) return { status: "latest" };
    // Обновление нашлось и качается в фоне — полоска появится сама,
    // как только download закончится (update-downloaded выше).
    return { status: "downloading", version };
  } catch {
    return { status: "error" };
  }
}

function checkForUpdates() {
  if (!app.isPackaged) return; // при запуске из исходников (npm start) не мешаем
  if (process.platform === "darwin") {
    checkForUpdatesMac();
    return;
  }
  autoUpdater.checkForUpdates().catch(() => {
    // Нет сети или GitHub недоступен — не повод тревожить человека.
  });
}

function openMain() {
  win?.loadURL(`http://127.0.0.1:${port}/`);
}

function openWelcome() {
  win?.loadURL(`http://127.0.0.1:${port}/welcome`);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 480,
    minHeight: 560,
    show: false,
    backgroundColor: "#14110d",
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

app.whenReady().then(async () => {
  config = await readConfig();
  await migrateVaults();

  // Папка могла уехать на флешке или быть переименована. Молча завести
  // взамен пустую — худшее, что можно сделать: человек решит, что
  // данные пропали. Поэтому просто ведём на экран приветствия, где
  // видно, что папку надо указать.
  const current = currentVaultEntry();
  const known = current && (await exists(current.path));
  if (known) await useVault(current.path);

  const server = createServer({ appDir: APP_DIR, getVault: () => vault, appRoutes: appRoutes() });
  port = await listen(server);

  // Безрамочного окна нет (в отличие от TasteID) — оставляем системную
  // рамку в v1, чтобы не тащить electron/chrome.js ради минимального
  // костяка; полоса меню не нужна и без своих сочетаний клавиш.
  Menu.setApplicationMenu(null);

  createWindow();
  if (known) openMain();
  else openWelcome();
  checkForUpdates();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      if (vault) openMain();
      else openWelcome();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
