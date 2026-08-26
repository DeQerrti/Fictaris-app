// Словарь ru → en для i18n.js. Ключ — русская строка как она стоит в
// вызове i18n(...) по коду, значение — перевод. Отсутствующий ключ не
// ошибка — i18n() тогда просто вернёт русский текст как есть.
//
// v1 переводит оболочку приложения (навигация, настройки, данные,
// поиск, первый запуск, уведомления об обновлении, экран приветствия)
// — формы внутри модулей (Персонажи/Локации/Таймлайн и т.д.) пока
// остаются на русском, это следующий заход.
export const EN_DICT = {
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
