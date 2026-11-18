import { sanitizeVaultData } from "./sanitize.js";

// Файлы, которые не удалось прочитать (испорченный JSON и т.п.), — путь
// API → текст ошибки. Пока файл в этом списке, запись в него запрещена:
// раньше ответ {error} уходил в код раздела как данные, раздел подставлял
// пустые значения и при первом же сохранении затирал файл пустым. Список
// очищается, как только файл снова прочитался (например, после отката
// версии в Настройки → Данные → История).
const brokenFiles = new Map();

function apiKey(path) {
  return path.split("?")[0];
}

export function brokenFileError(path) {
  return brokenFiles.get(apiKey(path)) || null;
}

export async function apiGet(path) {
  const res = await fetch(path);
  const data = await res.json();
  const key = apiKey(path);
  if (!res.ok) {
    const message = data?.error || `HTTP ${res.status}`;
    // Файлы данных — это /api/<имя> (characters, board, site-settings…);
    // служебные /api/app/*, /api/history/* и т.п. ничего не записывают.
    if (/^\/api\/[a-z-]+$/.test(key) && !brokenFiles.has(key)) {
      brokenFiles.set(key, message);
      document.dispatchEvent(new CustomEvent("fictaris:file-broken", { detail: { path: key, error: message } }));
    }
    throw new Error(message);
  }
  brokenFiles.delete(key);
  const file = /^\/api\/([a-z-]+)$/.exec(key);
  return file ? sanitizeVaultData(file[1], data) : data;
}

// Сколько записей ушло с начала работы страницы — по нему entity-modal.js
// понимает, правили ли что-то в окне карточки.
let postCount = 0;
export function postCounter() {
  return postCount;
}

// После записи — событие: сайдбар (sidebar-overview.js) пересчитывает
// счётчики, не зная, какой модуль что сохранил.
export async function apiPost(path, body) {
  const broken = brokenFiles.get(apiKey(path));
  if (broken) throw new Error(broken);
  postCount++;
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  document.dispatchEvent(new CustomEvent("fictaris:data-changed", { detail: { path } }));
  return data;
}

export function uid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
