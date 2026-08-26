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
]);

export function isAllowedFile(name) {
  return KNOWN_FILES.has(name);
}
