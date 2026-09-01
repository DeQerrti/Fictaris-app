import { apiGet, apiPost, uid } from "./api.js";
import { debounceSave } from "./save-badge.js";
import { mentionsToHtml, attachMentionAutocomplete, attachMentionHoverPreview } from "./mentions.js";
import { stickersToHtml, attachStickyPopover } from "./stickies.js";
import { buildManuscriptDocx } from "./docx.js";
import { openContextMenu } from "./context-menu.js";
import { loadStatuses, buildStatusDot } from "./chapter-status.js";
import { iconSvg } from "./icons.js";
import { i18n } from "./i18n.js";

// Список статусов — настраиваемый (Настройки → Статусы глав, см.
// chapter-status.js), общий для глав и папок; читается заново при
// каждом открытии вкладки в renderManuscript.
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
}

const SNAPSHOT_LIMIT = 20;

function blankChapter(folderId = null) {
  return { id: uid(), title: i18n("Новая глава"), content: "", status: statuses[0]?.key || "draft", authorNotes: "", stickies: [], snapshots: [], folderId };
}

function blankFolder(parentId = null) {
  return { id: uid(), name: i18n("Новая папка"), status: null, parentId, collapsed: false };
}

function folderParent(folder) {
  return folder.parentId || null;
}

// Все главы папки и вложенных в неё подпапок разом — экспорт папки
// должен захватывать всё дерево, а не только прямых детей.
function collectFolderChapters(folderId) {
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

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && focusMode) {
    focusMode = false;
    draw();
  }
});

function insertSticky(textarea, chapter) {
  const sticky = { id: nextStickyId(chapter), text: "" };
  chapter.stickies = [...(chapter.stickies || []), sticky];
  const pos = textarea.selectionStart;
  const marker = `[[note:${sticky.id}]]`;
  textarea.value = textarea.value.slice(0, pos) + marker + textarea.value.slice(pos);
  chapter.content = textarea.value;
  persist();
  draw();
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

// Правый клик в тексте главы раньше не делал ничего — берём набор,
// привычный по Obsidian/Word: форматирование выделения, вставка стикера
// и счётчик слов у самого выделения (полезнее, чем общий по главе,
// который и так виден в шапке редактора).
function attachEditorContextMenu(textarea, chapter) {
  textarea.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const hasSelection = textarea.selectionStart !== textarea.selectionEnd;
    const selectedWords = hasSelection ? wordCount(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)) : 0;
    openContextMenu(e.clientX, e.clientY, [
      { label: i18n("Жирный"), disabled: !hasSelection, action: () => wrapSelection(textarea, "**", "**") },
      { label: i18n("Курсив"), disabled: !hasSelection, action: () => wrapSelection(textarea, "*", "*") },
      { separator: true },
      { label: i18n("Вставить стикер-заметку"), action: () => insertSticky(textarea, chapter) },
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
      { label: hasSelection ? i18n("Слов в выделении: {n}", { n: selectedWords }) : i18n("Слов в главе: {n}", { n: wordCount(chapter.content) }), disabled: true },
    ]);
  });
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

// dragId — id перетаскиваемой главы, общий для всех обработчиков drop
// в списке (и на главах, и на заголовках папок).
let dragId = null;

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
    openContextMenu(e.clientX, e.clientY, [
      {
        label: i18n("Статус"),
        items: statuses.map((s) => ({
          label: i18n(s.label),
          checked: ch.status === s.key,
          action: () => {
            ch.status = s.key;
            persist();
            draw();
          },
        })),
      },
      {
        label: i18n("Папка"),
        items: [
          { label: i18n("Без папки"), checked: !ch.folderId, action: () => { ch.folderId = null; persist(); draw(); } },
          ...manuscript.folders.map((f) => ({
            label: f.name || i18n("Без названия"),
            checked: ch.folderId === f.id,
            action: () => { ch.folderId = f.id; persist(); draw(); },
          })),
        ],
      },
      { separator: true },
      { label: i18n("Экспорт главы в .md"), action: () => exportMarkdown([ch], `${safeFileName(ch.title)}.md`) },
      { label: i18n("Экспорт главы в .docx"), action: () => exportDocx([ch], `${safeFileName(ch.title)}.docx`) },
    ]);
  });
  item.addEventListener("dragstart", (e) => { e.stopPropagation(); dragId = ch.id; });
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

function deleteFolder(folder) {
  // Не трогает содержимое: главы становятся «без папки», вложенные
  // подпапки поднимаются на уровень выше — удаляется только сама
  // папка-контейнер, не то, что в ней лежало.
  for (const c of manuscript.chapters) if (c.folderId === folder.id) c.folderId = null;
  for (const f of manuscript.folders) if (folderParent(f) === folder.id) f.parentId = folderParent(folder);
  manuscript.folders = manuscript.folders.filter((f) => f.id !== folder.id);
  persist();
  draw();
}

function folderContextMenuItems(folder, x, y) {
  const chaptersInFolder = collectFolderChapters(folder.id);
  return [
    {
      label: i18n("Новая глава здесь"),
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
      ],
    },
    { separator: true },
    { label: i18n("Экспорт папки в .md"), action: () => exportMarkdown(chaptersInFolder, `${safeFileName(folder.name)}.md`) },
    { label: i18n("Экспорт папки в .docx"), action: () => exportDocx(chaptersInFolder, `${safeFileName(folder.name)}.docx`) },
    { separator: true },
    {
      label: i18n("Удалить папку"),
      danger: true,
      // Как и везде в приложении — не сразу, второй клик поверх нового
      // меню с одним пунктом-подтверждением (см. board.js/data-panel.js).
      action: () => {
        openContextMenu(x, y, [
          { label: i18n("Точно удалить? Главы и подпапки останутся, без этой папки."), danger: true, action: () => deleteFolder(folder) },
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
  header.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); });
  header.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
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
    { label: i18n("Экспорт всей рукописи в .docx"), action: () => exportDocx() },
  ];
}

function buildChapterList() {
  const list = document.createElement("div");
  list.className = "chapter-list";

  buildFolderTree(list, null, 0);
  for (const ch of manuscript.chapters.filter((c) => !c.folderId)) {
    list.appendChild(buildChapterItem(ch, 0));
  }

  // ПКМ по пустому месту списка (не по конкретной главе/папке — те сами
  // останавливают всплытие в своих обработчиках) — быстрое «+ Глава»/
  // «+ Папка» без похода к кнопкам внизу, как в проводнике файлов.
  list.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY, emptyAreaContextMenuItems());
  });

  const addBtn = document.createElement("button");
  addBtn.className = "add-chapter";
  addBtn.textContent = i18n("+ Глава");
  addBtn.addEventListener("click", () => {
    const c = blankChapter();
    manuscript.chapters.push(c);
    manuscript.activeChapterId = c.id;
    persist();
    draw();
  });
  list.appendChild(addBtn);

  const addFolderBtn = document.createElement("button");
  addFolderBtn.className = "add-chapter";
  addFolderBtn.textContent = i18n("+ Папка");
  addFolderBtn.addEventListener("click", () => {
    manuscript.folders.push(blankFolder());
    persist();
    draw();
  });
  list.appendChild(addFolderBtn);

  return list;
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

  const wc = document.createElement("div");
  wc.className = "word-count";
  const total = manuscript.chapters.reduce((sum, c) => sum + wordCount(c.content), 0);
  wc.textContent = i18n("{count} слов · всего {total}", { count: wordCount(chapter.content), total });
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
    const mentioned = mentionsToHtml(chapter.content, characters);
    view.innerHTML = stickersToHtml(mentioned, chapter.stickies || []) || `<span class="empty-state">${i18n("Глава пуста.")}</span>`;
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
    textarea.placeholder = i18n("Пиши здесь… @имя вставит упоминание персонажа");
    textarea.addEventListener("input", () => {
      chapter.content = textarea.value;
      wc.textContent = i18n("{count} слов · всего {total}", { count: wordCount(chapter.content), total: manuscript.chapters.reduce((s, c) => s + wordCount(c.content), 0) });
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
  const closeBtn = document.createElement("button");
  closeBtn.className = "btn";
  closeBtn.textContent = i18n("Закрыть ×");
  closeBtn.addEventListener("click", () => {
    extrasOpen = false;
    draw();
  });
  closeRow.appendChild(closeBtn);
  panel.appendChild(closeRow);

  const notes = document.createElement("details");
  notes.className = "author-notes";
  notes.open = true;
  const summary = document.createElement("summary");
  summary.textContent = i18n("Заметки");
  notes.appendChild(summary);
  const notesArea = document.createElement("textarea");
  notesArea.value = chapter.authorNotes || "";
  notesArea.placeholder = i18n("Не входит в текст главы и в экспорт.");
  notesArea.addEventListener("input", () => {
    chapter.authorNotes = notesArea.value;
    persist();
  });
  notes.appendChild(notesArea);
  panel.appendChild(notes);

  panel.appendChild(buildStickyEditor(chapter));
  panel.appendChild(buildSnapshots(chapter));

  return panel;
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
    empty.textContent = i18n("Пока нет — правый клик по тексту главы добавит стикер-заметку.");
    details.appendChild(empty);
  }

  for (const sticky of stickies) {
    const row = document.createElement("div");
    row.className = "sticky-editor-row";
    const area = document.createElement("textarea");
    area.className = "sticky-editor-textarea";
    area.value = sticky.text || "";
    area.placeholder = i18n("Текст заметки…");
    area.addEventListener("input", () => { sticky.text = area.value; persist(); });
    row.appendChild(area);

    const delBtn = document.createElement("button");
    delBtn.className = "btn danger";
    delBtn.textContent = "✕";
    delBtn.title = i18n("Удалить стикер (маркер [[note:…]] в тексте останется как обычный текст)");
    delBtn.addEventListener("click", () => {
      chapter.stickies = chapter.stickies.filter((s) => s.id !== sticky.id);
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
    empty.textContent = i18n("Пока нет снимков — кнопка «Снимок» в шапке главы сохранит текущий текст.");
    details.appendChild(empty);
    return details;
  }

  for (const snap of chapter.snapshots) {
    const wrap = document.createElement("div");
    wrap.className = "snapshot-item";

    const row = document.createElement("div");
    row.className = "snapshot-row";

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
    delBtn.textContent = "✕";
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
