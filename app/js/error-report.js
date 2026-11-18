// ══════════════════════════════════════════════
//  ОШИБКИ СТРАНИЦЫ → ЖУРНАЛ
//
//  Необработанные ошибки и отказы промисов на странице уходят в журнал
//  приложения (electron/log.js, POST /api/app/log), а последние из них
//  держатся и здесь — для «Скопировать сведения для отчёта» (на телефоне
//  журнала-файла нет, там отчёт собирается только отсюда).
// ══════════════════════════════════════════════

const recent = [];
let sentThisMinute = 0;
setInterval(() => (sentThisMinute = 0), 60000);

function record(message, stack) {
  const line = `${new Date().toISOString()} ${String(message).slice(0, 500)}`;
  recent.push(stack ? `${line}\n  ${String(stack).slice(0, 1500).replace(/\n/g, "\n  ")}` : line);
  if (recent.length > 30) recent.shift();
  // Не больше 20 записей в минуту — зациклившаяся ошибка не должна
  // забить журнал и диск.
  if (++sentThisMinute > 20) return;
  fetch("/api/app/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: String(message), stack: stack ? String(stack) : "" }),
  }).catch(() => {});
}

export function initErrorReport() {
  window.addEventListener("error", (e) => record(e.message || "Ошибка", e.error?.stack || `${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) => record(e.reason?.message || String(e.reason), e.reason?.stack));
}

// Текст для отчёта об ошибке: версия, система, журнал. Без данных проекта.
export async function buildReport() {
  let info = {};
  try {
    info = await (await fetch("/api/app/report")).json();
  } catch {
    // на телефоне маршрута нет — соберём из того, что есть здесь
  }
  const lines = [
    `Fictaris ${info.version || ""}`.trim(),
    `Система: ${info.platform || navigator.userAgent}`,
    info.electron ? `Electron: ${info.electron}` : "",
    `Язык интерфейса: ${document.documentElement.lang}`,
    "",
    "Журнал:",
    info.log || recent.join("\n") || "(ошибок не записано)",
  ];
  return lines.filter((l, i) => l !== "" || i === 4).join("\n");
}
