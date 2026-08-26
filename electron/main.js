// ══════════════════════════════════════════════
//  ОКНО ПРИЛОЖЕНИЯ
//
//  v1: одно хранилище (одна папка проекта), без переключения между
//  несколькими мирами/рукописями — многопроектность в брифе отмечена
//  как отдельный пункт роадмапа, не костяк. Порядок запуска:
//    папка известна и на месте  → сразу главная
//    папки нет или пропала      → экран приветствия
// ══════════════════════════════════════════════

import { app, BrowserWindow, dialog, shell, Menu } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Vault } from "./vault.js";
import { createServer, listen } from "./server.js";

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
  await saveConfig({ vaultPath: root });
}

function appRoutes() {
  return {
    "GET /api/app/info": async () => ({ vaultPath: vault?.root || null }),

    "POST /api/app/pick-vault": async () => ({ path: await askForVault() }),

    "POST /api/app/use-vault": async ({ body }) => {
      if (!body.path) throw new Error("Не указана папка");
      await useVault(body.path);
      openMain();
      return { ok: true };
    },

    "POST /api/app/open-vault-folder": async () => {
      if (vault) await shell.openPath(vault.root);
      return { ok: true };
    },
  };
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
  const known = config.vaultPath && (await exists(config.vaultPath));
  if (known) await useVault(config.vaultPath);

  const server = createServer({ appDir: APP_DIR, getVault: () => vault, appRoutes: appRoutes() });
  port = await listen(server);

  // Безрамочного окна нет (в отличие от TasteID) — оставляем системную
  // рамку в v1, чтобы не тащить electron/chrome.js ради минимального
  // костяка; полоса меню не нужна и без своих сочетаний клавиш.
  Menu.setApplicationMenu(null);

  createWindow();
  if (known) openMain();
  else openWelcome();

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
