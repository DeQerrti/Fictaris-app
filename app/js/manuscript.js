import { apiGet, apiPost, uid } from "./api.js";
import { debounceSave } from "./save-badge.js";
import { mentionsToHtml, attachMentionAutocomplete, attachMentionHoverPreview, buildMentionContextMenuItems, findMentionedIds } from "./mentions.js";
import { stickersToHtml, attachStickyPopover } from "./stickies.js";
import { buildManuscriptDocx } from "./docx.js";
import { exportChaptersPdf } from "./export-pdf.js";
import { openContextMenu, openPopover, closeMenu } from "./context-menu.js";
import { loadStatuses, buildStatusDot, buildStatusManagePanel } from "./chapter-status.js";
import { pushTrash } from "./trash.js";
import { iconSvg, locationTypeInfo } from "./icons.js";
import { applyInlineMarkupHtml } from "./text-format.js";
import { recordToday, loadWritingLog, computeStats } from "./writing-goal.js";
import { openEntityModal } from "./entity-modal.js";
import { i18n, i18nPlural } from "./i18n.js";
import { escapeHtml, buildEmptyState } from "./chips.js";
import { avatarInnerHtml } from "./avatars.js";

// Список статусов — настраиваемый (chapter-status.js; править —
// "Статус" → "Управлять статусами…" по ПКМ на главе/папке), общий для
// глав и папок; читается заново при каждом открытии вкладки в
// renderManuscript.
let statuses = [];

// Размер шрифта текста главы — раньше жил в Настройках, отдельно от
// того, что вообще-то настраивает («Настройки → Редактор» и сама глава,
// которую читаешь, — не одно и то же место). Переехал в шапку
// редактора: применяется через ту же CSS-переменную --editor-font-size
// на :root (theme.js читает её при загрузке приложения, здесь — только
// при живом изменении), значение по-прежнему общее на всё приложение,
// не per-глава — сохраняется в site-settings.json, как и было.
const FONT_SIZE_PRESETS = [12, 14, 15, 16, 17, 18, 20, 22, 24, 28, 32];
const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 72;
const DEFAULT_FONT_SIZE = 17;
let editorFontSize = DEFAULT_FONT_SIZE;

let manuscript = { chapters: [], activeChapterId: null };
let characters = [];
let locations = [];
let viewMode = false;
let focusMode = false;
let container = null;
let currentTextarea = null; // поле открытой главы — на него действуют кнопки панели инструментов

// Режим вкладки («Текст» / «Обзор») и открыта ли панель главы — выбор
// этого устройства, не мира: localStorage, а не manuscript.json.
const PREFS_KEY = "fictaris_manuscript";
function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}
function writePrefs(patch) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readPrefs(), ...patch }));
  } catch {
    // приватное окно и т.п. — просто не запомнится
  }
}
let mode = readPrefs().mode === "overview" ? "overview" : "text";
let inspectorOpen = readPrefs().inspector !== false;
const save = debounceSave((data) => apiPost("/api/manuscript", data));

function persist() {
  save(manuscript);
  // Серия дней (Статистика → Писательская серия) — снимок суммарной
  // длины рукописи на сегодня, своей debounce-очередью внутри
  // writing-goal.js, отдельной от сохранения самой рукописи выше.
  recordToday(manuscript);
}

const SNAPSHOT_LIMIT = 20;

function blankChapter(folderId = null) {
  return { id: uid(), title: i18n("Новая глава"), content: "", status: statuses[0]?.key || "draft", notes: [], stickies: [], snapshots: [], folderId, bookId: manuscript.activeBookId };
}

// Раньше в главе была одна общая заметка автора (authorNotes, строка) —
// теперь заметок можно завести сколько нужно (notes: [{id, text}], как
// у стикеров). Старые главы переводятся в новый вид при каждом открытии
// вкладки: одна заметка, если старое поле было не пустым, иначе пусто.
function migrateChapterNotes(chapter) {
  if (Array.isArray(chapter.notes)) return;
  chapter.notes = chapter.authorNotes ? [{ id: uid(), text: chapter.authorNotes }] : [];
  delete chapter.authorNotes;
}

function blankFolder(parentId = null) {
  return { id: uid(), name: i18n("Новая папка"), status: null, parentId, collapsed: false, bookId: manuscript.activeBookId };
}

function folderParent(folder) {
  return folder.parentId || null;
}

// id папки и всех вложенных в неё подпапок разом, любой глубины.
function collectFolderIds(folderId) {
  const ids = new Set([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of manuscript.folders) {
      if (ids.has(folderParent(f)) && !ids.has(f.id)) {
        ids.add(f.id);
        grew = true;
      }
    }
  }
  return ids;
}

// Все главы папки и вложенных в неё подпапок разом — экспорт папки
// должен захватывать всё дерево, а не только прямых детей.
function collectFolderChapters(folderId) {
  const ids = collectFolderIds(folderId);
  return manuscript.chapters.filter((c) => c.folderId && ids.has(c.folderId));
}

// Короткий id стикера в пределах главы — n1, n2… вместо длинного
// случайного uid(): маркер [[note:n3]] в сыром тексте короче и не
// выглядит мусором рядом с остальным текстом (было [[note:m3x9k2a1]]).
function nextStickyId(chapter) {
  const used = new Set((chapter.stickies || []).map((s) => s.id));
  let n = (chapter.stickies || []).length + 1;
  while (used.has(`n${n}`)) n++;
  return `n${n}`;
}

function wordCount(text) {
  const m = (text || "").trim().match(/\S+/g);
  return m ? m.length : 0;
}

function safeFileName(title) {
  return (title || i18n("Без названия")).replace(/[\\/:*?"<>|]/g, "").trim() || "chapter";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Заметки автора не входят — они и на сайте, и здесь предназначены для
// самого пишущего, а не для читателя итогового текста. chapters/filename —
// по умолчанию вся рукопись, но то же самое зовёт и экспорт одной главы
// через ПКМ на ней в списке (см. buildChapterList).
function exportMarkdown(chapters = manuscript.chapters, filename = "manuscript.md") {
  const body = chapters
    .map((ch) => `# ${ch.title || i18n("Без названия")}\n\n${ch.content || ""}`)
    .join("\n\n---\n\n");
  downloadBlob(new Blob([body], { type: "text/markdown" }), filename);
}

function exportDocx(chapters = manuscript.chapters, filename = "manuscript.docx") {
  const bytes = buildManuscriptDocx(chapters);
  downloadBlob(
    new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
    filename
  );
}

// В отличие от .md/.docx выше (готовый Blob сразу же), PDF собирает
// главный процесс Electron (см. export-pdf.js) — доступен только в
// десктопной версии, поэтому обёрнут в try/catch с тем же сообщением
// об ошибке, что и у "Экспортировать мир в PDF" в командной палитре
// (search.js) — то же самое ограничение, тот же текст.
async function exportPdfAction(chapters, title) {
  try {
    const res = await exportChaptersPdf(chapters, title, safeFileName(title));
    if (res && res.ok === false) return; // диалог сохранения отменили — не ошибка
  } catch (e) {
    alert(e.message || i18n("Не получилось создать PDF. Доступно только в десктопной версии Fictaris."));
  }
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && focusMode) {
    focusMode = false;
    draw();
  }
});

// Раньше вставка стикера просто роняла маркер в текст и ничего больше
// не показывала — со стороны выглядело как непонятный мусор в строке,
// без единого намёка, что это и как это заполнить. Теперь она же сразу
// открывает панель «Заметки и снимки» и ставит курсор в текстовое поле
// нового стикера — писать можно сразу, не разыскивая, куда делась
// только что вставленная заметка.
function insertSticky(textarea, chapter) {
  const sticky = { id: nextStickyId(chapter), text: "" };
  chapter.stickies = [...(chapter.stickies || []), sticky];
  const pos = textarea.selectionStart;
  const marker = `[[note:${sticky.id}]]`;
  textarea.value = textarea.value.slice(0, pos) + marker + textarea.value.slice(pos);
  chapter.content = textarea.value;
  inspectorOpen = true;
  focusMode = false;
  persist();
  draw();
  const area = container?.querySelector(`.sticky-editor-textarea[data-sticky-id="${sticky.id}"]`);
  area?.focus();
}

// Оборачивает выделение маркерами (**жирный**/*курсив*) — так же, как
// в текстовом редакторе Obsidian: если ничего не выделено, оборачивает
// пустую пару и ставит курсор внутрь, чтобы можно было сразу печатать.
function wrapSelection(textarea, before, after) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;
  const selected = value.slice(start, end);
  textarea.value = value.slice(0, start) + before + selected + after + value.slice(end);
  const cursor = start + before.length;
  textarea.selectionStart = cursor;
  textarea.selectionEnd = cursor + selected.length;
  textarea.focus();
  textarea.dispatchEvent(new Event("input"));
}

// Общая точка для смены размера шрифта — зовут и число в шапке
// редактора, и подменю правого клика (см. attachEditorContextMenu),
// чтобы оба места не разъезжались в логике сохранения/клампа.
async function setFontSize(size) {
  const clamped = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(size) || DEFAULT_FONT_SIZE));
  editorFontSize = clamped;
  document.documentElement.style.setProperty("--editor-font-size", `${clamped}px`);
  const s = (await apiGet("/api/site-settings").catch(() => ({}))) || {};
  await apiPost("/api/site-settings", { ...s, editorFontSize: clamped });
  return clamped;
}

// «Отметить как известный факт…» (ПКМ по тексту главы) — короткий путь
// к тому, что раньше требовало ухода на отдельную вкладку «Знания»
// (теперь модалка, см. кнопку «Знания» в меню «⋯» выше): не листать
// список фактов в поисках нужного, а прямо в момент, когда факт
// раскрывается в тексте, отметить его здесь же — с какой главы такой-то
// персонаж об этом знает. Название нового факта по умолчанию —
// выделенный текст (если есть), можно поправить перед сохранением.
async function openMarkFactPopover(x, y, chapter, selectedText) {
  const data = (await apiGet("/api/knowledge").catch(() => null)) || { facts: [] };
  const facts = Array.isArray(data.facts) ? data.facts : [];

  const wrap = document.createElement("div");
  wrap.className = "mark-fact-popover";

  const title = document.createElement("div");
  title.className = "mark-fact-popover-title";
  title.textContent = i18n("Отметить как известный факт");
  wrap.appendChild(title);

  const factField = document.createElement("div");
  factField.className = "field";
  const factLabel = document.createElement("label");
  factLabel.textContent = i18n("Факт");
  factField.appendChild(factLabel);
  const factSelect = document.createElement("select");
  const newOpt = document.createElement("option");
  newOpt.value = "__new__";
  newOpt.textContent = i18n("+ новый факт");
  factSelect.appendChild(newOpt);
  for (const f of facts) {
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = f.label || i18n("Без названия");
    factSelect.appendChild(opt);
  }
  factField.appendChild(factSelect);
  wrap.appendChild(factField);

  const newLabelInput = document.createElement("input");
  newLabelInput.type = "text";
  newLabelInput.placeholder = i18n("Название нового факта");
  newLabelInput.value = (selectedText || "").trim().slice(0, 60);
  wrap.appendChild(newLabelInput);
  function syncNewInputVisibility() {
    newLabelInput.hidden = factSelect.value !== "__new__";
  }
  factSelect.addEventListener("change", syncNewInputVisibility);
  syncNewInputVisibility();

  // Мультивыбор персонажей — той же фишкой-переключателем, что и
  // фильтры таймлайна: факт часто узнают разом несколько персонажей
  // одной сценой, отмечать это одно за другим было бы лишним трением.
  const charField = document.createElement("div");
  charField.className = "field";
  const charLabel = document.createElement("label");
  charLabel.textContent = i18n("Персонажи");
  charField.appendChild(charLabel);
  const charRow = document.createElement("div");
  charRow.className = "timeline-filter-bar";
  const selectedChars = new Set();
  for (const c of characters) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "filter-chip";
    chip.style.setProperty("--chip-color", c.color || "#7c7157");
    chip.textContent = c.name || i18n("Без имени");
    chip.addEventListener("click", () => {
      if (selectedChars.has(c.id)) {
        selectedChars.delete(c.id);
        chip.classList.remove("active");
      } else {
        selectedChars.add(c.id);
        chip.classList.add("active");
      }
    });
    charRow.appendChild(chip);
  }
  charField.appendChild(charRow);
  wrap.appendChild(charField);

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn";
  confirmBtn.textContent = i18n("Отметить с этой главы");
  confirmBtn.disabled = !characters.length;
  confirmBtn.addEventListener("click", async () => {
    if (!selectedChars.size) return;
    let fact;
    if (factSelect.value === "__new__") {
      const label = newLabelInput.value.trim();
      if (!label) return;
      fact = { id: uid(), label, note: "", entries: {} };
      facts.push(fact);
    } else {
      fact = facts.find((f) => f.id === factSelect.value);
      if (!fact) return;
    }
    const entries = { ...fact.entries };
    for (const charId of selectedChars) entries[charId] = chapter.id;
    fact.entries = entries;
    await apiPost("/api/knowledge", { facts });
    closeMenu();
  });
  wrap.appendChild(confirmBtn);

  openPopover(x, y, wrap, "mark-fact-popover-menu");
}

// Правый клик в тексте главы раньше не делал ничего — берём набор,
// привычный по Obsidian/Word: форматирование выделения, вставка стикера
// и счётчик слов у самого выделения (полезнее, чем общий по главе,
// который и так виден в шапке редактора).
function attachEditorContextMenu(textarea, chapter) {
  textarea.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const hasSelection = textarea.selectionStart !== textarea.selectionEnd;
    const selectedWords = hasSelection ? wordCount(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)) : 0;
    // Пункты "Добавить упоминание"/"Изменить отображаемый текст…" —
    // под слово/упоминание в точке клика (mentions.js). Здесь, а не
    // отдельным слушателем на этом же textarea: у поля уже есть один
    // contextmenu-обработчик (этот самый), второй независимый просто
    // закрыл бы меню первого через свой же openContextMenu.
    const mentionItems = buildMentionContextMenuItems(textarea, characters);
    openContextMenu(e.clientX, e.clientY, [
      ...(mentionItems.length ? [...mentionItems, { separator: true }] : []),
      {
        label: i18n("Форматирование"),
        // Тот же набор, что в панели форматирования Obsidian (жирный,
        // курсив, зачёркнутый, выделение) плюс подчёркивание — у
        // Markdown/Obsidian для него нет своего значка, но в Word и
        // Google Docs оно есть на том же правом клике, и как раз о нём
        // отдельно спросили. В режиме "Просмотр" (viewMode ниже,
        // text-format.js) все пять и правда становятся жирным/
        // курсивом/и т.д., а не остаются условными маркерами как текст —
        // и то же самое, тем же общим модулем, работает и в экспорте
        // (export-pdf.js/docx.js).
        items: [
          { label: i18n("Жирный"), disabled: !hasSelection, action: () => wrapSelection(textarea, "**", "**") },
          { label: i18n("Курсив"), disabled: !hasSelection, action: () => wrapSelection(textarea, "*", "*") },
          { label: i18n("Подчёркнутый"), disabled: !hasSelection, action: () => wrapSelection(textarea, "<u>", "</u>") },
          { label: i18n("Зачёркнутый"), disabled: !hasSelection, action: () => wrapSelection(textarea, "~~", "~~") },
          { label: i18n("Выделение цветом"), disabled: !hasSelection, action: () => wrapSelection(textarea, "==", "==") },
        ],
      },
      { separator: true },
      { label: i18n("Вставить стикер-заметку"), action: () => insertSticky(textarea, chapter) },
      {
        label: i18n("Отметить как известный факт…"),
        icon: "lightbulb",
        action: () => {
          const selected = hasSelection ? textarea.value.slice(textarea.selectionStart, textarea.selectionEnd) : "";
          openMarkFactPopover(e.clientX, e.clientY, chapter, selected);
        },
      },
      { separator: true },
      {
        label: i18n("Размер шрифта: {n}px", { n: editorFontSize }),
        items: FONT_SIZE_PRESETS.map((size) => ({
          label: `${size}px`,
          checked: size === editorFontSize,
          action: () => setFontSize(size),
        })),
      },
      { separator: true },
      { label: i18n("Вырезать"), disabled: !hasSelection, action: () => document.execCommand("cut") },
      { label: i18n("Копировать"), disabled: !hasSelection, action: () => document.execCommand("copy") },
      { label: i18n("Вставить"), action: () => document.execCommand("paste") },
      { label: i18n("Выделить всё"), action: () => textarea.select() },
      { separator: true },
      { label: hasSelection ? i18n("Слов выделено: {n}", { n: selectedWords }) : i18n("Слов в главе: {n}", { n: wordCount(chapter.content) }), disabled: true },
    ]);
  });
}

// Всплывающая панель "Управлять статусами…" (см. пункты меню статуса
// главы/папки выше) — тот же список-с-редактированием, что и в
// Настройках (chapter-status.js, buildStatusManagePanel), только
// открытый прямо в точке правого клика, а не через переход на другую
// вкладку. onSaved обновляет статусы этого модуля и перерисовывает
// список глав — сам попап остаётся открытым (он не часть этого дерева
// DOM, draw() его не трогает), можно править несколько статусов подряд.
function openStatusManagePopover(x, y) {
  const panel = buildStatusManagePanel(statuses, (next) => {
    statuses = next;
    draw();
  });
  openPopover(x, y, panel, "status-manage-popover");
}

export async function renderManuscript(root, focusChapterId) {
  container = root;
  focusMode = false; // модуль всегда открывается в обычном виде, фокус — временное состояние сессии просмотра
  const [manuscriptData, charactersData, locationsData, siteSettings, statusList] = await Promise.all([
    apiGet("/api/manuscript"),
    apiGet("/api/characters"),
    apiGet("/api/locations").catch(() => []),
    apiGet("/api/site-settings").catch(() => ({})),
    loadStatuses(),
  ]);
  manuscript = manuscriptData;
  manuscript.folders = manuscript.folders || []; // старые проекты сохранялись без папок
  for (const c of manuscript.chapters) migrateChapterNotes(c);
  ensureBooks();
  characters = charactersData;
  locations = Array.isArray(locationsData) ? locationsData : [];
  statuses = statusList;
  const savedSize = Number(siteSettings.editorFontSize);
  editorFontSize =
    Number.isFinite(savedSize) && savedSize >= FONT_SIZE_MIN && savedSize <= FONT_SIZE_MAX ? savedSize : DEFAULT_FONT_SIZE;
  if (!manuscript.chapters.length) {
    const c = blankChapter();
    manuscript.chapters = [c];
    manuscript.activeChapterId = c.id;
    persist();
  }
  const focused = focusChapterId && manuscript.chapters.find((c) => c.id === focusChapterId);
  if (focused) {
    // Переход к главе из другого раздела — сразу в её книгу и в «Текст».
    manuscript.activeBookId = focused.bookId;
    manuscript.activeChapterId = focused.id;
    mode = "text";
  } else if (!bookChapters().some((c) => c.id === manuscript.activeChapterId)) {
    manuscript.activeChapterId = bookChapters()[0]?.id || null;
  }
  draw();
}

function draw() {
  if (mode === "overview") focusMode = false;
  document.body.classList.toggle("focus-mode", focusMode);
  container.innerHTML = "";
  const view = document.createElement("div");
  view.className = "manuscript-view";

  const activeChapter = bookChapters().find((c) => c.id === manuscript.activeChapterId);
  if (activeChapter) activeBook().lastChapterId = activeChapter.id;

  if (mode === "overview") {
    view.appendChild(buildOverview());
  } else {
    if (!focusMode) view.appendChild(buildChapterList());
    view.appendChild(buildEditor());
    if (inspectorOpen && !focusMode && activeChapter) view.appendChild(buildInspector(activeChapter));
  }

  container.appendChild(view);
}

// ── Книги ─────────────────────────────────────
// Проект — это мир, а книг в нём сколько угодно: у каждой свои главы,
// папки-части и цель по словам, а персонажи, карты и таймлайн общие.
// manuscript.books [{id, title, goal, lastChapterId}], manuscript.activeBookId;
// у глав и папок — bookId. Старые рукописи (без книг) при первом открытии
// целиком становятся «Книгой 1» — ничего не теряется.
function blankBook(title) {
  return { id: uid(), title };
}

function ensureBooks() {
  if (!Array.isArray(manuscript.books) || !manuscript.books.length) manuscript.books = [blankBook(i18n("Книга 1"))];
  const ids = new Set(manuscript.books.map((b) => b.id));
  const first = manuscript.books[0].id;
  for (const c of manuscript.chapters) if (!ids.has(c.bookId)) c.bookId = first;
  for (const f of manuscript.folders) if (!ids.has(f.bookId)) f.bookId = first;
  if (!ids.has(manuscript.activeBookId)) manuscript.activeBookId = first;
}

function activeBook() {
  return manuscript.books.find((b) => b.id === manuscript.activeBookId) || manuscript.books[0];
}

function bookChapters() {
  return manuscript.chapters.filter((c) => c.bookId === manuscript.activeBookId);
}

function bookFolders() {
  return manuscript.folders.filter((f) => f.bookId === manuscript.activeBookId);
}

function selectBook(id) {
  manuscript.activeBookId = id;
  const book = activeBook();
  const chapters = bookChapters();
  manuscript.activeChapterId = chapters.some((c) => c.id === book.lastChapterId) ? book.lastChapterId : chapters[0]?.id || null;
  persist();
  draw();
}

// Короткий ввод прямо на месте (название книги, цель) — вместо
// window.prompt, которого в Electron нет.
function askText(x, y, { title, value = "", placeholder = "", type = "text" }, onOk) {
  const wrap = document.createElement("div");
  wrap.className = "ms-ask";
  const label = document.createElement("div");
  label.className = "mark-fact-popover-title";
  label.textContent = title;
  const input = document.createElement("input");
  input.type = type;
  input.value = value;
  input.placeholder = placeholder;
  const ok = document.createElement("button");
  ok.className = "btn accent";
  ok.textContent = i18n("Готово");
  const commit = () => {
    closeMenu();
    onOk(input.value.trim());
  };
  ok.addEventListener("click", commit);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); });
  wrap.append(label, input, ok);
  openPopover(x, y, wrap, "ms-ask-menu");
  setTimeout(() => { input.focus(); input.select(); }, 0);
}

function bookMenuItems(x, y) {
  const book = activeBook();
  const chapters = bookChapters();
  return [
    {
      label: i18n("Новая книга"),
      action: () => askText(x, y, { title: i18n("Название новой книги"), placeholder: i18n("Книга {n}", { n: manuscript.books.length + 1 }) }, (title) => {
        const b = blankBook(title || i18n("Книга {n}", { n: manuscript.books.length + 1 }));
        manuscript.books.push(b);
        const c = blankChapter();
        c.bookId = b.id;
        manuscript.chapters.push(c);
        manuscript.activeBookId = b.id;
        manuscript.activeChapterId = c.id;
        persist();
        draw();
      }),
    },
    {
      label: i18n("Переименовать книгу"),
      action: () => askText(x, y, { title: i18n("Название книги"), value: book.title }, (title) => {
        if (!title) return;
        book.title = title;
        persist();
        draw();
      }),
    },
    {
      label: i18n("Цель по словам…"),
      action: () => askText(x, y, { title: i18n("Сколько слов в книге – цель"), value: book.goal || "", placeholder: "80000", type: "number" }, (v) => {
        const n = Math.max(0, Math.round(Number(v) || 0));
        if (n) book.goal = n;
        else delete book.goal;
        persist();
        draw();
      }),
    },
    { separator: true },
    { label: i18n("Экспорт книги в .md"), action: () => exportMarkdown(chapters, `${safeFileName(book.title)}.md`) },
    { label: i18n("Экспорт книги в .pdf"), action: () => exportPdfAction(chapters, book.title) },
    { label: i18n("Экспорт книги в .docx"), action: () => exportDocx(chapters, `${safeFileName(book.title)}.docx`) },
    { separator: true },
    {
      label: i18n("Удалить книгу"),
      danger: true,
      disabled: manuscript.books.length < 2,
      action: () => openContextMenu(x, y, [
        { label: i18n("Точно удалить книгу «{title}» со всеми главами?", { title: book.title }), danger: true, action: () => deleteBook(book) },
      ]),
    },
  ];
}

// Главы удалённой книги — в корзину, как и при удалении папки.
async function deleteBook(book) {
  const doomed = manuscript.chapters.filter((c) => c.bookId === book.id);
  for (const c of doomed) await pushTrash("chapter", c);
  manuscript.chapters = manuscript.chapters.filter((c) => c.bookId !== book.id);
  manuscript.folders = manuscript.folders.filter((f) => f.bookId !== book.id);
  manuscript.books = manuscript.books.filter((b) => b.id !== book.id);
  selectBook(manuscript.books[0].id);
}

// Переключатель книги + меню управления — одинаковый в списке глав и в шапке «Обзора».
function buildBookSwitcher() {
  const wrap = document.createElement("div");
  wrap.className = "ms-book-switcher";
  const select = document.createElement("select");
  select.className = "ms-book-select";
  select.title = i18n("Книга");
  for (const b of manuscript.books) {
    const opt = document.createElement("option");
    opt.value = b.id;
    opt.textContent = b.title || i18n("Без названия");
    opt.selected = b.id === manuscript.activeBookId;
    select.appendChild(opt);
  }
  select.addEventListener("change", () => selectBook(select.value));
  const more = document.createElement("button");
  more.className = "btn icon-btn";
  more.innerHTML = iconSvg("more", 15);
  more.title = i18n("Книги");
  more.addEventListener("click", () => {
    const r = more.getBoundingClientRect();
    openContextMenu(r.left, r.bottom + 4, bookMenuItems(r.left, r.bottom + 4));
  });
  wrap.append(select, more);
  return wrap;
}

function bookWords() {
  return bookChapters().reduce((n, c) => n + wordCount(c.content), 0);
}

// Слова книги и, если задана, полоса прогресса к цели.
function buildBookProgress() {
  const book = activeBook();
  const total = bookWords();
  const wrap = document.createElement("div");
  wrap.className = "ms-book-progress";
  const line = document.createElement("div");
  line.className = "ms-book-progress-line";
  const left = document.createElement("span");
  left.textContent = i18nPlural(total, ["{n} слово", "{n} слова", "{n} слов"]);
  const right = document.createElement("button");
  right.className = "ms-link";
  right.textContent = book.goal ? i18n("цель {n}", { n: book.goal.toLocaleString() }) : i18n("задать цель");
  right.addEventListener("click", () => {
    const r = right.getBoundingClientRect();
    bookMenuItems(r.left, r.bottom + 4).find((i) => i.label === i18n("Цель по словам…")).action();
  });
  line.append(left, right);
  wrap.appendChild(line);
  if (book.goal) {
    const bar = document.createElement("div");
    bar.className = "ms-bar";
    bar.innerHTML = `<span style="width:${Math.min(100, (total / book.goal) * 100).toFixed(1)}%"></span>`;
    wrap.appendChild(bar);
  }
  return wrap;
}

// Кто в главе: упомянутые в тексте (@Имя) плюс добавленные вручную
// (chapter.characterIds) — без дублей, упомянутые первыми.
function chapterCast(ch) {
  const mentioned = findMentionedIds(ch.content || "", characters);
  const ids = [...mentioned, ...(ch.characterIds || []).filter((id) => !mentioned.has(id))];
  return ids.map((id) => ({ c: characters.find((x) => x.id === id), mentioned: mentioned.has(id) })).filter((x) => x.c);
}

function chapterPlaces(ch) {
  return (ch.locationIds || []).map((id) => locations.find((l) => l.id === id)).filter(Boolean);
}

function avatarHtml(c, size = 24) {
  const initial = escapeHtml((c.name || "?").trim().slice(0, 1).toUpperCase());
  return `<span class="ms-avatar" style="width:${size}px;height:${size}px;background:${c.color || "#7c7157"}" title="${escapeHtml(c.name || "")}">${avatarInnerHtml(c, `<span>${initial}</span>`)}</span>`;
}

function placeChipHtml(l) {
  const [, , icon, color] = locationTypeInfo(l.type);
  return `<span class="chip chip-place" style="--chip-color:${color}">${iconSvg(icon, 11)}${escapeHtml(l.name || i18n("Без имени"))}</span>`;
}

function statusOf(ch) {
  return statuses.find((s) => s.key === ch.status) || statuses[0];
}

function buildModeSwitch() {
  const switcher = document.createElement("div");
  switcher.className = "segmented";
  for (const [key, label, hint] of [
    ["text", "Текст", "Писать главу"],
    ["overview", "Обзор", "Вся книга карточками глав"],
  ]) {
    const btn = document.createElement("button");
    btn.className = "segmented-btn" + (mode === key ? " active" : "");
    btn.textContent = i18n(label);
    btn.title = i18n(hint);
    btn.addEventListener("click", () => {
      if (mode === key) return;
      mode = key;
      writePrefs({ mode });
      draw();
    });
    switcher.appendChild(btn);
  }
  return switcher;
}

// Перестановка главы перетаскиванием — и в списке, и в «Обзоре»: встаёт
// перед целевой и перенимает её папку.
function moveChapterBefore(draggedId, target) {
  const moved = manuscript.chapters.find((c) => c.id === draggedId);
  if (!moved || moved.id === target.id) return;
  moved.folderId = target.folderId || null;
  moved.bookId = target.bookId;
  const from = manuscript.chapters.indexOf(moved);
  manuscript.chapters.splice(from, 1);
  manuscript.chapters.splice(manuscript.chapters.indexOf(target), 0, moved);
  persist();
  draw();
}



// dragId/dragFolderId — id перетаскиваемой главы/папки, общие для всех
// обработчиков drop в списке. Ровно один из двух не null за раз —
// каждый dragstart явно обнуляет другой.
let dragId = null;
let dragFolderId = null;

function buildChapterItem(ch, depth) {
  const item = document.createElement("div");
  item.className = "chapter-item" + (ch.id === manuscript.activeChapterId ? " active" : "");
  item.dataset.chapterId = ch.id;
  if (depth) item.style.marginLeft = `${depth * 14}px`;
  item.draggable = true;
  item.appendChild(buildStatusDot(statusOf(ch)));
  const text = document.createElement("span");
  text.className = "chapter-item-text";
  const title = document.createElement("span");
  title.className = "chapter-item-title";
  title.textContent = ch.title || i18n("Без названия");
  const meta = document.createElement("span");
  meta.className = "chapter-item-meta";
  meta.textContent = `${i18nPlural(wordCount(ch.content), ["{n} слово", "{n} слова", "{n} слов"])} · ${i18n(statusOf(ch)?.label || "")}`;
  text.append(title, meta);
  item.appendChild(text);

  item.addEventListener("click", () => {
    manuscript.activeChapterId = ch.id;
    draw();
  });
  item.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(e.clientX, e.clientY, chapterContextMenuItems(ch, e.clientX, e.clientY));
  });
  item.addEventListener("dragstart", (e) => { e.stopPropagation(); dragId = ch.id; dragFolderId = null; });
  item.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); });
  item.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragId === null || dragId === ch.id) return;
    // Дроп на другую главу — переставляет и заодно перенимает её папку
    // (или «без папки»), так что перетаскивание внутрь папки работает и
    // через дроп на любую из уже лежащих в ней глав, а не только на шапку.
    moveChapterBefore(dragId, ch);
  });
  return item;
}

// Меню главы — по правому клику в списке и на карточке «Обзора».
function chapterContextMenuItems(ch, x, y) {
  return [
      {
        label: i18n("Статус"),
        items: [
          ...statuses.map((s) => ({
            label: i18n(s.label),
            checked: ch.status === s.key,
            action: () => {
              ch.status = s.key;
              persist();
              draw();
            },
          })),
          { separator: true },
          // Раньше статусы можно было только выбрать здесь — переименовать,
          // задать цвет/смайлик или завести новый было только через
          // Настройки. Тот же попап (chapter-status.js), что и там,
          // открытый прямо на месте — правки видны сразу, список статусов
          // в этом же меню при следующем открытии уже свежий.
          { label: i18n("Управлять статусами…"), action: () => openStatusManagePopover(x, y) },
        ],
      },
      {
        label: i18n("Папка"),
        // Список папок для перемещения + создание новой — как
        // "Переместить файл в…" в Обсидиане. Отдельного пункта "Без
        // папки" здесь больше нет: перенести главу из папки в общий
        // список можно перетаскиванием на пустое место списка.
        items: [
          ...bookFolders().map((f) => ({
            label: f.name || i18n("Без названия"),
            checked: ch.folderId === f.id,
            action: () => { ch.folderId = f.id; persist(); draw(); },
          })),
          { separator: true },
          {
            label: i18n("Создать папку"),
            action: () => {
              const folder = blankFolder();
              manuscript.folders.push(folder);
              ch.folderId = folder.id;
              persist();
              draw();
            },
          },
        ],
      },
      { separator: true },
      { label: i18n("Экспорт главы в .md"), action: () => exportMarkdown([ch], `${safeFileName(ch.title)}.md`) },
      { label: i18n("Экспорт главы в .pdf"), action: () => exportPdfAction([ch], ch.title || i18n("Без названия")) },
      { label: i18n("Экспорт главы в .docx"), action: () => exportDocx([ch], `${safeFileName(ch.title)}.docx`) },
      { separator: true },
      {
        label: i18n("Удалить главу"),
        danger: true,
        // Как и удаление папки ниже — не сразу, второй клик поверх
        // нового меню с одним пунктом-подтверждением.
        action: () => {
          openContextMenu(x, y, [
            { label: i18n("Точно удалить главу «{title}»?", { title: ch.title || i18n("Без названия") }), danger: true, action: () => deleteChapter(ch) },
          ]);
        },
      },
  ];
}

// Удаление главы — тоже не насовсем: как и везде в приложении, глава
// уходит в корзину (trash.js) и её можно оттуда вернуть.
async function deleteChapter(ch) {
  await pushTrash("chapter", ch);
  manuscript.chapters = manuscript.chapters.filter((c) => c.id !== ch.id);
  if (manuscript.activeChapterId === ch.id) {
    manuscript.activeChapterId = bookChapters()[0]?.id || null;
  }
  persist();
  draw();
}

// Перетаскивание папки на другую — переставляет её рядом с целевой
// (в массиве manuscript.folders, откуда и берётся порядок отрисовки на
// каждом уровне) и переносит на тот же уровень вложенности, что и
// целевая: тащить папку можно и для простой перестановки среди соседей,
// и чтобы переместить её в другую ветку дерева разом.
function moveFolderNextTo(draggedId, targetId) {
  const dragged = manuscript.folders.find((f) => f.id === draggedId);
  const target = manuscript.folders.find((f) => f.id === targetId);
  if (!dragged || !target || dragged.id === target.id) return;
  // Нельзя переносить папку внутрь самой себя или собственного потомка.
  if (collectFolderIds(dragged.id).has(target.id)) return;
  dragged.parentId = folderParent(target);
  const from = manuscript.folders.indexOf(dragged);
  manuscript.folders.splice(from, 1);
  const to = manuscript.folders.indexOf(target);
  manuscript.folders.splice(to, 0, dragged);
  persist();
  draw();
}

// Удаляет папку целиком вместе со всеми вложенными подпапками и главами
// в них — раньше главы просто расфасовывались обратно как «без папки»,
// но это оказалось неожиданным поведением: удаление папки должно
// убирать и её содержимое, как в обычном файловом менеджере. Сами главы
// при этом не пропадают насовсем — уходят в корзину.
async function deleteFolder(folder) {
  const ids = collectFolderIds(folder.id);
  const chaptersToDelete = manuscript.chapters.filter((c) => c.folderId && ids.has(c.folderId));
  for (const c of chaptersToDelete) await pushTrash("chapter", c);
  const deletedIds = new Set(chaptersToDelete.map((c) => c.id));
  manuscript.chapters = manuscript.chapters.filter((c) => !deletedIds.has(c.id));
  manuscript.folders = manuscript.folders.filter((f) => !ids.has(f.id));
  if (manuscript.activeChapterId && deletedIds.has(manuscript.activeChapterId)) {
    manuscript.activeChapterId = bookChapters()[0]?.id || null;
  }
  persist();
  draw();
}

function folderContextMenuItems(folder, x, y) {
  const chaptersInFolder = collectFolderChapters(folder.id);
  return [
    {
      label: i18n("Новая глава"),
      action: () => {
        const c = blankChapter(folder.id);
        manuscript.chapters.push(c);
        manuscript.activeChapterId = c.id;
        folder.collapsed = false;
        persist();
        draw();
      },
    },
    {
      label: i18n("Новая подпапка"),
      action: () => {
        manuscript.folders.push(blankFolder(folder.id));
        folder.collapsed = false;
        persist();
        draw();
      },
    },
    { label: i18n("Переименовать"), action: () => startFolderRename(folder.id) },
    {
      label: i18n("Статус папки"),
      items: [
        { label: i18n("Без статуса"), checked: !folder.status, action: () => { folder.status = null; persist(); draw(); } },
        ...statuses.map((s) => ({
          label: i18n(s.label),
          checked: folder.status === s.key,
          action: () => { folder.status = s.key; persist(); draw(); },
        })),
        { separator: true },
        { label: i18n("Управлять статусами…"), action: () => openStatusManagePopover(x, y) },
      ],
    },
    { separator: true },
    { label: i18n("Экспорт папки в .md"), action: () => exportMarkdown(chaptersInFolder, `${safeFileName(folder.name)}.md`) },
    { label: i18n("Экспорт папки в .pdf"), action: () => exportPdfAction(chaptersInFolder, folder.name || i18n("Без названия")) },
    { label: i18n("Экспорт папки в .docx"), action: () => exportDocx(chaptersInFolder, `${safeFileName(folder.name)}.docx`) },
    { separator: true },
    {
      label: i18n("Удалить папку"),
      danger: true,
      // Как и везде в приложении — не сразу, второй клик поверх нового
      // меню с одним пунктом-подтверждением (см. board.js/data-panel.js).
      action: () => {
        openContextMenu(x, y, [
          { label: i18n("Точно удалить папку «{name}» со всем содержимым?", { name: folder.name || i18n("Без названия") }), danger: true, action: () => deleteFolder(folder) },
        ]);
      },
    },
  ];
}

// Заголовок папки временно переключается в режим переименования (по
// двойному клику или пункту меню «Переименовать»), не является полем
// ввода постоянно — обычный клик по строке сворачивает/разворачивает,
// как в Obsidian, а не намекает на переименование при каждом наведении.
function startFolderRename(folderId) {
  const nameSpan = container?.querySelector(`.chapter-folder[data-folder-id="${folderId}"] .chapter-folder-name`);
  const folder = manuscript.folders.find((f) => f.id === folderId);
  if (!nameSpan || !folder) return;
  const input = document.createElement("input");
  input.className = "chapter-folder-name-input";
  input.value = folder.name || "";
  nameSpan.replaceWith(input);
  input.focus();
  input.select();
  const commit = () => {
    folder.name = input.value.trim() || i18n("Без названия");
    persist();
    draw();
  };
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    else if (e.key === "Escape") { input.value = folder.name || ""; input.blur(); }
  });
}

function buildFolderRow(folder, depth) {
  const header = document.createElement("div");
  header.className = "chapter-folder" + (folder.collapsed ? " collapsed" : "");
  header.dataset.folderId = folder.id;
  if (depth) header.style.marginLeft = `${depth * 14}px`;

  const chevron = document.createElement("span");
  chevron.className = "chapter-folder-chevron";
  chevron.innerHTML = iconSvg("chevron", 13);
  header.appendChild(chevron);

  const icon = document.createElement("span");
  icon.className = "chapter-folder-icon";
  icon.innerHTML = iconSvg("folder", 14);
  header.appendChild(icon);

  const nameSpan = document.createElement("span");
  nameSpan.className = "chapter-folder-name";
  nameSpan.textContent = folder.name || i18n("Без названия");
  header.appendChild(nameSpan);

  const status = folder.status ? statuses.find((s) => s.key === folder.status) : null;
  if (status) header.appendChild(buildStatusDot(status));

  header.addEventListener("click", () => {
    folder.collapsed = !folder.collapsed;
    persist();
    draw();
  });
  header.addEventListener("dblclick", (e) => {
    e.preventDefault();
    startFolderRename(folder.id);
  });
  header.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(e.clientX, e.clientY, folderContextMenuItems(folder, e.clientX, e.clientY));
  });
  header.draggable = true;
  header.addEventListener("dragstart", (e) => { e.stopPropagation(); dragFolderId = folder.id; dragId = null; });
  header.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); });
  header.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragFolderId !== null) {
      moveFolderNextTo(dragFolderId, folder.id);
      return;
    }
    if (dragId === null) return;
    const ch = manuscript.chapters.find((c) => c.id === dragId);
    if (!ch) return;
    ch.folderId = folder.id;
    persist();
    draw();
  });

  return header;
}

// Рекурсивно достраивает дерево папок: подпапки и их содержимое сперва,
// затем главы, лежащие прямо в этой папке (не глубже) — тот же порядок,
// что и в проводнике файлов.
function buildFolderTree(list, parentId, depth) {
  for (const folder of bookFolders().filter((f) => folderParent(f) === parentId)) {
    list.appendChild(buildFolderRow(folder, depth));
    if (!folder.collapsed) {
      buildFolderTree(list, folder.id, depth + 1);
      for (const ch of manuscript.chapters.filter((c) => c.folderId === folder.id)) {
        list.appendChild(buildChapterItem(ch, depth + 1));
      }
    }
  }
}

function emptyAreaContextMenuItems() {
  return [
    {
      label: i18n("Новая глава"),
      action: () => {
        const c = blankChapter();
        manuscript.chapters.push(c);
        manuscript.activeChapterId = c.id;
        persist();
        draw();
      },
    },
    {
      label: i18n("Новая папка"),
      action: () => {
        manuscript.folders.push(blankFolder());
        persist();
        draw();
      },
    },
    { separator: true },
    { label: i18n("Экспорт книги в .md"), action: () => exportMarkdown(bookChapters(), `${safeFileName(activeBook().title)}.md`) },
    { label: i18n("Экспорт книги в .pdf"), action: () => exportPdfAction(bookChapters(), activeBook().title) },
    { label: i18n("Экспорт книги в .docx"), action: () => exportDocx(bookChapters(), `${safeFileName(activeBook().title)}.docx`) },
  ];
}

// Значки создания в шапке списка — вместо двух кнопок-плашек "+ Глава"/
// "+ Папка" внизу списка (были видны только докрутив до конца, если
// глав много): та же идея, что у "новая заметка"/"новая папка" в шапке
// проводника файлов Obsidian — на виду и одним кликом, не главное
// действие среди второстепенного (список глав), а наоборот.
function buildChapterListToolbar() {
  const bar = document.createElement("div");
  bar.className = "chapter-list-toolbar";

  const addChapterBtn = document.createElement("button");
  addChapterBtn.className = "btn icon-btn";
  addChapterBtn.innerHTML = iconSvg("notePlus", 15);
  addChapterBtn.title = i18n("Новая глава");
  addChapterBtn.addEventListener("click", () => {
    const c = blankChapter();
    manuscript.chapters.push(c);
    manuscript.activeChapterId = c.id;
    persist();
    draw();
  });
  bar.appendChild(addChapterBtn);

  const addFolderBtn = document.createElement("button");
  addFolderBtn.className = "btn icon-btn";
  addFolderBtn.innerHTML = iconSvg("folderPlus", 15);
  addFolderBtn.title = i18n("Новая папка");
  addFolderBtn.addEventListener("click", () => {
    manuscript.folders.push(blankFolder());
    persist();
    draw();
  });
  bar.appendChild(addFolderBtn);

  return bar;
}

function buildChapterList() {
  const wrap = document.createElement("div");
  wrap.className = "chapter-list";
  const head = document.createElement("div");
  head.className = "chapter-list-head";
  head.append(buildBookSwitcher(), buildBookProgress());
  wrap.appendChild(head);
  wrap.appendChild(buildChapterListToolbar());

  const rows = document.createElement("div");
  rows.className = "chapter-list-rows";

  buildFolderTree(rows, null, 0);
  for (const ch of bookChapters().filter((c) => !c.folderId)) {
    rows.appendChild(buildChapterItem(ch, 0));
  }

  // ПКМ по пустому месту списка (не по конкретной главе/папке — те сами
  // останавливают всплытие в своих обработчиках) — быстрое «+ Глава»/
  // «+ Папка» без похода к значкам в шапке, как в проводнике файлов.
  rows.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY, emptyAreaContextMenuItems());
  });
  // Дроп на пустое место (не на конкретную главу/папку) — тоже
  // «отвязка»: перетащенная папка поднимается на верхний уровень,
  // перетащенная глава становится «без папки».
  rows.addEventListener("dragover", (e) => e.preventDefault());
  rows.addEventListener("drop", (e) => {
    if (e.target !== rows) return;
    e.preventDefault();
    if (dragFolderId !== null) {
      const dragged = manuscript.folders.find((f) => f.id === dragFolderId);
      if (dragged) { dragged.parentId = null; persist(); draw(); }
      return;
    }
    if (dragId !== null) {
      const ch = manuscript.chapters.find((c) => c.id === dragId);
      if (ch) { ch.folderId = null; persist(); draw(); }
    }
  });

  wrap.appendChild(rows);
  return wrap;
}

// ── Текст ─────────────────────────────────────
// Страница по центру (ширина строки — читаемая, а не во весь экран),
// инструменты на виду над ней, а не только в правом клике; снизу —
// слова главы, время чтения и сегодняшний прогресс.
const READ_WPM = 200;

function chapterNumber(ch) {
  return bookChapters().indexOf(ch) + 1;
}

function buildEditorToolbar(chapter) {
  const bar = document.createElement("div");
  bar.className = "editor-toolbar";
  bar.appendChild(buildModeSwitch());

  // Кнопки форматирования действуют на поле главы, пока оно есть
  // (режим «Правка»); в «Просмотре» им не на что действовать.
  const fmt = document.createElement("div");
  fmt.className = "segmented";
  for (const [label, title, before, after, style] of [
    ["Ж", "Жирный", "**", "**", "font-weight:700"],
    ["К", "Курсив", "*", "*", "font-style:italic"],
    ["Ч", "Подчёркнутый", "<u>", "</u>", "text-decoration:underline"],
    ["З", "Зачёркнутый", "~~", "~~", "text-decoration:line-through"],
  ]) {
    const btn = document.createElement("button");
    btn.className = "segmented-btn ms-fmt-btn";
    btn.innerHTML = `<span style="${style}">${escapeHtml(i18n(label))}</span>`;
    btn.title = i18n(title);
    btn.disabled = viewMode;
    btn.addEventListener("mousedown", (e) => e.preventDefault()); // не забирать фокус и выделение у текста
    btn.addEventListener("click", () => currentTextarea && wrapSelection(currentTextarea, before, after));
    fmt.appendChild(btn);
  }
  const mark = document.createElement("button");
  mark.className = "segmented-btn ms-fmt-btn";
  mark.innerHTML = `<span class="ms-fmt-mark">ab</span>`;
  mark.title = i18n("Выделение цветом");
  mark.disabled = viewMode;
  mark.addEventListener("mousedown", (e) => e.preventDefault());
  mark.addEventListener("click", () => currentTextarea && wrapSelection(currentTextarea, "==", "=="));
  fmt.appendChild(mark);
  bar.appendChild(fmt);

  const insert = document.createElement("div");
  insert.className = "segmented";
  const stickyBtn = document.createElement("button");
  stickyBtn.className = "segmented-btn";
  stickyBtn.innerHTML = `${iconSvg("note", 14)}<span class="tb-label">${escapeHtml(i18n("Стикер"))}</span>`;
  stickyBtn.title = i18n("Вставить стикер-заметку");
  stickyBtn.disabled = viewMode;
  stickyBtn.addEventListener("mousedown", (e) => e.preventDefault());
  stickyBtn.addEventListener("click", () => currentTextarea && insertSticky(currentTextarea, chapter));
  const atBtn = document.createElement("button");
  atBtn.className = "segmented-btn";
  atBtn.innerHTML = `<span>@</span><span class="tb-label">${escapeHtml(i18n("Персонаж"))}</span>`;
  atBtn.title = i18n("Упомянуть персонажа – начни вводить имя");
  atBtn.disabled = viewMode;
  atBtn.addEventListener("mousedown", (e) => e.preventDefault());
  atBtn.addEventListener("click", () => {
    const ta = currentTextarea;
    if (!ta) return;
    const pos = ta.selectionStart;
    ta.value = `${ta.value.slice(0, pos)}@${ta.value.slice(ta.selectionEnd)}`;
    ta.selectionStart = ta.selectionEnd = pos + 1;
    ta.focus();
    ta.dispatchEvent(new Event("input"));
  });
  insert.append(stickyBtn, atBtn);
  bar.appendChild(insert);

  const spacer = document.createElement("div");
  spacer.style.flex = "1";
  bar.appendChild(spacer);

  const viewBtn = document.createElement("button");
  viewBtn.className = "btn";
  viewBtn.innerHTML = `${iconSvg(viewMode ? "pencil" : "eye", 14)}<span class="tb-label">${escapeHtml(viewMode ? i18n("Правка") : i18n("Просмотр"))}</span>`;
  viewBtn.title = viewMode ? i18n("Правка") : i18n("Просмотр");
  viewBtn.addEventListener("click", () => { viewMode = !viewMode; draw(); });

  const focusBtn = document.createElement("button");
  focusBtn.className = "btn icon-btn" + (focusMode ? " active" : "");
  focusBtn.innerHTML = iconSvg("focus", 15);
  focusBtn.title = focusMode ? i18n("Выйти из фокус-режима (Esc)") : i18n("Фокус-режим – только текст");
  focusBtn.addEventListener("click", () => { focusMode = !focusMode; draw(); });

  const panelBtn = document.createElement("button");
  panelBtn.className = "btn icon-btn" + (inspectorOpen && !focusMode ? " active" : "");
  panelBtn.innerHTML = iconSvg("columns", 15);
  panelBtn.title = inspectorOpen ? i18n("Скрыть панель главы") : i18n("Показать панель главы");
  panelBtn.addEventListener("click", () => {
    inspectorOpen = !inspectorOpen;
    if (inspectorOpen) focusMode = false;
    writePrefs({ inspector: inspectorOpen });
    draw();
  });

  const moreBtn = document.createElement("button");
  moreBtn.className = "btn icon-btn";
  moreBtn.innerHTML = iconSvg("more", 16);
  moreBtn.title = i18n("Ещё");
  moreBtn.addEventListener("click", () => {
    const r = moreBtn.getBoundingClientRect();
    openContextMenu(r.right, r.bottom + 4, [
      { label: i18n("Снимок версии"), icon: "camera", action: () => takeSnapshot(chapter) },
      { label: i18n("Знания"), icon: "lightbulb", action: () => openEntityModal("knowledge") },
      {
        label: i18n("Размер шрифта: {n}px", { n: editorFontSize }),
        items: FONT_SIZE_PRESETS.map((size) => ({ label: `${size}px`, checked: size === editorFontSize, action: () => setFontSize(size) })),
      },
      { separator: true },
      { label: i18n("Экспорт главы в .md"), action: () => exportMarkdown([chapter], `${safeFileName(chapter.title)}.md`) },
      { label: i18n("Экспорт главы в .pdf"), action: () => exportPdfAction([chapter], chapter.title || i18n("Без названия")) },
      { label: i18n("Экспорт главы в .docx"), action: () => exportDocx([chapter], `${safeFileName(chapter.title)}.docx`) },
    ]);
  });

  bar.append(viewBtn, focusBtn, panelBtn, moreBtn);
  return bar;
}

function takeSnapshot(chapter) {
  const snapshot = { id: uid(), content: chapter.content, savedAt: new Date().toISOString() };
  chapter.snapshots = [snapshot, ...(chapter.snapshots || [])].slice(0, SNAPSHOT_LIMIT);
  inspectorOpen = true;
  focusMode = false;
  persist();
  draw();
}

function wordsLine(chapter) {
  const n = wordCount(chapter.content);
  const minutes = Math.max(1, Math.round(n / READ_WPM));
  return `${i18nPlural(n, ["{count} слово", "{count} слова", "{count} слов"], {}, "count")} · ${i18nPlural(minutes, ["≈ {n} минута чтения", "≈ {n} минуты чтения", "≈ {n} минут чтения"])}`;
}

function buildEditor() {
  const pane = document.createElement("div");
  pane.className = "editor-pane";
  currentTextarea = null;

  const chapter = manuscript.chapters.find((c) => c.id === manuscript.activeChapterId && c.bookId === manuscript.activeBookId);
  if (!chapter) {
    const empty = buildEmptyState(i18n("В этой книге пока нет глав."), "book");
    const add = document.createElement("button");
    add.className = "btn accent";
    add.textContent = i18n("+ Новая глава");
    add.addEventListener("click", () => addChapter(null));
    empty.appendChild(add);
    pane.appendChild(empty);
    return pane;
  }

  pane.appendChild(buildEditorToolbar(chapter));

  const scroll = document.createElement("div");
  scroll.className = "editor-scroll";
  const page = document.createElement("div");
  page.className = "editor-page";

  const meta = document.createElement("div");
  meta.className = "editor-page-meta";
  const status = statusOf(chapter);
  const statusBtn = document.createElement("button");
  statusBtn.className = "ms-status-chip";
  statusBtn.appendChild(buildStatusDot(status));
  statusBtn.append(i18n(status?.label || ""));
  statusBtn.title = i18n("Статус главы");
  statusBtn.addEventListener("click", () => {
    const r = statusBtn.getBoundingClientRect();
    openContextMenu(r.left, r.bottom + 4, [
      ...statuses.map((s) => ({ label: i18n(s.label), checked: chapter.status === s.key, action: () => { chapter.status = s.key; persist(); draw(); } })),
      { separator: true },
      { label: i18n("Управлять статусами…"), action: () => openStatusManagePopover(r.left, r.bottom + 4) },
    ]);
  });
  const where = document.createElement("span");
  where.textContent = i18n("Глава {n} из {total}", { n: chapterNumber(chapter), total: bookChapters().length });
  meta.append(statusBtn, where);
  page.appendChild(meta);

  const titleInput = document.createElement("input");
  titleInput.className = "chapter-title-input";
  titleInput.value = chapter.title;
  titleInput.placeholder = i18n("Название главы");
  titleInput.addEventListener("input", () => {
    chapter.title = titleInput.value;
    persist();
    refreshChapterListTitles();
  });
  page.appendChild(titleInput);

  const statusBar = document.createElement("div");
  statusBar.className = "editor-status";
  const wc = document.createElement("span");
  wc.className = "word-count";
  wc.textContent = wordsLine(chapter);
  const today = document.createElement("span");
  today.className = "editor-status-today";
  statusBar.append(wc, today);
  // Дневная цель — из того же дневника, что и «Статистика»; число
  // обновляется при каждом открытии и переключении главы.
  loadWritingLog().then((log) => {
    const { goal, todayWords } = computeStats(log);
    if (!goal) return;
    today.innerHTML = `${escapeHtml(i18n("Сегодня {n} из {goal}", { n: todayWords, goal }))}<span class="ms-bar"><span style="width:${Math.min(100, (todayWords / goal) * 100).toFixed(1)}%"></span></span>`;
  }).catch(() => {});

  if (viewMode) {
    const view = document.createElement("div");
    view.className = "chapter-content chapter-content-view";
    const formatted = applyInlineMarkupHtml(mentionsToHtml(chapter.content, characters));
    view.innerHTML = stickersToHtml(formatted, chapter.stickies || []) || `<span class="empty-state">${i18n("Глава пуста.")}</span>`;
    view.addEventListener("click", (e) => {
      const charId = e.target.dataset?.charId;
      if (charId) document.dispatchEvent(new CustomEvent("fictaris:open-character", { detail: { id: charId } }));
    });
    attachMentionHoverPreview(view, () => characters);
    attachStickyPopover(view, () => chapter.stickies || []);
    page.appendChild(view);
  } else {
    const wrap = document.createElement("div");
    wrap.className = "editor-textarea-wrap";
    const textarea = document.createElement("textarea");
    textarea.className = "chapter-content";
    textarea.value = chapter.content;
    textarea.placeholder = i18n("Пиши здесь… @имя вставит упоминание персонажа, @[Имя|нужный падеж] – если по тексту не «Надя», а «Наде»");
    // Поле растёт вместе с текстом — прокручивается страница целиком
    // (заголовок уезжает вверх, как в настоящей книге), а не окошко внутри.
    const autosize = () => {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    textarea.addEventListener("input", () => {
      chapter.content = textarea.value;
      wc.textContent = wordsLine(chapter);
      autosize();
      persist();
    });
    wrap.appendChild(textarea);
    attachMentionAutocomplete(textarea, () => characters);
    attachEditorContextMenu(textarea, chapter);
    page.appendChild(wrap);
    currentTextarea = textarea;
    setTimeout(autosize, 0);
  }

  scroll.appendChild(page);
  pane.append(scroll, statusBar);
  return pane;
}

// ── Панель главы ──────────────────────────────
// Справа от текста, сворачивается кнопкой в панели инструментов:
// синопсис (его же показывает «Обзор»), кто в главе, где она идёт,
// заметки, стикеры и снимки версий.
function inspectorSection(title, body, action) {
  const sec = document.createElement("section");
  sec.className = "ms-section";
  const head = document.createElement("div");
  head.className = "ms-section-head";
  const t = document.createElement("span");
  t.textContent = title;
  head.appendChild(t);
  if (action) head.appendChild(action);
  sec.append(head, body);
  return sec;
}

function addButton(onClick) {
  const btn = document.createElement("button");
  btn.className = "ms-link";
  btn.textContent = i18n("+ добавить");
  btn.addEventListener("click", (e) => onClick(e.currentTarget.getBoundingClientRect()));
  return btn;
}

// Выбор фишками во всплывающем окне — для «В главе» и «Места».
function openPickPopover(r, items, selected, colorOf, onToggle) {
  const wrap = document.createElement("div");
  wrap.className = "timeline-filter-popover";
  const row = document.createElement("div");
  row.className = "timeline-filter-bar";
  for (const item of items) {
    const chip = document.createElement("button");
    chip.className = "filter-chip" + (selected.includes(item.id) ? " active" : "");
    chip.style.setProperty("--chip-color", colorOf(item));
    chip.textContent = item.name || i18n("Без имени");
    chip.addEventListener("click", () => {
      onToggle(item.id);
      chip.classList.toggle("active");
    });
    row.appendChild(chip);
  }
  if (!items.length) row.textContent = i18n("пока нет");
  wrap.appendChild(row);
  openPopover(r.left, r.bottom + 4, wrap, "timeline-filter-menu");
}

function toggleId(list, id) {
  const set = new Set(list || []);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return [...set];
}

function buildInspector(chapter) {
  const panel = document.createElement("aside");
  panel.className = "ms-inspector";

  const synopsis = document.createElement("textarea");
  synopsis.className = "ms-synopsis";
  synopsis.value = chapter.synopsis || "";
  synopsis.placeholder = i18n("О чём глава – одной-двумя фразами. Это видно на карточке в «Обзоре».");
  synopsis.addEventListener("input", () => { chapter.synopsis = synopsis.value; persist(); });
  panel.appendChild(inspectorSection(i18n("Синопсис"), synopsis));

  const castBox = document.createElement("div");
  castBox.className = "ms-cast";
  const cast = chapterCast(chapter);
  if (!cast.length) castBox.innerHTML = `<div class="hint-text">${escapeHtml(i18n("Упомяни персонажа через @ или добавь вручную."))}</div>`;
  for (const { c, mentioned } of cast) {
    const row = document.createElement("div");
    row.className = "ms-cast-row";
    row.innerHTML = `${avatarHtml(c, 26)}<span class="ms-cast-text"><span class="ms-cast-name">${escapeHtml(c.name || i18n("Без имени"))}</span><span class="ms-cast-role">${escapeHtml(mentioned ? i18n("упомянут в тексте") : c.role || "")}</span></span>`;
    row.addEventListener("click", () => openEntityModal("characters", c.id));
    if (!mentioned) {
      const del = document.createElement("button");
      del.className = "ms-remove";
      del.innerHTML = iconSvg("close", 11);
      del.title = i18n("Убрать из главы");
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        chapter.characterIds = (chapter.characterIds || []).filter((id) => id !== c.id);
        persist();
        draw();
      });
      row.appendChild(del);
    }
    castBox.appendChild(row);
  }
  panel.appendChild(inspectorSection(i18n("В главе"), castBox, addButton((r) =>
    openPickPopover(r, characters, chapter.characterIds || [], (c) => c.color || "#7c7157", (id) => {
      chapter.characterIds = toggleId(chapter.characterIds, id);
      persist();
      // Перерисовка — по закрытии окна выбора: иначе оно закрылось бы на каждом щелчке.
      document.addEventListener("mousedown", function redraw(e) {
        if (e.target.closest(".timeline-filter-menu")) return;
        document.removeEventListener("mousedown", redraw, true);
        setTimeout(draw, 0);
      }, true);
    })
  )));

  const placesBox = document.createElement("div");
  placesBox.className = "timeline-chips";
  const places = chapterPlaces(chapter);
  placesBox.innerHTML = places.length
    ? places.map(placeChipHtml).join("")
    : `<div class="hint-text">${escapeHtml(i18n("Где происходит глава."))}</div>`;
  panel.appendChild(inspectorSection(i18n("Места"), placesBox, addButton((r) =>
    openPickPopover(r, locations, chapter.locationIds || [], (l) => locationTypeInfo(l.type)[3], (id) => {
      chapter.locationIds = toggleId(chapter.locationIds, id);
      persist();
      document.addEventListener("mousedown", function redraw(e) {
        if (e.target.closest(".timeline-filter-menu")) return;
        document.removeEventListener("mousedown", redraw, true);
        setTimeout(draw, 0);
      }, true);
    })
  )));

  panel.appendChild(buildNotesEditor(chapter));
  panel.appendChild(buildStickyEditor(chapter));
  panel.appendChild(buildSnapshots(chapter));
  return panel;
}

// ── Обзор ─────────────────────────────────────
// Вся книга карточками: части (папки верхнего уровня) по порядку, в
// каждой — главы с номером, статусом, синопсисом, первой строкой, кто в
// главе, местами и объёмом. Щелчок открывает главу в «Тексте»,
// перетаскивание переставляет.
function firstLine(text) {
  const line = (text || "").split("\n").find((l) => l.trim()) || "";
  return line.replace(/\[\[note:[\w-]+\]\]/g, "").replace(/@\[([^|\]]+)\|([^\]]+)\]/g, "$2").replace(/@/g, "").replace(/\*\*|~~|==|<\/?u>|\*/g, "").trim();
}

function buildOverviewCard(ch) {
  const card = document.createElement("div");
  card.className = "ms-card";
  card.draggable = true;
  const status = statusOf(ch);
  card.style.setProperty("--status-color", status?.color || "#7c7157");
  const cast = chapterCast(ch);
  const places = chapterPlaces(ch);
  const about = ch.synopsis || ch.notes?.[0]?.text || "";
  const line = firstLine(ch.content);
  card.innerHTML = `
    <div class="ms-card-top"><span class="ms-card-num">${escapeHtml(i18n("Глава {n}", { n: chapterNumber(ch) }))}</span><span class="ms-status-chip static"></span></div>
    <div class="ms-card-title">${escapeHtml(ch.title || i18n("Без названия"))}</div>
    <div class="ms-card-about${about ? "" : " empty"}">${escapeHtml(about || i18n("Синопсис не написан"))}</div>
    ${line ? `<div class="ms-card-line">«${escapeHtml(line.slice(0, 110))}${line.length > 110 ? "…" : ""}»</div>` : ""}
    ${places.length ? `<div class="timeline-chips">${places.slice(0, 2).map(placeChipHtml).join("")}</div>` : ""}
    <div class="ms-card-bottom"><span class="ms-card-cast">${cast.slice(0, 6).map(({ c }) => avatarHtml(c, 24)).join("")}${cast.length > 6 ? `<span class="ms-card-more">+${cast.length - 6}</span>` : ""}</span><span class="ms-card-words">${escapeHtml(i18nPlural(wordCount(ch.content), ["{n} слово", "{n} слова", "{n} слов"]))}</span></div>`;
  const chip = card.querySelector(".ms-status-chip");
  chip.appendChild(buildStatusDot(status));
  chip.append(i18n(status?.label || ""));
  card.addEventListener("click", () => {
    manuscript.activeChapterId = ch.id;
    mode = "text";
    writePrefs({ mode });
    draw();
  });
  card.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY, chapterContextMenuItems(ch, e.clientX, e.clientY));
  });
  card.addEventListener("dragstart", () => { dragId = ch.id; dragFolderId = null; });
  card.addEventListener("dragover", (e) => e.preventDefault());
  card.addEventListener("drop", (e) => {
    e.preventDefault();
    if (dragId !== null && dragId !== ch.id) moveChapterBefore(dragId, ch);
  });
  return card;
}

function buildOverview() {
  const wrap = document.createElement("div");
  wrap.className = "ms-overview";
  const chapters = bookChapters();

  const bar = document.createElement("div");
  bar.className = "timeline-toolbar";
  const title = document.createElement("div");
  title.className = "timeline-heading";
  title.textContent = activeBook().title || i18n("Рукопись");
  const metaEl = document.createElement("div");
  metaEl.className = "timeline-meta";
  const done = chapters.filter((c) => c.status === statuses[statuses.length - 1]?.key).length;
  metaEl.textContent = [
    i18nPlural(chapters.length, ["{n} глава", "{n} главы", "{n} глав"]),
    i18nPlural(bookWords(), ["{n} слово", "{n} слова", "{n} слов"]),
    activeBook().goal ? i18n("цель {n}", { n: activeBook().goal.toLocaleString() }) : "",
    done ? i18n("готово: {n}", { n: done }) : "",
  ].filter(Boolean).join(" · ");
  const spacer = document.createElement("div");
  spacer.style.flex = "1";
  const addBtn = document.createElement("button");
  addBtn.className = "btn accent";
  addBtn.textContent = i18n("+ Глава");
  addBtn.addEventListener("click", () => addChapter(null));
  bar.append(title, metaEl, spacer, buildBookSwitcher(), buildModeSwitch(), addBtn);
  wrap.appendChild(bar);

  // Готовность — доля глав в каждом статусе, по порядку статусов.
  if (chapters.length) {
    const ready = document.createElement("div");
    ready.className = "ms-readiness";
    const label = document.createElement("span");
    label.textContent = i18n("Готовность");
    const track = document.createElement("div");
    track.className = "ms-readiness-track";
    const legend = document.createElement("div");
    legend.className = "ms-readiness-legend";
    for (const s of statuses) {
      const n = chapters.filter((c) => (statusOf(c)?.key) === s.key).length;
      if (!n) continue;
      const seg = document.createElement("span");
      seg.style.width = `${(n / chapters.length) * 100}%`;
      seg.style.background = s.color || "#7c7157";
      seg.title = `${i18n(s.label)}: ${n}`;
      track.appendChild(seg);
      const item = document.createElement("span");
      item.appendChild(buildStatusDot(s));
      item.append(`${i18n(s.label)} · ${n}`);
      legend.appendChild(item);
    }
    ready.append(label, track, legend);
    wrap.appendChild(ready);
  }

  const body = document.createElement("div");
  body.className = "ms-overview-body";
  const groups = [];
  const loose = chapters.filter((c) => !c.folderId);
  for (const f of bookFolders().filter((x) => !folderParent(x))) {
    groups.push({ folder: f, list: chapters.filter((c) => c.folderId && collectFolderIds(f.id).has(c.folderId)) });
  }
  if (loose.length || !groups.length) groups.push({ folder: null, list: loose });

  for (const g of groups) {
    const head = document.createElement("div");
    head.className = "ms-part-head";
    head.innerHTML = `<span>${escapeHtml(g.folder ? g.folder.name || i18n("Без названия") : groups.length > 1 ? i18n("Без папки") : i18n("Главы"))}</span><small>${escapeHtml(i18nPlural(g.list.length, ["{n} глава", "{n} главы", "{n} глав"]))} · ${escapeHtml(i18nPlural(g.list.reduce((n, c) => n + wordCount(c.content), 0), ["{n} слово", "{n} слова", "{n} слов"]))}</small>`;
    if (g.folder) {
      head.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        openContextMenu(e.clientX, e.clientY, folderContextMenuItems(g.folder, e.clientX, e.clientY));
      });
    }
    const grid = document.createElement("div");
    grid.className = "ms-grid";
    for (const ch of g.list) grid.appendChild(buildOverviewCard(ch));
    const add = document.createElement("button");
    add.className = "ms-card ms-card-add";
    add.textContent = i18n("+ Новая глава");
    add.addEventListener("click", () => addChapter(g.folder?.id || null));
    grid.appendChild(add);
    body.append(head, grid);
  }
  wrap.appendChild(body);
  return wrap;
}

function addChapter(folderId) {
  const c = blankChapter(folderId);
  manuscript.chapters.push(c);
  manuscript.activeChapterId = c.id;
  mode = "text";
  writePrefs({ mode });
  persist();
  draw();
}

// Заметок теперь может быть сколько угодно на главу (раньше — одно
// общее поле authorNotes) — тот же список-с-кнопкой-добавить, что и у
// стикеров ниже, только без связи с текстом главы: это заметки только
// для себя, не привязанные к конкретному месту в тексте.
function buildNotesEditor(chapter) {
  const notes = chapter.notes || [];
  const details = document.createElement("details");
  details.className = "author-notes";
  details.open = true;
  const summary = document.createElement("summary");
  summary.textContent = i18n("Заметки ({n})", { n: notes.length });
  details.appendChild(summary);

  if (!notes.length) {
    const empty = document.createElement("div");
    empty.className = "hint-text";
    empty.textContent = i18n("Не входят в текст главы и в экспорт.");
    details.appendChild(empty);
  }

  for (const note of notes) {
    const row = document.createElement("div");
    row.className = "sticky-editor-row";
    const area = document.createElement("textarea");
    area.className = "sticky-editor-textarea";
    area.value = note.text || "";
    area.placeholder = i18n("Текст заметки…");
    area.addEventListener("input", () => { note.text = area.value; persist(); });
    row.appendChild(area);

    const delBtn = document.createElement("button");
    delBtn.className = "btn danger";
    delBtn.innerHTML = iconSvg("close", 12);
    delBtn.title = i18n("Удалить заметку");
    delBtn.addEventListener("click", () => {
      chapter.notes = chapter.notes.filter((n) => n.id !== note.id);
      persist();
      draw();
    });
    row.appendChild(delBtn);

    details.appendChild(row);
  }

  const addBtn = document.createElement("button");
  addBtn.className = "btn";
  addBtn.textContent = i18n("+ Заметка");
  addBtn.addEventListener("click", () => {
    chapter.notes = [...(chapter.notes || []), { id: uid(), text: "" }];
    persist();
    draw();
  });
  details.appendChild(addBtn);

  return details;
}

function buildStickyEditor(chapter) {
  const stickies = chapter.stickies || [];
  const details = document.createElement("details");
  details.className = "author-notes";
  details.open = true;
  const summary = document.createElement("summary");
  summary.textContent = i18n("Стикеры ({n})", { n: stickies.length });
  details.appendChild(summary);

  if (!stickies.length) {
    const empty = document.createElement("div");
    empty.className = "hint-text";
    empty.textContent = i18n("Пока нет – правый клик по тексту главы добавит стикер-заметку.");
    details.appendChild(empty);
  }

  for (const sticky of stickies) {
    const row = document.createElement("div");
    row.className = "sticky-editor-row";
    const area = document.createElement("textarea");
    area.className = "sticky-editor-textarea";
    area.dataset.stickyId = sticky.id; // чтобы insertSticky мог найти и сфокусировать именно этот стикер сразу после вставки
    area.value = sticky.text || "";
    area.placeholder = i18n("Текст заметки…");
    area.addEventListener("input", () => { sticky.text = area.value; persist(); });
    row.appendChild(area);

    const delBtn = document.createElement("button");
    delBtn.className = "btn danger";
    delBtn.innerHTML = iconSvg("close", 12);
    delBtn.title = i18n("Удалить стикер вместе с его маркером в тексте главы");
    delBtn.addEventListener("click", () => {
      // Раньше маркер [[note:id]] оставался в тексте главы как обычный
      // текст — стикер пропадал из списка, но в самой главе всё ещё
      // торчал нечитаемый огрызок разметки.
      chapter.stickies = chapter.stickies.filter((s) => s.id !== sticky.id);
      chapter.content = (chapter.content || "").replace(
        new RegExp(`\\[\\[note:${sticky.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\]`, "g"),
        ""
      );
      persist();
      draw();
    });
    row.appendChild(delBtn);

    details.appendChild(row);
  }

  return details;
}

function buildSnapshots(chapter) {
  const details = document.createElement("details");
  details.className = "author-notes";
  const summary = document.createElement("summary");
  summary.textContent = i18n("Снимки версий ({n})", { n: (chapter.snapshots || []).length });
  details.appendChild(summary);

  if (!(chapter.snapshots || []).length) {
    const empty = document.createElement("div");
    empty.className = "hint-text";
    empty.textContent = i18n("Пока нет снимков – кнопка «Снимок» в шапке главы сохранит текущий текст.");
    details.appendChild(empty);
    return details;
  }

  for (const snap of chapter.snapshots) {
    const wrap = document.createElement("div");
    wrap.className = "snapshot-item";

    const row = document.createElement("div");
    row.className = "snapshot-row";
    row.title = i18n("Снимок – сохранённая копия текста главы на этот момент. «Просмотреть» покажет её, не трогая текущий текст; «Восстановить» заменит им текущий текст главы.");

    const date = document.createElement("span");
    date.className = "snapshot-date";
    date.textContent = new Date(snap.savedAt).toLocaleString();
    row.appendChild(date);

    const actions = document.createElement("div");
    actions.className = "snapshot-actions";

    // Раньше приходилось восстанавливать вслепую, чтобы вспомнить, что
    // именно в снимке — теперь можно развернуть текст прямо тут,
    // read-only, и решить уже по факту.
    const preview = document.createElement("div");
    preview.className = "snapshot-preview";
    preview.style.display = "none";
    preview.textContent = snap.content || i18n("(пусто)");

    const previewBtn = document.createElement("button");
    previewBtn.className = "btn";
    previewBtn.textContent = i18n("Просмотреть");
    previewBtn.addEventListener("click", () => {
      const open = preview.style.display !== "none";
      preview.style.display = open ? "none" : "block";
      previewBtn.textContent = open ? i18n("Просмотреть") : i18n("Скрыть");
    });
    actions.appendChild(previewBtn);

    const restoreBtn = document.createElement("button");
    restoreBtn.className = "btn";
    restoreBtn.textContent = i18n("Восстановить");
    restoreBtn.addEventListener("click", () => {
      if (restoreBtn.dataset.confirm === "1") {
        chapter.content = snap.content;
        persist();
        draw();
        return;
      }
      restoreBtn.dataset.confirm = "1";
      restoreBtn.textContent = i18n("Заменит текущий текст. Точно?");
      setTimeout(() => { restoreBtn.dataset.confirm = ""; restoreBtn.textContent = i18n("Восстановить"); }, 4000);
    });
    actions.appendChild(restoreBtn);

    const delBtn = document.createElement("button");
    delBtn.className = "btn danger";
    delBtn.innerHTML = iconSvg("close", 12);
    delBtn.addEventListener("click", () => {
      chapter.snapshots = chapter.snapshots.filter((s) => s.id !== snap.id);
      persist();
      draw();
    });
    actions.appendChild(delBtn);

    row.appendChild(actions);
    wrap.append(row, preview);
    details.appendChild(wrap);
  }

  return details;
}

function refreshChapterListTitles() {
  for (const ch of manuscript.chapters) {
    const item = container.querySelector(`.chapter-item[data-chapter-id="${ch.id}"] .chapter-item-title`);
    if (item) item.textContent = ch.title || i18n("Без названия");
  }
}
