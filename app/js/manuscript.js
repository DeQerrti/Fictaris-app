import { apiGet, apiPost, uid } from "./api.js";
import { debounceSave } from "./save-badge.js";
import { mentionsToHtml, attachMentionAutocomplete, attachMentionHoverPreview, buildMentionContextMenuItems } from "./mentions.js";
import { stickersToHtml, attachStickyPopover } from "./stickies.js";
import { buildManuscriptDocx } from "./docx.js";
import { exportChaptersPdf } from "./export-pdf.js";
import { openContextMenu, openPopover, closeMenu } from "./context-menu.js";
import { loadStatuses, buildStatusDot, buildStatusManagePanel } from "./chapter-status.js";
import { pushTrash } from "./trash.js";
import { iconSvg } from "./icons.js";
import { applyInlineMarkupHtml } from "./text-format.js";
import { recordToday } from "./writing-goal.js";
import { openEntityModal } from "./entity-modal.js";
import { i18n } from "./i18n.js";

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
let viewMode = false;
let focusMode = false;
let extrasOpen = false; // панель «Заметки/Стикеры/Снимки» справа от редактора — по требованию, не всегда на виду (см. buildExtrasPanel)
let container = null;
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
  return { id: uid(), title: i18n("Новая глава"), content: "", status: statuses[0]?.key || "draft", notes: [], stickies: [], snapshots: [], folderId };
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
  return { id: uid(), name: i18n("Новая папка"), status: null, parentId, collapsed: false };
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
  extrasOpen = true;
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
  const [manuscriptData, charactersData, siteSettings, statusList] = await Promise.all([
    apiGet("/api/manuscript"),
    apiGet("/api/characters"),
    apiGet("/api/site-settings").catch(() => ({})),
    loadStatuses(),
  ]);
  manuscript = manuscriptData;
  manuscript.folders = manuscript.folders || []; // старые проекты сохранялись без папок
  for (const c of manuscript.chapters) migrateChapterNotes(c);
  characters = charactersData;
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
  if (focusChapterId && manuscript.chapters.some((c) => c.id === focusChapterId)) {
    manuscript.activeChapterId = focusChapterId;
  } else if (!manuscript.activeChapterId) {
    manuscript.activeChapterId = manuscript.chapters[0]?.id || null;
  }
  draw();
}

function draw() {
  document.body.classList.toggle("focus-mode", focusMode);
  container.innerHTML = "";
  const view = document.createElement("div");
  view.className = "manuscript-view";

  if (!focusMode) view.appendChild(buildChapterList());
  view.appendChild(buildEditor());
  const activeChapter = manuscript.chapters.find((c) => c.id === manuscript.activeChapterId);
  if (extrasOpen && activeChapter) view.appendChild(buildExtrasPanel(activeChapter));

  container.appendChild(view);
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
  item.appendChild(buildStatusDot(statuses.find((s) => s.key === ch.status) || statuses[0]));
  const title = document.createElement("span");
  title.textContent = ch.title || i18n("Без названия");
  item.appendChild(title);

  item.addEventListener("click", () => {
    manuscript.activeChapterId = ch.id;
    draw();
  });
  item.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const x = e.clientX;
    const y = e.clientY;
    openContextMenu(x, y, [
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
          ...manuscript.folders.map((f) => ({
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
    ]);
  });
  item.addEventListener("dragstart", (e) => { e.stopPropagation(); dragId = ch.id; dragFolderId = null; });
  item.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); });
  item.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragId === null || dragId === ch.id) return;
    const moved = manuscript.chapters.find((c) => c.id === dragId);
    if (!moved) return;
    // Дроп на другую главу — переставляет и заодно перенимает её папку
    // (или «без папки»), так что перетаскивание внутрь папки работает и
    // через дроп на любую из уже лежащих в ней глав, а не только на шапку.
    moved.folderId = ch.folderId || null;
    const from = manuscript.chapters.findIndex((c) => c.id === dragId);
    const to = manuscript.chapters.findIndex((c) => c.id === ch.id);
    manuscript.chapters.splice(from, 1);
    manuscript.chapters.splice(to, 0, moved);
    persist();
    draw();
  });
  return item;
}

// Удаление главы — тоже не насовсем: как и везде в приложении, глава
// уходит в корзину (trash.js) и её можно оттуда вернуть.
async function deleteChapter(ch) {
  await pushTrash("chapter", ch);
  manuscript.chapters = manuscript.chapters.filter((c) => c.id !== ch.id);
  if (manuscript.activeChapterId === ch.id) {
    manuscript.activeChapterId = manuscript.chapters[0]?.id || null;
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
    manuscript.activeChapterId = manuscript.chapters[0]?.id || null;
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
  for (const folder of manuscript.folders.filter((f) => folderParent(f) === parentId)) {
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
    { label: i18n("Экспорт всей рукописи в .md"), action: () => exportMarkdown() },
    { label: i18n("Экспорт всей рукописи в .pdf"), action: () => exportPdfAction(manuscript.chapters, i18n("Рукопись")) },
    { label: i18n("Экспорт всей рукописи в .docx"), action: () => exportDocx() },
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
  wrap.appendChild(buildChapterListToolbar());

  const rows = document.createElement("div");
  rows.className = "chapter-list-rows";

  buildFolderTree(rows, null, 0);
  for (const ch of manuscript.chapters.filter((c) => !c.folderId)) {
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

function buildEditor() {
  const pane = document.createElement("div");
  pane.className = "editor-pane";

  const chapter = manuscript.chapters.find((c) => c.id === manuscript.activeChapterId);
  if (!chapter) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = i18n("Выбери или создай главу.");
    pane.appendChild(empty);
    return pane;
  }

  const header = document.createElement("div");
  header.className = "editor-header";

  const titleInput = document.createElement("input");
  titleInput.className = "chapter-title-input";
  titleInput.value = chapter.title;
  titleInput.addEventListener("input", () => {
    chapter.title = titleInput.value;
    persist();
    refreshChapterListTitles();
  });
  header.appendChild(titleInput);

  // Только счёт по этой главе — сумма по всей рукописи дублировала
  // «Статистику» (там уже есть «слов написано» по всему проекту), а не
  // по папке, как можно было подумать глядя на неё здесь.
  const wc = document.createElement("div");
  wc.className = "word-count";
  wc.textContent = i18n("{count} слов", { count: wordCount(chapter.content) });
  header.appendChild(wc);

  // Статус — уже переехал в ПКМ по главе в списке слева (chapter-list),
  // размер шрифта и вставка стикера — в ПКМ по самому тексту
  // (attachEditorContextMenu). Здесь, перед лицом во время письма,
  // остаются только заголовок и счётчик слов — всё остальное (Правка/
  // Просмотр, Снимок, Заметки и снимки, Фокус-режим) спрятано за одной
  // неприметной кнопкой «⋯», как в Obsidian.
  const moreBtn = document.createElement("button");
  moreBtn.className = "btn icon-btn";
  moreBtn.innerHTML = iconSvg("more", 16);
  moreBtn.title = i18n("Ещё");
  moreBtn.addEventListener("click", () => {
    const r = moreBtn.getBoundingClientRect();
    openContextMenu(r.right, r.bottom + 4, [
      {
        label: viewMode ? i18n("Правка") : i18n("Просмотр"),
        icon: viewMode ? "pencil" : "eye",
        action: () => {
          viewMode = !viewMode;
          draw();
        },
      },
      {
        label: i18n("Снимок"),
        icon: "camera",
        action: () => {
          const snapshot = { id: uid(), content: chapter.content, savedAt: new Date().toISOString() };
          chapter.snapshots = [snapshot, ...(chapter.snapshots || [])].slice(0, SNAPSHOT_LIMIT);
          persist();
          draw();
        },
      },
      {
        label: i18n("Заметки и снимки"),
        icon: "note",
        checked: extrasOpen,
        action: () => {
          extrasOpen = !extrasOpen;
          draw();
        },
      },
      { separator: true },
      {
        label: i18n("Знания"),
        icon: "lightbulb",
        action: () => openEntityModal("knowledge"),
      },
      { separator: true },
      {
        label: focusMode ? i18n("Выйти из фокус-режима") : i18n("Фокус-режим"),
        icon: "focus",
        action: () => {
          focusMode = !focusMode;
          draw();
        },
      },
    ]);
  });
  header.appendChild(moreBtn);

  pane.appendChild(header);

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
    pane.appendChild(view);
  } else {
    const wrap = document.createElement("div");
    wrap.className = "editor-textarea-wrap";
    const textarea = document.createElement("textarea");
    textarea.className = "chapter-content";
    textarea.value = chapter.content;
    textarea.placeholder = i18n("Пиши здесь… @имя вставит упоминание персонажа, @[Имя|нужный падеж] – если по тексту не «Надя», а «Наде»");
    textarea.addEventListener("input", () => {
      chapter.content = textarea.value;
      wc.textContent = i18n("{count} слов", { count: wordCount(chapter.content) });
      persist();
    });
    wrap.appendChild(textarea);
    attachMentionAutocomplete(textarea, () => characters);
    attachEditorContextMenu(textarea, chapter);
    pane.appendChild(wrap);
  }

  return pane;
}

// Отдельная выезжающая панель (переиспользует .drawer — тот же вид, что
// у карточек персонажа/локации/т.д.), а не блоки под текстом главы —
// открывается кнопкой «Заметки и снимки» в шапке редактора (см. выше).
function buildExtrasPanel(chapter) {
  const panel = document.createElement("div");
  panel.className = "drawer";

  const closeRow = document.createElement("div");
  closeRow.className = "drawer-actions";
  closeRow.style.marginTop = "0";
  closeRow.style.marginBottom = "12px";
  closeRow.style.justifyContent = "flex-end";
  const closeBtn = document.createElement("button");
  closeBtn.className = "btn icon-btn";
  closeBtn.innerHTML = iconSvg("close", 14);
  closeBtn.title = i18n("Закрыть");
  closeBtn.addEventListener("click", () => {
    extrasOpen = false;
    draw();
  });
  closeRow.appendChild(closeBtn);
  panel.appendChild(closeRow);

  panel.appendChild(buildNotesEditor(chapter));
  panel.appendChild(buildStickyEditor(chapter));
  panel.appendChild(buildSnapshots(chapter));

  return panel;
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
    const item = container.querySelector(`.chapter-item[data-chapter-id="${ch.id}"] span:last-child`);
    if (item) item.textContent = ch.title || i18n("Без названия");
  }
}
