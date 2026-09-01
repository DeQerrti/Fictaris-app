// ══════════════════════════════════════════════
//  ХРАНИЛИЩЕ — папка с файлами на диске
//
//  Как у Obsidian: не база, а обычная папка. Устроено по образцу
//  TasteID (electron/vault.js) — запись через временный файл и rename
//  (атомарно на одной файловой системе), плюс .history на каждую
//  перезапись, чтобы неудачный импорт или случайное стирание главы
//  можно было откатить руками из папки.
// ══════════════════════════════════════════════

import { promises as fs } from "node:fs";
import path from "node:path";
import { isAllowedFile, historyDate } from "../core/files.js";

const HISTORY_LIMIT = 50;
let writeCounter = 0;

export class Vault {
  constructor(root) {
    this.root = root;
  }

  file(name) {
    if (!isAllowedFile(name)) throw new Error(`Неизвестный файл: ${name}`);
    return path.join(this.root, name);
  }

  async ensure() {
    await fs.mkdir(this.root, { recursive: true });
    await fs.mkdir(path.join(this.root, ".history"), { recursive: true });
  }

  // Отсутствующий файл — не поломка, а первый запуск.
  async readJson(name, fallback) {
    try {
      const raw = await fs.readFile(this.file(name), "utf8");
      return JSON.parse(raw);
    } catch (e) {
      if (e.code === "ENOENT") return fallback;
      if (e instanceof SyntaxError) {
        throw new Error(
          `Файл ${name} испорчен и не читается. Загляни в .history — там лежат прошлые версии.`
        );
      }
      throw e;
    }
  }

  async writeJson(name, data) {
    await this.ensure();
    const target = this.file(name);
    await this.#archive(name, target);

    const body = JSON.stringify(data, null, 2) + "\n";
    const tmp = `${target}.${process.pid}.${Date.now().toString(36)}${(writeCounter++).toString(36)}.tmp`;
    try {
      await fs.writeFile(tmp, body, "utf8");
      await fs.rename(tmp, target);
    } catch (e) {
      await fs.rm(tmp, { force: true });
      throw e;
    }
    return data;
  }

  async #archive(name, target) {
    let previous;
    try {
      previous = await fs.readFile(target);
    } catch {
      return; // первого сохранения архивировать нечего
    }
    const dir = path.join(this.root, ".history", name);
    await fs.mkdir(dir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    let slot = path.join(dir, `${stamp}.json`);
    for (let n = 1; n < 1000; n++) {
      try {
        await fs.writeFile(slot, previous, { flag: "wx" });
        break;
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
        slot = path.join(dir, `${stamp}-${n}.json`);
      }
    }

    const kept = (await fs.readdir(dir)).sort();
    for (const old of kept.slice(0, Math.max(0, kept.length - HISTORY_LIMIT))) {
      await fs.rm(path.join(dir, old), { force: true });
    }
  }

  // Список версий файла в .history — новые сначала. Имя версии и есть
  // дата (см. #archive), отдельного stat() не нужно.
  async history(name) {
    if (!isAllowedFile(name)) throw new Error(`Неизвестный файл: ${name}`);
    const dir = path.join(this.root, ".history", name);
    let entries;
    try {
      entries = await fs.readdir(dir);
    } catch {
      return [];
    }
    return entries
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse()
      .map((f) => ({ id: f.replace(/\.json$/, ""), date: historyDate(f) }));
  }

  async versionAt(name, id) {
    if (!isAllowedFile(name)) throw new Error(`Неизвестный файл: ${name}`);
    if (!/^[\w-]{1,48}$/.test(id)) throw new Error("Неизвестная версия");
    const raw = await fs.readFile(path.join(this.root, ".history", name, `${id}.json`), "utf8");
    return JSON.parse(raw);
  }

  async deleteVersion(name, id) {
    if (!isAllowedFile(name)) throw new Error(`Неизвестный файл: ${name}`);
    if (!/^[\w-]{1,48}$/.test(id)) throw new Error("Неизвестная версия");
    await fs.rm(path.join(this.root, ".history", name, `${id}.json`), { force: true });
  }

  // Автоочистка (Настройки → Данные): удаляет снимки старше maxAgeDays
  // сразу во всех модулях, а не только в открытом сейчас в витрине —
  // человек выбирает период один раз (site-settings.json), а не гоняет
  // очистку по каждому файлу отдельно.
  async cleanupHistory(maxAgeDays) {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const root = path.join(this.root, ".history");
    let dirs;
    try {
      dirs = await fs.readdir(root, { withFileTypes: true });
    } catch {
      return 0;
    }
    let removed = 0;
    for (const dirent of dirs) {
      if (!dirent.isDirectory()) continue;
      const dir = path.join(root, dirent.name);
      const files = await fs.readdir(dir).catch(() => []);
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const t = new Date(historyDate(f)).getTime();
        if (Number.isFinite(t) && t < cutoff) {
          await fs.rm(path.join(dir, f), { force: true });
          removed++;
        }
      }
    }
    return removed;
  }

  // Изображения карты — отдельные файлы в maps/, а не base64 внутри
  // map.json: то самое, от чего предостерегал бриф (window.storage
  // упирался в лимит 5MB на ключ именно потому, что все картинки
  // одного модуля бандлились в один JSON-блоб). На файловой системе
  // лимита нет, но привычка хранить бинарные данные файлами, а не
  // строками в JSON, всё равно правильная — сам map.json остаётся
  // маленьким и читаемым.
  async saveImage(filename, base64) {
    const dir = path.join(this.root, "maps");
    await fs.mkdir(dir, { recursive: true });
    const safeName = filename.replace(/[/\\:*?"<>|\x00-\x1f]/g, "_").slice(-80);
    await fs.writeFile(path.join(dir, safeName), Buffer.from(base64, "base64"));
    return `maps/${safeName}`;
  }

  // Для резервной копии/синхронизации (app/js/sync.js) — та же папка
  // maps/, но по конкретному относительному пути, а не с новым
  // сгенерированным именем, как в saveImage выше.
  #imagePath(relPath) {
    const clean = String(relPath).replace(/^\/+/, "");
    if (!clean.startsWith("maps/") || clean.includes("..")) {
      throw new Error(`Недопустимый путь изображения: ${relPath}`);
    }
    return path.join(this.root, clean);
  }

  async listImages() {
    let entries;
    try {
      entries = await fs.readdir(path.join(this.root, "maps"));
    } catch {
      return [];
    }
    return entries.filter((f) => !f.startsWith(".")).map((f) => `maps/${f}`);
  }

  async readImage(relPath) {
    const buf = await fs.readFile(this.#imagePath(relPath));
    return buf.toString("base64");
  }

  async writeImage(relPath, base64) {
    const target = this.#imagePath(relPath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.from(base64, "base64"));
  }
}
