// ══════════════════════════════════════════════
//  СЛЕЖЕНИЕ ЗА ПАПКОЙ ПРОЕКТА
//
//  Как у Obsidian: файлы проекта можно править снаружи — руками в
//  редакторе или через Claude, — и открытое приложение должно это
//  подхватить, а не затереть следующим автосохранением из памяти.
//
//  fs.watch шумный: одна запись даёт несколько событий, атомарная
//  запись через rename — ещё пару, а собственные записи vault.js
//  приходят сюда же. Поэтому события копятся и разбираются пачкой
//  после паузы, а решает не событие, а содержимое: файл, совпадающий
//  с vault.known (последнее, что приложение само записало или уже
//  показало), — не новость.
// ══════════════════════════════════════════════

import { watch, promises as fs } from "node:fs";
import path from "node:path";
import { isAllowedFile } from "../core/files.js";

const SETTLE_MS = 300;

export function watchVault(vault, onChange) {
  const pending = new Set();
  let timer = null;
  let closed = false;

  async function flush() {
    timer = null;
    const names = [...pending];
    pending.clear();
    const changed = [];
    for (const name of names) {
      let raw = null;
      try {
        raw = await fs.readFile(path.join(vault.root, name), "utf8");
      } catch (e) {
        if (e.code !== "ENOENT") continue;
      }
      if (raw !== null) {
        // Недописанный файл (внешний редактор пишет не атомарно) — ждём
        // следующего события, когда запись закончится.
        try {
          JSON.parse(raw);
        } catch {
          continue;
        }
      }
      if ((vault.known.get(name) ?? null) === raw) continue;
      vault.known.set(name, raw);
      changed.push(name);
    }
    if (changed.length && !closed) onChange(changed);
  }

  let watcher;
  try {
    watcher = watch(vault.root, (_event, name) => {
      if (!name || !isAllowedFile(name)) return;
      pending.add(name);
      clearTimeout(timer);
      timer = setTimeout(flush, SETTLE_MS);
    });
  } catch {
    return () => {}; // папка недоступна — работаем как раньше, без слежения
  }
  watcher.on("error", () => {});

  return () => {
    closed = true;
    clearTimeout(timer);
    watcher.close();
  };
}
