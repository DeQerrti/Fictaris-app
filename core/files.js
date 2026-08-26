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
  "trash.json",
  "site-settings.json",
]);

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
