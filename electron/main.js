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

import { app, BrowserWindow, dialog, shell, Menu, MenuItem } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Vault } from "./vault.js";
import { createServer, listen } from "./server.js";
import { findUpdate, openDownload } from "./update.js";
import { titleBarOptions, titleBarCss, overlayColors } from "./chrome.js";
// Именно так, а не `import { autoUpdater } from "electron-updater"` — см.
// тот же приём и тот же комментарий в electron/main.js у TasteID:
// electron-updater — модуль CommonJS, и в упакованном app.asar именованный
// импорт падает с SyntaxError прямо при старте. Через default-импорт и
// деструктуризацию работает и из исходников, и из собранного .exe.
import pkg from "electron-updater";
const { autoUpdater } = pkg;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.join(HERE, "..", "app");

// Масштаб — проценты, а не «уровни» setZoomLevel: тот множит на 1.2 за
// шаг, поэтому от 100% сразу прыгает на 120%, потом на 144% — с таким
// шагом не попасть ни на 110%, ни на 140%. setZoomFactor принимает
// множитель напрямую (1.4 = 140%), отсюда и везде проценты. Предел в
// обе стороны — чтобы нельзя было довести окно до нечитаемого и не
// суметь вернуть обратно. По образцу TasteID (electron/main.js).
const ZOOM_MIN = 50;
const ZOOM_MAX = 200;
const ZOOM_STEP = 10;

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
      if (lastUpdateError) return { type: "error", version: downloadingVersion, message: lastUpdateError };
      if (downloadingVersion) return { type: "downloading", version: downloadingVersion };
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
      downloadingVersion = null;
      lastUpdateError = null;
      return { ok: true };
    },

    // Кнопка «Проверить обновления» в разделе «Данные» — в отличие от
    // тихой проверки при запуске, всегда возвращает статус и снимает
    // прошлый отказ («Позже»), если человек попросил проверить сам.
    "POST /api/app/check-update": async () => checkForUpdatesManual(),

    // Масштаб окна — настройка самого приложения (Electron config), не
    // мира в хранилище: значение общее на устройство, а не на проект,
    // поэтому не в site-settings.json, а тут же, где остальной /api/app/*.
    "GET /api/app/zoom": async () => ({ percent: config.zoom ?? 100, min: ZOOM_MIN, max: ZOOM_MAX, step: ZOOM_STEP }),
    "POST /api/app/zoom": async ({ body }) => {
      const percent = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(body.percent) || 100));
      applyZoom(percent);
      await saveConfig({ zoom: percent });
      return { percent };
    },

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

    // Тему можно сменить и без перезагрузки страницы (Настройки →
    // Оформление) — did-finish-load тогда не срабатывает, а рамка иначе
    // так и осталась бы в цветах темы, с которой открылось окно.
    "POST /api/app/set-titlebar-colors": async ({ body }) => {
      applyTitleBarColors(body.bg, body.symbol);
      if (isHexColor(body.bg)) {
        const skin = body.skin === "light" ? "light" : "dark";
        if (skin !== config.skin) await saveConfig({ skin });
      }
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
// downloadingVersion/lastUpdateError — то же самое для промежуточного
// состояния «качаем прямо сейчас»: раньше падение скачивания (сеть
// оборвалась на середине, диск кончился) было не видно вообще —
// autoUpdater просто ничего не делал дальше, а на экране навсегда
// оставалась надпись «Скачивается…» без единого шанса узнать, что что-то
// пошло не так.
let pendingUpdateInfo = null;
let macUpdateInfo = null;
let downloadingVersion = null;
let lastUpdateError = null;

autoUpdater.on("download-progress", (progress) => {
  downloadingVersion = downloadingVersion || progress.version || null;
});

autoUpdater.on("update-downloaded", (info) => {
  downloadingVersion = null;
  lastUpdateError = null;
  if (config.dismissedUpdate === info.version) return;
  pendingUpdateInfo = info;
});

autoUpdater.on("error", (err) => {
  downloadingVersion = null;
  lastUpdateError = String(err?.message || err || "unknown error");
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

  if (pendingUpdateInfo) return { status: "ready", version: pendingUpdateInfo.version };
  lastUpdateError = null;
  try {
    const result = await autoUpdater.checkForUpdates();
    const version = result?.updateInfo?.version;
    if (!version || version === app.getVersion()) return { status: "latest" };
    // Обновление нашлось и качается в фоне — раздел «Данные» дальше сам
    // поллит GET /api/app/update-status, пока не придёт «ready» или
    // «error» (см. downloadingVersion/lastUpdateError выше).
    downloadingVersion = version;
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

// ── Масштаб, меню и рамка ────────────────────────
// Раньше в v1 меню не было вовсе (Menu.setApplicationMenu(null)) — без
// него не работали ни зум, ни F5, ни девтулы.
function applyZoom(percent) {
  win?.webContents.setZoomFactor(percent / 100);
}

const isHexColor = (v) => /^#[0-9a-f]{6}$/i.test(v || "");

// Красит кнопки свернуть/развернуть/закрыть в переданные цвета — вызывается
// и с посчитанными на did-finish-load (по вычисленным --bg/--text-dim
// страницы), и с тем, что страница сама прислала при живой смене темы без
// перезагрузки (см. POST /api/app/set-titlebar-colors в appRoutes).
function applyTitleBarColors(bg, symbol) {
  if (!win || process.platform === "darwin" || !win.setTitleBarOverlay) return;
  if (!isHexColor(bg) || !isHexColor(symbol)) return;
  win.setTitleBarOverlay(titleBarOptions(process.platform, { bg, symbol }).titleBarOverlay);
}

async function bumpZoom(deltaPercent) {
  const percent = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (config.zoom ?? 100) + deltaPercent));
  applyZoom(percent);
  await saveConfig({ zoom: percent });
}

// Сама полоса меню (Файл/Вид) в интерфейс не вписывалась — не под тему
// приложения, и дублировала то, что удобнее держать в Настройках
// (масштаб — рядом с размером шрифта). Но горячие клавиши из неё нужны
// по-прежнему, а без зарегистрированного Menu акселераторы Electron не
// работают вовсе — поэтому меню остаётся зарегистрированным (в фоне,
// accelerator'ы это не требует видимой полосы), а сама полоса прячется
// через win.removeMenu() отдельно для каждого окна (Windows/Linux; на
// macOS полоса меню — часть системного меню наверху экрана, а не окна,
// и её принято оставлять).
// ── Контекстное меню по правой кнопке ────────────
// В отличие от обычного окна Chrome, Electron НЕ показывает системное
// меню Вырезать/Копировать/Вставить сам по себе — это нужно собрать
// вручную через событие "context-menu" на webContents. Раньше его не
// было вовсе, поэтому правая кнопка в рукописи (и вообще где угодно —
// поле названия главы, заметки автора и т.д.) ничего не делала.
// Собираем то же самое, что у любого текстового редактора (Word,
// Obsidian — тоже Electron-приложение — браузеры): подсказки
// орфографии сверху (Electron проверяет её сам, если включён spellcheck
// в сессии — включён по умолчанию), затем Отменить/Повторить,
// Вырезать/Копировать/Вставить/Выделить всё для полей ввода, и просто
// «Копировать», если это не поле ввода, но есть выделенный текст.
function buildContextMenu(webContents, params) {
  const menu = new Menu();

  if (params.misspelledWord) {
    for (const suggestion of params.dictionarySuggestions.slice(0, 6)) {
      menu.append(new MenuItem({ label: suggestion, click: () => webContents.replaceMisspelling(suggestion) }));
    }
    if (params.dictionarySuggestions.length) menu.append(new MenuItem({ type: "separator" }));
    menu.append(
      new MenuItem({
        label: "Добавить в словарь",
        click: () => webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      })
    );
    menu.append(new MenuItem({ type: "separator" }));
  }

  if (params.isEditable) {
    menu.append(new MenuItem({ label: "Отменить", role: "undo", enabled: params.editFlags.canUndo }));
    menu.append(new MenuItem({ label: "Повторить", role: "redo", enabled: params.editFlags.canRedo }));
    menu.append(new MenuItem({ type: "separator" }));
    menu.append(new MenuItem({ label: "Вырезать", role: "cut", enabled: params.editFlags.canCut }));
    menu.append(new MenuItem({ label: "Копировать", role: "copy", enabled: params.editFlags.canCopy }));
    menu.append(new MenuItem({ label: "Вставить", role: "paste", enabled: params.editFlags.canPaste }));
    menu.append(
      new MenuItem({ label: "Вставить без форматирования", role: "pasteAndMatchStyle", enabled: params.editFlags.canPaste })
    );
    menu.append(new MenuItem({ type: "separator" }));
    menu.append(new MenuItem({ label: "Выделить всё", role: "selectAll", enabled: params.editFlags.canSelectAll }));
  } else if (params.selectionText) {
    menu.append(new MenuItem({ label: "Копировать", role: "copy" }));
  }

  if (menu.items.length) menu.popup({ window: win });
}

// Полоса меню (Файл/Вид) — только ради акселераторов зума/F5/девтулов,
// сама себя не показывает поверх контента. Рамку окна рисует
// electron/chrome.js — своя, в цветах темы, как у TasteID.
function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Файл",
        submenu: [
          { role: "quit", label: "Выход" },
          { label: "Обновить", accelerator: "F5", click: () => win?.reload() },
          { label: "Инструменты разработчика", accelerator: "F12", click: () => win?.webContents.toggleDevTools() },
        ],
      },
      {
        label: "Вид",
        submenu: [
          { label: "Крупнее", accelerator: "CommandOrControl+=", click: () => bumpZoom(ZOOM_STEP) },
          { label: "Мельче", accelerator: "CommandOrControl+-", click: () => bumpZoom(-ZOOM_STEP) },
          { label: "Обычный размер", accelerator: "CommandOrControl+0", click: () => bumpZoom(100 - (config.zoom ?? 100)) },
          { role: "togglefullscreen", label: "Во весь экран" },
        ],
      },
    ])
  );
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
    backgroundColor: overlayColors(config.skin).bg,
    ...titleBarOptions(process.platform, overlayColors(config.skin)),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  win.once("ready-to-show", () => win.show());
  if (process.platform !== "darwin") win.removeMenu();
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Полосу для перетаскивания вставляем на каждую загрузку страницы (и
  // главного экрана, и /welcome) — dom-ready, а не did-finish-load: тот
  // срабатывает уже после первой отрисовки, и страница на мгновение
  // успевала бы нарисоваться без отступа сверху, а потом резко просесть
  // вниз при подстановке CSS.
  win.webContents.on("dom-ready", () => {
    win.webContents.insertCSS(titleBarCss()).catch(() => {});
  });

  win.webContents.on("did-finish-load", async () => {
    applyZoom(config.zoom ?? 100);
    // Тему выбирают внутри приложения, а цвет кнопок окна рисует
    // система — подхватываем его после загрузки по вычисленным цветам
    // страницы, чтобы рамка не осталась в цветах предыдущей темы (и
    // совпадала даже с акцентом, перекрашенным вручную).
    try {
      const { skin, bg, symbol } = await win.webContents.executeJavaScript(`
        (() => {
          const cs = getComputedStyle(document.documentElement);
          return {
            skin: document.documentElement.dataset.skin || "dark",
            bg: cs.getPropertyValue("--bg").trim(),
            symbol: cs.getPropertyValue("--text-dim").trim(),
          };
        })()
      `);
      if (skin !== config.skin) await saveConfig({ skin });
      if (isHexColor(bg) && isHexColor(symbol)) applyTitleBarColors(bg, symbol);
      else applyTitleBarColors(overlayColors(skin).bg, overlayColors(skin).symbol);
    } catch {
      // Экран приветствия (нет data-skin/CSS-переменных) или страница ещё
      // не дочитала тему — рамка остаётся в цветах по умолчанию, и это не
      // повод падать.
    }
  });
  win.webContents.on("context-menu", (_event, params) => buildContextMenu(win.webContents, params));

  // Дать автосинхронизации (app/js/sync.js) недолго доработать перед
  // закрытием окна — закрыв Fictaris, человек с большой вероятностью не
  // откроет его снова в ближайшие минуты, чтобы обычная отложенная
  // синхронизация успела сама. Перехватываем закрытие ОКНА, а не
  // app.on("before-quit"): к этому моменту webContents уже уничтожены.
  // Закрыться нужно в любом случае — сеть может быть недоступна, и
  // зависать из-за этого нельзя.
  const closingWin = win;
  let closingForReal = false;
  closingWin.on("close", (e) => {
    if (closingForReal || closingWin.webContents.isDestroyed()) return;
    e.preventDefault();
    const finish = () => {
      closingForReal = true;
      closingWin.close();
    };
    const timeout = new Promise((resolve) => setTimeout(resolve, 6000));
    const synced = closingWin.webContents
      .executeJavaScript("window.__syncBeforeQuit ? window.__syncBeforeQuit() : null")
      .catch(() => {});
    Promise.race([synced, timeout]).then(finish);
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
  // рамку, чтобы не тащить electron/chrome.js; полоса меню — только
  // ради зума/F5/девтулов, сама себя не показывает поверх контента.
  buildMenu();

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
