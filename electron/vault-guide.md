<!-- fictaris-guide v2 – файл создан приложением Fictaris и обновляется им. Чтобы оставить свою версию, удалите эту строку. -->
# Проект Fictaris – как править файлы

Эта папка – проект писательского приложения Fictaris: персонажи, локации, главы рукописи и т.д., по одному JSON-файлу на раздел. Файлы можно править напрямую – открытое приложение заметит изменение и перечитает данные. Если в приложении в этот момент есть несохранённые правки, оно спросит, чью версию оставить.

## Общие правила

- **JSON должен оставаться валидным.** Каждый файл записывайте целиком (UTF-8, отступ 2 пробела). Недописанный или битый файл приложение не подхватит.
- **`id` – стабильные и уникальные строки.** Не меняйте id существующих записей: на них ссылаются другие файлы. Для новых записей – любая уникальная строка из `[a-z0-9-]`, приложение само делает так: `Date.now().toString(36)` + 6 случайных символов base36.
- **Неизвестные поля не удаляйте.** Если поле не описано ниже, оставьте его как есть.
- **Ссылки – только по id.** При удалении записи уберите ссылки на неё из других файлов (см. «Что ссылается на что»).
- **Порядок в массивах – это порядок в интерфейсе** (главы, персонажи, колонки и т.д.).
- **Тексты для читателя – с коротким тире «–»**, не длинным «—».
- Не трогайте `.history/` (автоматические копии прошлых версий – из них можно откатиться) и `maps/` (картинки; в JSON хранятся только относительные пути вида `maps/xxx.jpg`).
- `site-settings.json` – настройки вида приложения на этом устройстве, `writing-log.json` – дневник слов, `trash.json` – корзина, `plot.json` – устаревший файл. Их без просьбы человека не правьте.

## Файлы

### characters.json – персонажи
Массив объектов.
- `id`, `name` – обязательны.
- `color` – `#rrggbb`, цвет карточки.
- `templateId` – id шаблона анкеты (`"default"`, если не уверены). Шаблоны лежат в `site-settings.json` → `templates.characters[]` (`fields[]: {key, label, type: "input"|"textarea"}`); значение поля анкеты хранится прямо в персонаже под ключом `key`. Стандартные ключи: `role`, `age`, `appearance`, `personality`, `motivation`, `goal`, `flaws`, `backstory` – строки.
- `tags` – **строка** через запятую: `"протагонист, изгнанница"`.
- `gender` – `"male"` | `"female"` или нет поля. Нужен Родословной, чтобы писать «отец», «сестра», а не «родитель», «брат или сестра».
- `parentIds: string[]` – родители (id персонажей). Подмножества `parentIds`, не пересекаются: `adoptiveParentIds` – приёмные, `uncertainParentIds` – предполагаемые (отцовство под вопросом, тайна).
- `partnerIds: string[]` – пары. **Симметрично**: если у A есть B, у B должен быть A.
- `partnerKinds: { [id партнёра]: вид }` – вид пары: `"betrothed"` (помолвлены), `"lover"` (любовники), `"divorced"` (в разводе). Нет записи – в браке. **Тоже симметрично**, у обоих одинаково.
- Внебрачность нигде не хранится: ребёнок внебрачный, если его кровные родители не в браке друг с другом.
- `images: string[]` – пути к картинкам в `maps/`; первая – аватарка.

### locations.json – локации
Массив. `id`, `name`, `type` (`settlement` | `dungeon` | `danger` | `treasure` | `other`), `description`, `notes`, `tags` (строка через запятую), `parentId` – id родительской локации или `null` (вложенность без циклов), `templateId`, `images`.

### factions.json – фракции
Массив. `id`, `name`, `type` (`order` | `monarchy` | `cult` | `military` | `syndicate` | `other`), `description`, `notes`, `tags`, `leaderId` (персонаж или `null`), `headquartersId` (локация или `null`), `memberIds: string[]` (персонажи), `templateId`, `images`.

### relationships.json – связи между персонажами
Массив. `id`, `charA`, `charB` (id персонажей), `label` – как назвать связь («наставник»), `score` – число от −100 (вражда) до 100 (близость), `note`.

### manuscript.json – рукопись
```
{ "chapters": [...], "folders": [...], "activeChapterId": "id главы" | null }
```
Глава: `id`, `title`, `content`, `status` (`draft` | `editing` | `done` или ключ из `site-settings.json` → `chapterStatuses`), `folderId` (папка или `null`), `notes: [{id, text}]` – заметки автора, `stickies: [{id, text}]`, `snapshots: [{id, content, savedAt}]` – сохранённые версии текста (не трогайте).

В старых проектах вместо `notes` бывает строка `authorNotes`, а `folders` нет вовсе – приложение переведёт их само при открытии рукописи; новые главы пишите сразу в новом виде.

Текст главы `content` – **простой текст**, не HTML и не Markdown. Абзацы разделяются переводом строки. Внутри поддерживается:
- форматирование: `**жирный**`, `*курсив*`, `~~зачёркнутый~~`, `==выделение==`, `<u>подчёркнутый</u>`;
- упоминания персонажей: `@Имя` или `@[Имя|как в тексте]` (для падежей: `@[Надя|Наде]`). Слева от `|` – **точное** `name` персонажа;
- стикеры: `[[note:n1]]` – ссылка на `stickies[].id` той же главы.

Папка: `id`, `name`, `parentId` (папка или `null`), `status`, `collapsed`.

### timeline.json – таймлайн
Массив событий. `id`, `order` – число, по нему события стоят на шкале, `date` – свободный текст («год 214, весна»), `title`, `description`, `characterIds: string[]`, `locationIds: string[]`.

### board.json – доски (канбан)
```
{ "boards": [ { "id", "name", "columns": [{id, title}], "cards": { "<id>": card }, "cardOrder": { "<columnId>": ["<cardId>", ...] } } ], "activeBoardId": "..." }
```
Карточка: `id`, `title`, `notes`, `characterId`, `factionId`, `locationId`, `chapterId` (каждое – id или `null`), `labelColor` (`#rrggbb` или `null`). Каждая карточка должна быть и в `cards`, и ровно в одном списке `cardOrder`. Старый формат одной доски (`{columns, cards, cardOrder}` без обёртки) тоже читается.

### canvas.json – холсты
```
{ "order": ["<canvasId>", ...], "canvases": { "<id>": { "id", "name", "cards": [...], "edges": [...] } } }
```
Карточка: `id`, `x`, `y`, `w`, `h` (пиксели), `title`, `text`, `chapterId` (глава или `null`), `color` (`#rrggbb` или `null`). Стрелка: `id`, `fromId`, `toId` (id карточек того же холста), `label`.

### map.json – карты
```
{ "rootIds": ["<mapId>", ...], "maps": { "<id>": { "id", "name", "imageRelPath": "maps/...", "pins": [...] } } }
```
Метка: `id`, `x`, `y` – **проценты** (0–100) от ширины/высоты картинки, `label`, `note`, `characterId`, `locationId`, `linkedMapId` (переход на вложенную карту из `maps`) – id или `null`. `rootIds` – карты верхнего уровня.

### knowledge.json – кто что знает
```
{ "facts": [ { "id", "label", "note", "entries": { "<characterId>": "<chapterId>" | "__start__" } } ] }
```
`entries` – с какой главы персонаж знает факт; `"__start__"` – знает с самого начала.

## Что ссылается на что

Удаляя или объединяя запись, почистите ссылки:
- **персонаж** – `characters[].parentIds/adoptiveParentIds/uncertainParentIds/partnerIds`, ключи `partnerKinds`, `relationships[].charA/charB` (связь удалить целиком), `factions[].leaderId/memberIds`, `timeline[].characterIds`, `board` → `cards[].characterId`, `map` → `pins[].characterId`, ключи `knowledge.facts[].entries`, упоминания `@Имя` в тексте глав. **Переименование персонажа ломает упоминания** – замените `@Старое имя` в `content` глав.
- **локация** – `locations[].parentId`, `factions[].headquartersId`, `timeline[].locationIds`, карточки досок, метки карт.
- **фракция** – карточки досок (`factionId`).
- **глава** – `canvas` → `cards[].chapterId`, карточки досок (`chapterId`), значения `knowledge.facts[].entries`, `manuscript.activeChapterId`.
