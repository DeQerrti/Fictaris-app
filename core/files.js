// ══════════════════════════════════════════════
//  ПРАВИЛА ИМЁН ФАЙЛОВ ХРАНИЛИЩА
//
//  Список того, что вообще можно читать/писать в vault — общий контракт
//  между electron/vault.js и core/api.js, чтобы маршруты API не могли
//  случайно тронуть файл, который vault не ждёт.
// ══════════════════════════════════════════════

const KNOWN_FILES = new Set([
  "characters.json",
  "manuscript.json",
  "locations.json",
  "relationships.json",
  "timeline.json",
  "board.json",
  "factions.json",
  "map.json",
  "canvas.json",
  "trash.json",
  "site-settings.json",
  "writing-log.json",
  "plot.json",
  "knowledge.json",
]);

export const KNOWN_FILE_NAMES = [...KNOWN_FILES];

export function isAllowedFile(name) {
  return KNOWN_FILES.has(name);
}

// Имя файла версии в .history — это её же дата с заменёнными на дефисы
// двоеточиями/точками (см. #archive в vault.js); здесь — обратное
// превращение назад в ISO-строку, чтобы список версий показывал дату,
// а не сырое имя файла.
export function historyDate(fileName) {
  const stamp = fileName.replace(/\.json$/, "").replace(/-\d+$/, "");
  return stamp.replace(/-(\d{2})-(\d{2})-(\d{3})Z$/, ":$1:$2.$3Z");
}

// ── Сколько версий хранить в .history ──
// Раньше — последние 50 копий на файл, а копия делалась при каждом
// автосохранении: за несколько минут набора текста история рукописи
// целиком состояла из почти одинаковых версий, и вчерашняя пропадала.
// Теперь копия делается не чаще раза в HISTORY_MIN_INTERVAL_MS (кроме
// восстановления и импорта — там всегда), а старые прореживаются по
// времени: всё за последний час, по одной на час за сутки, по одной на
// день за месяц и по одной на неделю дальше (пока их не уберёт
// автоочистка из Настроек). Из каждого промежутка остаётся самая новая.
export const HISTORY_MIN_INTERVAL_MS = 2 * 60 * 1000;

export function historyTime(fileName) {
  return new Date(historyDate(fileName)).getTime();
}

export function historyToPrune(fileNames, now = Date.now()) {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  const items = fileNames
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ f, t: historyTime(f) }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => b.t - a.t);
  const seen = new Set();
  const drop = [];
  for (const { f, t } of items) {
    const age = now - t;
    if (age < HOUR) continue;
    const key = age < DAY ? `h${Math.floor(t / HOUR)}` : age < 30 * DAY ? `d${Math.floor(t / DAY)}` : `w${Math.floor(t / (7 * DAY))}`;
    if (seen.has(key)) drop.push(f);
    else seen.add(key);
  }
  return drop;
}

// Самая свежая версия в списке — чтобы не делать новую копию чаще
// HISTORY_MIN_INTERVAL_MS.
export function newestHistoryTime(fileNames) {
  let newest = -Infinity;
  for (const f of fileNames) {
    if (!f.endsWith(".json")) continue;
    const t = historyTime(f);
    if (Number.isFinite(t) && t > newest) newest = t;
  }
  return newest;
}
