// Словарь ru → en для i18n.js. Ключ — русская строка как она стоит в
// вызове i18n(...) по коду, значение — перевод. Отсутствующий ключ не
// ошибка — i18n() тогда просто вернёт русский текст как есть.
//
// v1 переводит оболочку приложения (навигация, настройки, данные,
// поиск, первый запуск, уведомления об обновлении, экран приветствия)
// — формы внутри модулей (Персонажи/Локации/Таймлайн и т.д.) пока
// остаются на русском, это следующий заход.
export const EN_DICT = {
  // ── Персонажи (characters.js) ──
  "Роль": "Role",
  "Возраст": "Age",
  "Внешность": "Appearance",
  "Характер": "Personality",
  "Мотивация": "Motivation",
  "Цель": "Goal",
  "Слабости": "Flaws",
  "Предыстория": "Backstory",
  "Новый персонаж": "New character",
  "глава": "leader",
  "{label} (карта «{name}»)": "{label} (map “{name}”)",
  "Связи": "Relationships",
  "Карточки доски": "Board cards",
  "Метки на карте": "Map pins",
  "Персонажей пока нет — добавь первого.": "No characters yet — add the first one.",
  "Без имени": "Unnamed",
  "+ Добавить персонажа": "+ Add character",
  "Родители": "Parents",
  "Закрыть": "Close",
  "Удалить": "Delete",

  // ── Локации (locations.js + icons.js LOCATION_TYPES) ──
  "Описание": "Description",
  "Заметки": "Notes",
  "Новая локация": "New location",
  "{name} (штаб-квартира)": "{name} (headquarters)",
  "Локаций пока нет — добавь первую.": "No locations yet — add the first one.",
  "+ Добавить локацию": "+ Add location",
  "Тип": "Type",
  "Город / поселение": "City / settlement",
  "Подземелье / руины": "Dungeon / ruins",
  "Опасность": "Danger",
  "Сокровище / находка": "Treasure / find",
  "Другое": "Other",

  // ── Фракции (factions.js + icons.js FACTION_TYPES) ──
  "Новая фракция": "New faction",
  "Фракций пока нет — добавь первую.": "No factions yet — add the first one.",
  "+ Добавить фракцию": "+ Add faction",
  "Глава фракции": "Leader",
  "Не назначен": "Unassigned",
  "Штаб-квартира": "Headquarters",
  "Не указана": "Not set",
  "Состав": "Members",
  "Описание / идеология": "Description / ideology",
  "Орден / гильдия": "Order / guild",
  "Монархия": "Monarchy",
  "Культ": "Cult",
  "Военная организация": "Military organization",
  "Синдикат": "Syndicate",

  // ── Связи (relationships.js) ──
  "Нужно как минимум два персонажа, чтобы связать их между собой.":
    "You need at least two characters to connect them.",
  "+ Добавить связь": "+ Add relationship",
  "Метка (наставник, вражда…)": "Label (mentor, rivalry…)",
  "Заметка о связи…": "Note about the relationship…",

  // ── Таймлайн (timeline.js + png-export.js) ──
  "Новое событие": "New event",
  "таймлайн": "timeline",
  "доска": "board",
  "карта": "map",
  "{shown} из {total} событий": "{shown} of {total} events",
  "Нет событий с таким фильтром.": "No events match this filter.",
  "Событий пока нет — добавь первое.": "No events yet — add the first one.",
  "+ Событие": "+ Event",
  "Дата": "Date",
  "например: год 214, день третий": "e.g.: year 214, third day",
  "Экспорт в PNG": "Export to PNG",
  "Готовим…": "Preparing…",
  "Нечего экспортировать": "Nothing to export",
  "Не удалось загрузить html2canvas": "Failed to load html2canvas",

  // ── Доска (board.js) ──
  "Задумано": "Idea",
  "В работе": "In progress",
  "Готово": "Done",
  "+ Колонка": "+ Column",
  "Новая колонка": "New column",
  "Шаблон структуры…": "Structure template…",
  "Применить": "Apply",
  "Заменит все колонки. Точно?": "This will replace all columns. Sure?",
  "Три акта": "Three acts",
  "Завязка": "Setup",
  "Развитие": "Confrontation",
  "Развязка": "Resolution",
  "Путь героя": "Hero's journey",
  "Обычный мир": "Ordinary world",
  "Зов к приключению": "Call to adventure",
  "Испытания": "Trials",
  "Кризис": "Crisis",
  "Награда": "Reward",
  "Возвращение": "Return",
  "Удалить колонку": "Delete column",
  "Точно?": "Sure?",
  "+ Карточка": "+ Card",
  "Новая карточка": "New card",
  "Без метки": "No label",
  "Без персонажа": "No character",

  // ── Карта (map.js) ──
  "Карт пока нет — загрузи изображение, чтобы создать первую.": "No maps yet — upload an image to create the first one.",
  "{n} меток": "{n} pins",
  "Удалить карту со всеми вложенными под-картами": "Delete map along with all nested sub-maps",
  "Удалит карту со всем вложенным. Точно?": "This will delete the map with everything nested inside. Sure?",
  "+ Новая карта": "+ New map",
  "Новая карта": "New map",
  "У этой под-карты пока нет изображения.": "This sub-map has no image yet.",
  "← Все карты": "← All maps",
  "Новая метка": "New pin",
  "Заметка": "Note",
  "Не привязан": "Not linked",
  "Не привязана": "Not linked",
  "Под-карта": "Sub-map",
  "Открыть под-карту →": "Open sub-map →",
  "Удалить под-карту": "Delete sub-map",
  "Точно? Со всем вложенным": "Sure? Everything nested too",
  "+ Создать под-карту": "+ Create sub-map",
  "Удалить метку": "Delete pin",

  // ── Граф (graph.js) ──
  "Добавь персонажей, локаций или фракций, чтобы увидеть граф проекта.":
    "Add characters, locations or factions to see the project graph.",
  "Локации/фракции — цвет по типу": "Locations/factions — colored by type",

  // ── Проверка (continuity.js) ──
  "Связь «{label}» ссылается на несуществующего персонажа": "The relationship “{label}” refers to a character that doesn't exist",
  "Фракция «{name}» — глава не найден": "Faction “{name}” — leader not found",
  "Фракция «{name}» — штаб-квартира не найдена": "Faction “{name}” — headquarters not found",
  "Фракция «{name}» — в составе несуществующий персонаж": "Faction “{name}” has a member that doesn't exist",
  "Событие «{title}» ссылается на несуществующего персонажа": "Event “{title}” refers to a character that doesn't exist",
  "Событие «{title}» ссылается на несуществующую локацию": "Event “{title}” refers to a location that doesn't exist",
  "Карточка доски «{title}» ссылается на несуществующего персонажа": "Board card “{title}” refers to a character that doesn't exist",
  "Метка «{label}» на карте «{name}» ссылается на несуществующего персонажа": "Pin “{label}” on map “{name}” refers to a character that doesn't exist",
  "Метка «{label}» на карте «{name}» ссылается на несуществующую локацию": "Pin “{label}” on map “{name}” refers to a location that doesn't exist",
  "Метка «{label}» на карте «{name}» ссылается на несуществующую под-карту": "Pin “{label}” on map “{name}” refers to a sub-map that doesn't exist",
  "Персонаж «{name}» нигде не упомянут — ни в связях, ни в таймлайне, ни во фракциях":
    "Character “{name}” isn't mentioned anywhere — not in relationships, the timeline, or factions",
  "Локация «{name}» нигде не упомянута": "Location “{name}” isn't mentioned anywhere",
  "без даты": "no date",
  "Возможный дубль на таймлайне: «{title}» ({date})": "Possible timeline duplicate: “{title}” ({date})",
  "Глава «{title}» помечена «Готово», но текст пуст": "Chapter “{title}” is marked “Done” but has no text",
  "Битые ссылки": "Broken references",
  "Забытые сущности": "Forgotten entities",
  "Возможные дубли на таймлайне": "Possible timeline duplicates",
  "Главы «Готово» с пустым текстом": "“Done” chapters with no text",
  "Всё чисто — проверка не нашла проблем.": "All clear — the check found no issues.",

  // ── Корзина (trash.js) ──
  "Связь": "Relationship",
  "Событие таймлайна": "Timeline event",
  "Карточка доски": "Board card",
  "Восстановлено": "Restored",
  "Корзина пуста.": "Trash is empty.",
  "Удалить навсегда": "Delete permanently",

  // ── Рукопись (manuscript.js) ──
  "Черновик": "Draft",
  "На редактуре": "In editing",
  "Новая глава": "New chapter",
  "+ Глава": "+ Chapter",
  "Экспорт в .md": "Export to .md",
  "Экспорт в .docx": "Export to .docx",
  "Выбери или создай главу.": "Pick or create a chapter.",
  "Правка": "Edit",
  "Просмотр": "Preview",
  "Выйти из фокус-режима (Esc)": "Exit focus mode (Esc)",
  "Фокус-режим — скрыть сайдбар и список глав": "Focus mode — hide the sidebar and chapter list",
  "Снимок": "Snapshot",
  "Сохранить текущий текст как снимок версии (до 20 на главу)": "Save the current text as a version snapshot (up to 20 per chapter)",
  "{count} слов · всего {total}": "{count} words · {total} total",
  "Глава пуста.": "The chapter is empty.",
  "Пиши здесь… @имя вставит упоминание персонажа": "Write here… @name inserts a character mention",
  "📌 Стикер": "📌 Sticky note",
  "Вставить инлайн-заметку в текст": "Insert an inline note into the text",
  "Заметки автора": "Author's notes",
  "Не входит в текст главы и в экспорт.": "Not included in the chapter text or the export.",
  "Стикеры ({n})": "Sticky notes ({n})",
  "Текст заметки…": "Note text…",
  "Удалить стикер (маркер [[note:…]] в тексте останется как обычный текст)":
    "Delete sticky note (the [[note:…]] marker in the text stays as plain text)",
  "Снимки версий ({n})": "Version snapshots ({n})",
  "Пока нет снимков — кнопка «Снимок» в шапке главы сохранит текущий текст.":
    "No snapshots yet — the “Snapshot” button in the chapter header will save the current text.",
  "Заменит текущий текст. Точно?": "This will replace the current text. Sure?",

  // ── Переключатель проектов (project-switcher.js) ──
  "Название проекта": "Project name",
  "Создать": "Create",
  "Переименовать": "Rename",
  "Удалить проект вместе с файлами — это необратимо": "Delete the project along with its files — this cannot be undone",
  "Убрать из списка (файлы на диске не трогает)": "Remove from the list (leaves the files on disk untouched)",
  "+ Новый проект…": "+ New project…",
  "+ Другой проект…": "+ Another project…",
  "Проект": "Project",

  // ── Общие виджеты (chips.js, reverse-links.js) ──
  "пока нет": "none yet",
  "Где ещё упоминается": "Also mentioned in",

  // ── Изображения (image-compress.js) ──
  "Не удалось прочитать файл": "Failed to read the file",
  "Не удалось прочитать изображение": "Failed to read the image",

  // ── Родословная (family-tree.js) ──
  "Пока пусто — укажи родителей в карточке персонажа, чтобы здесь появилось дерево.":
    "Nothing here yet — set parents on a character card to see the tree appear.",

  // ── Календарь (calendar.js) ──
  "Месяц {n}": "Month {n}",

  // ── Экспорт .docx (docx.js) ──
  // "Без названия" уже определено выше (search.js)

  // ── Генератор имён (name-generator.js) ──
  "Сгенерировать имя": "Generate a name",

  // ── Статистика (stats.js) ──
  "Пока нечего показать.": "Nothing to show yet.",
  "Обзор": "Overview",
  "персонажей": "characters",
  "локаций": "locations",
  "фракций": "factions",
  "событий": "events",
  "карточек на доске": "board cards",
  "глав": "chapters",
  "слов написано": "words written",
  "Без фракции": "No faction",
  "Персонажи по фракциям": "Characters by faction",
  "Слова по главам": "Words by chapter",
  "Чаще всего в таймлайне": "Most frequent in the timeline",
  "Сколько раз персонаж указан участником события — топ-8.": "How many times a character is listed as an event participant — top 8.",

  // ── Словарь тегов (tags.js DEFAULT_TAGS_MAP) ──
  // Ключи словаря (сами имена тегов) остаются на русском — это
  // хранимые данные (c.tags/l.tags/f.tags), а не только текст экрана,
  // и не должны меняться при смене языка интерфейса. Здесь переводится
  // только то, что показывается пользователю: имя тега и подсказка.
  "Свои": "Custom",
  "Свой тег — Enter, чтобы добавить": "Custom tag — press Enter to add",

  "Герой": "Hero",
  "Центральная фигура, ведёт историю вперёд": "The central figure, drives the story forward",
  "Наставник": "Mentor",
  "Направляет и обучает героя": "Guides and trains the hero",
  "Трикстер": "Trickster",
  "Хаотичный, ломает правила ради своих целей": "Chaotic, breaks the rules for their own ends",
  "Страж порога": "Threshold guardian",
  "Первое препятствие на пути героя": "The hero's first obstacle",
  "Тень": "Shadow",
  "Воплощение того, чего герой боится в себе": "Embodiment of what the hero fears in themselves",
  "Союзник": "Ally",
  "Поддерживает героя в пути": "Supports the hero on their journey",
  "Оборотень (сюжетный)": "Shapeshifter (plot)",
  "Меняет сторону, скрывает истинные мотивы": "Switches sides, hides their true motives",

  "Протагонист": "Protagonist",
  "Главный герой истории": "The main character of the story",
  "Антагонист": "Antagonist",
  "Главный противник героя": "The hero's main opponent",
  "Второстепенный": "Supporting",
  "Важен для сюжета, но не в центре": "Matters to the plot, but not central to it",
  "Массовка": "Background",
  "Заполняет мир, не влияет на сюжет напрямую": "Populates the world, doesn't directly affect the plot",
  "Рассказчик": "Narrator",
  "Ведёт повествование от своего лица": "Tells the story from their own perspective",

  "Жив": "Alive",
  "Погиб": "Deceased",
  "Пропал без вести": "Missing",
  "Статус неизвестен": "Status unknown",
  "Заброшено": "Abandoned",
  "Про локацию или фракцию — больше не действует": "For a location or faction — no longer active",

  "Проклятие": "Curse",
  "Пророчество": "Prophecy",
  "Тайная личность": "Secret identity",
  "Искупление": "Redemption",
  "Предательство": "Betrayal",
  "Запретная любовь": "Forbidden love",
  "Месть": "Revenge",
  "Наследие": "Legacy",
  "Груз прошлого — рода, титула, преступления предков": "A burden of the past — of lineage, title, or ancestors' crimes",
  "Двойная жизнь": "Double life",
  "Договор с силой": "Pact with a power",
  "Сделка с богом, демоном или магией — не без цены": "A deal with a god, demon, or magic — not without a price",

  // ── Сохранение (save-badge.js) ──
  "Сохранение…": "Saving…",
  "Сохранено": "Saved",

  // ── Синхронизация — ошибки (sync.js) ──
  "Не получилось достучаться до GitHub — проверь соединение с интернетом.":
    "Couldn't reach GitHub — check your internet connection.",
  "GitHub не принял токен — проверь, что он не истёк и не отозван.":
    "GitHub rejected the token — check that it hasn't expired or been revoked.",
  "GitHub временно ограничил число запросов — попробуй через несколько минут.":
    "GitHub has temporarily rate-limited requests — try again in a few minutes.",
  "У токена не хватает прав на этот репозиторий.": "The token doesn't have enough permissions for this repository.",
  "Не получилось проверить токен.": "Couldn't verify the token.",
  "Не получилось проверить репозиторий.": "Couldn't verify the repository.",
  "Не получилось создать репозиторий.": "Couldn't create the repository.",
  "Не получилось прочитать файл из репозитория: {path}": "Couldn't read the file from the repository: {path}",
  "Не получилось отправить файл: {path}": "Couldn't upload the file: {path}",

  // ── Сайдбар / навигация (labels.js) ──
  "Рукопись": "Manuscript",
  "Персонажи": "Characters",
  "Локации": "Locations",
  "Связи": "Relationships",
  "Фракции": "Factions",
  "Таймлайн": "Timeline",
  "Доска": "Board",
  "Карта": "Map",
  "Граф": "Graph",
  "Родословная": "Family tree",
  "Статистика": "Statistics",
  "Проверка": "Checks",
  "Корзина": "Trash",
  "⚙ Настройки": "⚙ Settings",
  "Данные": "Data",

  // ── Поиск (search.js) ──
  "🔍 Поиск": "🔍 Search",
  "Персонажи, локации, фракции, таймлайн, рукопись…": "Characters, locations, factions, timeline, manuscript…",
  "Ничего не найдено": "Nothing found",
  "Без названия": "Untitled",
  "Персонаж": "Character",
  "Локация": "Location",
  "Фракция": "Faction",
  "Событие": "Event",
  "Глава": "Chapter",
  "Карточка": "Card",

  // ── Первый запуск (onboarding.js) ──
  "Добро пожаловать в Fictaris": "Welcome to Fictaris",
  "<b>Поиск</b> — клавиша <kbd>/</kbd> или кнопка в сайдбаре ищет сразу по всем модулям.":
    "<b>Search</b> — the <kbd>/</kbd> key or the sidebar button searches across every module at once.",
  "<b>⚙ Настройки</b> — тема, акцент, подписи меню, горячие клавиши, синхронизация между устройствами.":
    "<b>⚙ Settings</b> — theme, accent color, menu labels, keyboard shortcuts, sync between devices.",
  "<b>«Данные» → «Заполнить примером»</b> — связный тестовый сюжет, чтобы сразу увидеть, как модули работают вместе.":
    "<b>“Data” → “Fill with example”</b> — a connected sample story so you can see right away how the modules work together.",
  "Заполнить примером": "Fill with example",
  "Понятно, дальше сам": "Got it, I'll explore",

  // ── Обновления (update-banner.js) ──
  "Перезапустить": "Restart",
  "Скачать": "Download",
  "Позже": "Later",
  "Обновление готово: {version}": "Update ready: {version}",
  "Доступно обновление: {version}": "Update available: {version}",

  // ── Настройки (settings-panel.js) ──
  "Обновления": "Updates",
  "Обновление {version} скачано — перезапусти, чтобы установить.": "Update {version} downloaded — restart to install.",
  "Не удалось скачать обновление: {message}": "Couldn't download the update: {message}",
  "О приложении": "About",
  "Репозиторий на GitHub": "GitHub repository",
  "Сообщить о проблеме": "Report an issue",
  "Все версии": "All releases",
  "Проверить обновления": "Check for updates",
  "Проверяю…": "Checking…",
  "Не удалось проверить обновления.": "Couldn't check for updates.",
  "У тебя последняя версия.": "You're on the latest version.",
  "Скачивается обновление {version}…": "Downloading update {version}…",
  "Доступно обновление {version}.": "Update {version} is available.",
  "Установленная версия: {version}": "Installed version: {version}",
  "Инструмент для писателей и мастеров миров: данные лежат обычной папкой на твоём диске, без своего сервера и без привязки к аккаунту.":
    "A tool for writers and worldbuilders: your data lives as a plain folder on your disk, with no server of its own and no account required.",
  "Не удалось проверить обновления — нет сети или GitHub недоступен.": "Couldn't check for updates — no network or GitHub is unavailable.",
  "Проверка недоступна в режиме разработки (npm start).": "Not available in development mode (npm start).",

  "Оформление": "Appearance",
  "Тема и акцентный цвет — применяются сразу, без перезагрузки.": "Theme and accent color — applied instantly, no reload.",
  "Тёмная": "Dark",
  "Стол писателя ночью": "A writer's desk at night",
  "Пергамент": "Parchment",
  "Тёплая бумага": "Warm paper",
  "Акцентный цвет: ": "Accent color: ",
  "Сбросить акцент": "Reset accent",

  "Язык": "Language",
  "Язык интерфейса — применяется сразу после перезагрузки страницы. Общий на проект: открыв его с другого устройства через синхронизацию, увидишь тот же язык.":
    "Interface language — applied right after the page reloads. Shared per project: opening it on another device via sync shows the same language.",
  "Русский": "Russian",
  "English": "English",

  "Редактор": "Editor",
  "Размер шрифта в тексте главы.": "Font size for chapter text.",

  "Подписи интерфейса": "Interface labels",
  "Переименуй пункты меню под свою терминологию — применяется сразу, без перезагрузки.":
    "Rename menu items to match your own terminology — applied instantly, no reload.",
  "Название приложения": "App name",
  "Сбросить все подписи": "Reset all labels",

  "Горячие клавиши": "Keyboard shortcuts",
  "Цифры 1–9 переключают модули по порядку в сайдбаре. Любой модуль можно назначить на свою клавишу — она сработает независимо от позиции в списке.":
    "Digits 1–9 switch modules in sidebar order. Any module can be bound to its own key — it'll keep working regardless of position in the list.",
  "Сбросить на клавишу по умолчанию": "Reset to the default key",
  "Нажми клавишу…": "Press a key…",

  "Теги": "Tags",
  "Спрячь ненужный встроенный тег или добавь свой — оба применяются сразу во всех модулях.":
    "Hide a built-in tag you don't need, or add your own — both apply instantly across all modules.",
  "Архетип": "Archetype",
  "Роль в сюжете": "Story role",
  "Статус": "Status",
  "Троп": "Trope",
  "Название тега": "Tag name",
  "Добавить тег": "Add tag",
  " (своя)": " (custom)",
  "Вернуть": "Restore",
  "Спрятать": "Hide",

  "Календарь": "Calendar",
  "Своё летоисчисление для таймлайна — свои месяцы вместо реальных, произвольная длина года.":
    "Your own calendar for the timeline — custom month names instead of real ones, any year length.",
  "Отключить свой календарь": "Turn off custom calendar",
  "Включить свой календарь": "Turn on custom calendar",
  "Название года": "Year label",
  "год": "year",
  "Добавить месяц": "Add month",
  "Убрать месяц": "Remove month",
  "дней": "days",

  "Синхронизация": "Sync",
  "Свободно и без своего сервера: приватный репозиторий на GitHub как общее хранилище для всех твоих устройств — телефона, компьютера, ещё одного компьютера. Токен и служебные данные синхронизации остаются только на этом устройстве.":
    "Free, no server of your own: a private GitHub repository as shared storage for all your devices — phone, computer, another computer. The token and sync bookkeeping stay only on this device.",
  "Заведи аккаунт на github.com, если его ещё нет — бесплатно.": "Create a github.com account if you don't have one yet — it's free.",
  "Создай токен доступа —": "Create an access token —",
  "по этой ссылке": "this link",
  "галочка «repo» уже отмечена. Внизу страницы — «Generate token».": "the “repo” checkbox is pre-selected. At the bottom of the page — “Generate token”.",
  "Скопируй токен (показывается один раз) и вставь сюда.": "Copy the token (shown only once) and paste it here.",
  "Токен доступа": "Access token",
  "Название репозитория": "Repository name",
  "Если такого репозитория ещё нет на твоём GitHub — создадим сами, приватным. Если уже есть (например, второе устройство его уже завело) — подключимся к нему.":
    "If this repository doesn't exist on your GitHub yet, we'll create it as private. If it already exists (say, another device set it up) — we'll connect to it.",
  "Подключить": "Connect",
  "Заполни токен и название репозитория.": "Fill in the token and the repository name.",
  "Проверяем токен…": "Checking the token…",
  "Проверяем репозиторий…": "Checking the repository…",
  "Репозитория ещё нет — создаём…": "Repository doesn't exist yet — creating…",
  "Синхронизировать сейчас": "Sync now",
  "Отключить": "Disconnect",
  "Точно отключить?": "Really disconnect?",
  "Синхронизируем…": "Syncing…",
  "Оставить моё": "Keep mine",
  "Взять оттуда": "Take theirs",
  "ещё не было": "never yet",
  "Подключено к": "Connected to",
  "Последняя синхронизация: {when}.": "Last sync: {when}.",
  "Готово, но {n} файл(ов) изменились и здесь, и в репозитории — выбери, что оставить.":
    "Done, but {n} file(s) changed both here and in the repository — pick what to keep.",
  "Готово: отправлено {pushed}, забрано {pulled}, без изменений {skipped}.":
    "Done: pushed {pushed}, pulled {pulled}, unchanged {skipped}.",

  // ── Данные (data-panel.js) ──
  "Экспорт проекта": "Export project",
  "Один JSON-файл со всеми модулями: персонажи, локации, связи, фракции, таймлайн, доска, карта (только метки — картинки остаются файлами на диске), рукопись.":
    "One JSON file with every module: characters, locations, relationships, factions, timeline, board, map (labels only — images stay as files on disk), manuscript.",
  "Экспортировать": "Export",

  "Импорт проекта": "Import project",
  "Полностью заменяет текущие данные содержимым файла. Сохрани экспорт перед импортом, если сомневаешься — отменить нельзя.":
    "Completely replaces current data with the file's contents. Save an export before importing if unsure — this can't be undone.",
  "Импортировать…": "Import…",
  "Файл повреждён или это не JSON.": "The file is corrupted or isn't JSON.",
  "Заменить все текущие данные содержимым файла?": "Replace all current data with this file's contents?",
  "Да, заменить": "Yes, replace",
  "Отмена": "Cancel",

  "Заполнить примером": "Fill with example",
  "Связный тестовый сюжет — персонажи, локации, связи, фракции, таймлайн, доска и две главы рукописи, чтобы сразу увидеть, как модули работают вместе.":
    "A connected sample story — characters, locations, relationships, factions, timeline, board and two manuscript chapters, so you can see right away how the modules work together.",
  "Текущие данные будут заменены примером. Продолжить?": "Current data will be replaced with the example. Continue?",

  "История версий": "Version history",
  "Каждое сохранение оставляет прошлую версию файла в папке": "Every save keeps the previous version of the file in the",
  "Выбери модуль, чтобы увидеть его версии.": "Pick a module to see its versions.",
  "Выбери модуль…": "Pick a module…",
  "Пока нет прошлых версий — история появляется со второго сохранения.": "No past versions yet — history starts from the second save.",
  "Восстановить": "Restore",
  "Заменит текущую версию. Точно?": "This will replace the current version. Sure?",
  "Заполнить примером…": "Fill with example…",
};
