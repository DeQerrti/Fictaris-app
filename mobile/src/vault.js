// ══════════════════════════════════════════════
//  ХРАНИЛИЩЕ НА ТЕЛЕФОНЕ
//
//  Тот же интерфейс, что у настольного electron/vault.js — методы,
//  которых ждёт core/api.js: readJson, writeJson, saveImage, history,
//  versionAt. Благодаря этому вся логика Fictaris (модули, экспорт,
//  корзина, история версий) работает на телефоне тем же core/api.js,
//  без второй копии маршрутов и без риска, что два приложения разойдутся
//  в поведении — тот же приём, что у TasteID (mobile/src/vault.js).
//
//  Под ним не node:fs, а файловая система телефона через Capacitor.
//  Папка — Documents/Fictaris внутри данных приложения. Записи через
//  временный файл с переименованием здесь нет (Capacitor не обещает
//  атомарности поверх SAF на Android), зато .history пишется ДО
//  перезаписи, так что прошлая версия уже лежит рядом, даже если
//  запись оборвётся на середине.
// ══════════════════════════════════════════════

import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { isAllowedFile, historyDate, historyToPrune, newestHistoryTime, HISTORY_MIN_INTERVAL_MS, KNOWN_FILE_NAMES } from "../../core/files.js";

const DIR = Directory.Data;

// Первый проект живёт прямо в Fictaris/ — так у него самый короткий
// путь, а он и есть тот, что создаётся автоматически при первом
// запуске (на телефоне нет диалога выбора папки). Проекты, заведённые
// позже, получают отдельную подпапку Fictaris/vaults/<id>/.
function vaultDir(vaultId) {
  return vaultId && vaultId !== "default" ? `Fictaris/vaults/${vaultId}` : "Fictaris";
}

async function ensureDir(path) {
  try {
    await Filesystem.mkdir({ path, directory: DIR, recursive: true });
  } catch {
    // уже существует — не ошибка
  }
}

async function exists(path) {
  try {
    await Filesystem.stat({ path, directory: DIR });
    return true;
  } catch {
    return false;
  }
}

export class MobileVault {
  constructor(vaultId) {
    this.vaultId = vaultId || "default";
    this.root = vaultDir(this.vaultId);
    // Электронная версия хранит абсолютный путь в vault.root и его же
    // показывает в интерфейсе (например, "Открыть папку"); на телефоне
    // это не путь на диске, а просто метка — используется только для
    // отладочного вывода, если он вообще где-то встретится.
  }

  path(name) {
    return `${this.root}/${name}`;
  }

  async ensure() {
    await ensureDir(this.root);
    await ensureDir(`${this.root}/.history`);
    await ensureDir(`${this.root}/maps`);
  }

  async readJson(name, fallback) {
    if (!isAllowedFile(name)) throw new Error(`Неизвестный файл: ${name}`);
    try {
      const { data } = await Filesystem.readFile({ path: this.path(name), directory: DIR, encoding: Encoding.UTF8 });
      return JSON.parse(data);
    } catch (e) {
      if (e instanceof SyntaxError) {
        throw new Error(`Файл ${name} испорчен (не JSON).`);
      }
      // Файла нет — не поломка, а первый запуск. Но если файл есть, а
      // прочитать его не вышло (ошибка ввода-вывода), пустое значение
      // по умолчанию при следующем сохранении затёрло бы данные — пусть
      // лучше раздел не откроется (app/js/api.js не даст в него писать).
      if (await exists(this.path(name))) throw new Error(`Не удалось прочитать ${name}: ${e?.message || e}`);
      return fallback;
    }
  }

  // Записи идут строго по очереди, как на компьютере (inQueue в
  // electron/main.js): два сохранения одного файла с долгим архивированием
  // иначе могли закончиться в обратном порядке, и на диске оставалось старое.
  writeJson(name, data, options) {
    const run = () => this.#writeJson(name, data, options);
    const result = this.#queue.then(run, run);
    this.#queue = result.then(() => {}, () => {});
    return result;
  }

  #queue = Promise.resolve();

  async #writeJson(name, data, { forceArchive = false } = {}) {
    if (!isAllowedFile(name)) throw new Error(`Неизвестный файл: ${name}`);
    await this.ensure();
    const body = JSON.stringify(data, null, 2) + "\n";
    const previous = await this.#readRaw(name);
    if (previous === body) return data; // ничего не изменилось
    if (previous !== null) await this.#archive(name, previous, forceArchive);
    await Filesystem.writeFile({ path: this.path(name), directory: DIR, data: body, encoding: Encoding.UTF8 });
    return data;
  }

  async #readRaw(name) {
    try {
      const res = await Filesystem.readFile({ path: this.path(name), directory: DIR, encoding: Encoding.UTF8 });
      return res.data;
    } catch {
      return null;
    }
  }

  async snapshotAll() {
    for (const name of KNOWN_FILE_NAMES) {
      const previous = await this.#readRaw(name);
      if (previous !== null) await this.#archive(name, previous, true);
    }
  }

  async #archive(name, previous, force) {
    const dir = `${this.root}/.history/${name}`;
    await ensureDir(dir);
    const listed = await Filesystem.readdir({ path: dir, directory: DIR }).catch(() => ({ files: [] }));
    const existing = listed.files.map((f) => (typeof f === "string" ? f : f.name));
    if (!force && Date.now() - newestHistoryTime(existing) < HISTORY_MIN_INTERVAL_MS) return;

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    let slot = `${dir}/${stamp}.json`;
    for (let n = 1; n < 1000; n++) {
      if (!(await exists(slot))) break;
      slot = `${dir}/${stamp}-${n}.json`;
    }
    await Filesystem.writeFile({ path: slot, directory: DIR, data: previous, encoding: Encoding.UTF8 });

    const { files } = await Filesystem.readdir({ path: dir, directory: DIR });
    const names = files.map((f) => (typeof f === "string" ? f : f.name));
    for (const old of historyToPrune(names)) {
      await Filesystem.deleteFile({ path: `${dir}/${old}`, directory: DIR }).catch(() => {});
    }
  }

  async history(name) {
    if (!isAllowedFile(name)) throw new Error(`Неизвестный файл: ${name}`);
    const dir = `${this.root}/.history/${name}`;
    let files;
    try {
      ({ files } = await Filesystem.readdir({ path: dir, directory: DIR }));
    } catch {
      return [];
    }
    return files
      .map((f) => f.name)
      .filter((n) => n.endsWith(".json"))
      .sort()
      .reverse()
      .map((n) => ({ id: n.replace(/\.json$/, ""), date: historyDate(n) }));
  }

  async versionAt(name, id) {
    if (!isAllowedFile(name)) throw new Error(`Неизвестный файл: ${name}`);
    if (!/^[\w-]{1,48}$/.test(id)) throw new Error("Неизвестная версия");
    const { data } = await Filesystem.readFile({
      path: `${this.root}/.history/${name}/${id}.json`,
      directory: DIR,
      encoding: Encoding.UTF8,
    });
    return JSON.parse(data);
  }

  async deleteVersion(name, id) {
    if (!isAllowedFile(name)) throw new Error(`Неизвестный файл: ${name}`);
    if (!/^[\w-]{1,48}$/.test(id)) throw new Error("Неизвестная версия");
    await Filesystem.deleteFile({ path: `${this.root}/.history/${name}/${id}.json`, directory: DIR }).catch(() => {});
  }

  async cleanupHistory(maxAgeDays) {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const root = `${this.root}/.history`;
    let dirs;
    try {
      ({ files: dirs } = await Filesystem.readdir({ path: root, directory: DIR }));
    } catch {
      return 0;
    }
    let removed = 0;
    for (const dirent of dirs) {
      if (dirent.type !== "directory") continue;
      const dir = `${root}/${dirent.name}`;
      let files;
      try {
        ({ files } = await Filesystem.readdir({ path: dir, directory: DIR }));
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.name.endsWith(".json")) continue;
        const t = new Date(historyDate(f.name)).getTime();
        if (Number.isFinite(t) && t < cutoff) {
          await Filesystem.deleteFile({ path: `${dir}/${f.name}`, directory: DIR }).catch(() => {});
          removed++;
        }
      }
    }
    return removed;
  }

  // base64 приходит уже сжатым с клиента (compressImage через <canvas>,
  // см. app/js/image-compress.js) — тот же путь, что на компьютере,
  // только запись идёт через Capacitor, а не node:fs.
  async saveImage(filename, base64) {
    await ensureDir(`${this.root}/maps`);
    const safeName = filename.replace(/[/\\:*?"<>|\x00-\x1f]/g, "_").slice(-80);
    const path = `${this.root}/maps/${safeName}`;
    await Filesystem.writeFile({ path, directory: DIR, data: base64 });
    return `maps/${safeName}`;
  }

  // Для резервной копии/синхронизации (app/js/sync.js) — та же папка
  // maps/, но по конкретному относительному пути.
  #imagePath(relPath) {
    const clean = String(relPath).replace(/^\/+/, "");
    if (!clean.startsWith("maps/") || clean.includes("..")) {
      throw new Error(`Недопустимый путь изображения: ${relPath}`);
    }
    return clean;
  }

  async listImages() {
    let files;
    try {
      ({ files } = await Filesystem.readdir({ path: `${this.root}/maps`, directory: DIR }));
    } catch {
      return [];
    }
    return files.map((f) => (typeof f === "string" ? f : f.name)).map((n) => `maps/${n}`);
  }

  async readImage(relPath) {
    const { data } = await Filesystem.readFile({ path: `${this.root}/${this.#imagePath(relPath)}`, directory: DIR });
    return data;
  }

  async writeImage(relPath, base64) {
    await ensureDir(`${this.root}/maps`);
    await Filesystem.writeFile({ path: `${this.root}/${this.#imagePath(relPath)}`, directory: DIR, data: base64 });
  }

  // Удаление проекта на телефоне — настоящее стирание файлов, а не
  // снятие записи с полки: заново открыть отвязанную папку тут нечем,
  // проводника нет (см. комментарий у remove-vault в mobile/src/main.js).
  async remove() {
    await Filesystem.rmdir({ path: this.root, directory: DIR, recursive: true }).catch(() => {});
  }
}
