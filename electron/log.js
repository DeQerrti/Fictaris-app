// ══════════════════════════════════════════════
//  ЖУРНАЛ ОШИБОК
//
//  Раньше при сбое не оставалось ничего: ни автор, ни человек не знали,
//  что случилось. Теперь ошибки главного процесса и страницы пишутся в
//  fictaris.log в папке журналов приложения (app.getPath("logs")), а
//  «Настройки → О приложении → Скопировать сведения для отчёта» кладёт
//  в буфер версию, систему и хвост журнала — их можно вставить в issue.
//  Тексты глав и данные проекта в журнал не попадают — только сообщения
//  об ошибках.
// ══════════════════════════════════════════════

import { promises as fs } from "node:fs";
import path from "node:path";

const MAX_BYTES = 512 * 1024; // больше — старое уходит в fictaris.old.log
let file = null;
let queue = Promise.resolve();

export function initLog(dir) {
  file = path.join(dir, "fictaris.log");
}

export function logFilePath() {
  return file;
}

function clip(s, n = 4000) {
  s = String(s ?? "");
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function logError(source, message, stack) {
  if (!file) return;
  const line = `${new Date().toISOString()} [${source}] ${clip(message, 1000)}${stack ? `\n  ${clip(stack).replace(/\n/g, "\n  ")}` : ""}\n`;
  queue = queue
    .then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const st = await fs.stat(file).catch(() => null);
      if (st && st.size > MAX_BYTES) await fs.rename(file, file.replace(/\.log$/, ".old.log")).catch(() => {});
      await fs.appendFile(file, line, "utf8");
    })
    .catch(() => {});
  return queue;
}

export async function logTail(maxLines = 60) {
  if (!file) return "";
  const text = await fs.readFile(file, "utf8").catch(() => "");
  return text.split("\n").slice(-maxLines - 1).join("\n").trim();
}
