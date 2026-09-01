import { apiGet, apiPost, uid } from "./api.js";
import { debounceSave } from "./save-badge.js";
import { escapeHtml } from "./chips.js";
import { mentionsToHtml, attachMentionAutocomplete, attachMentionHoverPreview } from "./mentions.js";
import { stickersToHtml, attachStickyPopover } from "./stickies.js";
import { buildManuscriptDocx } from "./docx.js";
import { openContextMenu } from "./context-menu.js";
import { i18n } from "./i18n.js";

const STATUSES = [
  ["draft", "Черновик"],
  ["editing", "На редактуре"],
  ["done", "Готово"],
];

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
let container = null;
let syncFontSizeDisplay = null; // обновляет число в шапке редактора без полной перерисовки — ставит buildEditor()
const save = debounceSave((data) => apiPost("/api/manuscript", data));

function persist() {
  save(manuscript);
}

const SNAPSHOT_LIMIT = 20;

function blankChapter() {
  return { id: uid(), title: i18n("Новая глава"), content: "", status: "draft", authorNotes: "", stickies: [], snapshots: [] };
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
  const sticky = { id: uid(), text: "" };
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
          action: () => setFontSize(size).then((v) => syncFontSizeDisplay?.(v)),
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
  const [manuscriptData, charactersData, siteSettings] = await Promise.all([
    apiGet("/api/manuscript"),
    apiGet("/api/characters"),
    apiGet("/api/site-settings").catch(() => ({})),
  ]);
  manuscript = manuscriptData;
  characters = charactersData;
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

  container.appendChild(view);
}

function buildChapterList() {
  const list = document.createElement("div");
  list.className = "chapter-list";

  let dragId = null;

  for (const ch of manuscript.chapters) {
    const item = document.createElement("div");
    item.className = "chapter-item" + (ch.id === manuscript.activeChapterId ? " active" : "");
    item.draggable = true;
    item.innerHTML = `
      <span class="status-dot status-${ch.status}"></span>
      <span>${escapeHtml(ch.title || i18n("Без названия"))}</span>
    `;
    item.addEventListener("click", () => {
      manuscript.activeChapterId = ch.id;
      draw();
    });
    item.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY, [
        {
          label: i18n("Статус"),
          items: STATUSES.map(([key, name]) => ({
            label: i18n(name),
            checked: ch.status === key,
            action: () => {
              ch.status = key;
              persist();
              draw();
            },
          })),
        },
        { separator: true },
        { label: i18n("Экспорт главы в .md"), action: () => exportMarkdown([ch], `${safeFileName(ch.title)}.md`) },
        { label: i18n("Экспорт главы в .docx"), action: () => exportDocx([ch], `${safeFileName(ch.title)}.docx`) },
      ]);
    });
    item.addEventListener("dragstart", () => { dragId = ch.id; });
    item.addEventListener("dragover", (e) => e.preventDefault());
    item.addEventListener("drop", (e) => {
      e.preventDefault();
      if (dragId === null || dragId === ch.id) return;
      const from = manuscript.chapters.findIndex((c) => c.id === dragId);
      const to = manuscript.chapters.findIndex((c) => c.id === ch.id);
      const [moved] = manuscript.chapters.splice(from, 1);
      manuscript.chapters.splice(to, 0, moved);
      persist();
      draw();
    });
    list.appendChild(item);
  }

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

  const exportBtn = document.createElement("button");
  exportBtn.className = "add-chapter";
  exportBtn.textContent = i18n("Экспорт в .md");
  exportBtn.addEventListener("click", exportMarkdown);
  list.appendChild(exportBtn);

  const exportDocxBtn = document.createElement("button");
  exportDocxBtn.className = "add-chapter";
  exportDocxBtn.textContent = i18n("Экспорт в .docx");
  exportDocxBtn.addEventListener("click", exportDocx);
  list.appendChild(exportDocxBtn);

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

  const statusSelect = document.createElement("select");
  for (const [value, label] of STATUSES) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = i18n(label);
    if (chapter.status === value) opt.selected = true;
    statusSelect.appendChild(opt);
  }
  statusSelect.style.cssText =
    "background:var(--panel-alt);border:1px solid var(--border);color:var(--text-dim);border-radius:6px;padding:6px 10px;font-family:inherit;font-size:0.82rem;";
  statusSelect.addEventListener("change", () => {
    chapter.status = statusSelect.value;
    persist();
    draw();
  });
  header.appendChild(statusSelect);

  const modeBtn = document.createElement("button");
  modeBtn.className = "btn";
  modeBtn.textContent = viewMode ? i18n("Правка") : i18n("Просмотр");
  modeBtn.addEventListener("click", () => {
    viewMode = !viewMode;
    draw();
  });
  header.appendChild(modeBtn);

  const focusBtn = document.createElement("button");
  focusBtn.className = "btn";
  focusBtn.title = focusMode ? i18n("Выйти из фокус-режима (Esc)") : i18n("Фокус-режим — скрыть сайдбар и список глав");
  focusBtn.textContent = focusMode ? "⤢" : "⛶";
  focusBtn.addEventListener("click", () => {
    focusMode = !focusMode;
    draw();
  });
  header.appendChild(focusBtn);

  // Свободный ввод числа — раньше было всего 6 фиксированных размеров
  // на выбор, теперь любое значение в разумных пределах (FONT_SIZE_MIN/
  // MAX), плюс те же пресеты доступны через ПКМ в самом тексте (см.
  // attachEditorContextMenu) — как размер шрифта обычно и предлагают
  // менять текстовые редакторы.
  const fontSizeWrap = document.createElement("div");
  fontSizeWrap.className = "font-size-row";
  fontSizeWrap.title = i18n("Размер шрифта в тексте главы");

  const sizeMinus = document.createElement("button");
  sizeMinus.className = "btn font-size-step";
  sizeMinus.textContent = "−";
  sizeMinus.addEventListener("click", () => setFontSize(editorFontSize - 1).then((v) => (sizeInput.value = v)));

  const sizeInput = document.createElement("input");
  sizeInput.type = "number";
  sizeInput.className = "font-size-input";
  sizeInput.min = String(FONT_SIZE_MIN);
  sizeInput.max = String(FONT_SIZE_MAX);
  sizeInput.value = editorFontSize;
  sizeInput.addEventListener("change", () => setFontSize(sizeInput.valueAsNumber).then((v) => (sizeInput.value = v)));

  const sizePlus = document.createElement("button");
  sizePlus.className = "btn font-size-step";
  sizePlus.textContent = "+";
  sizePlus.addEventListener("click", () => setFontSize(editorFontSize + 1).then((v) => (sizeInput.value = v)));

  syncFontSizeDisplay = (v) => (sizeInput.value = v);

  fontSizeWrap.append(sizeMinus, sizeInput, sizePlus);
  header.appendChild(fontSizeWrap);

  const snapshotBtn = document.createElement("button");
  snapshotBtn.className = "btn";
  snapshotBtn.textContent = i18n("Снимок");
  snapshotBtn.title = i18n("Сохранить текущий текст как снимок версии (до 20 на главу)");
  snapshotBtn.addEventListener("click", () => {
    const snapshot = { id: uid(), content: chapter.content, savedAt: new Date().toISOString() };
    chapter.snapshots = [snapshot, ...(chapter.snapshots || [])].slice(0, SNAPSHOT_LIMIT);
    persist();
    draw();
  });
  header.appendChild(snapshotBtn);

  const wc = document.createElement("div");
  wc.className = "word-count";
  const total = manuscript.chapters.reduce((sum, c) => sum + wordCount(c.content), 0);
  wc.textContent = i18n("{count} слов · всего {total}", { count: wordCount(chapter.content), total });
  header.appendChild(wc);

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
    wrap.style.cssText = "position:relative;flex:1;display:flex;overflow:hidden;";
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

    const stickyBtn = document.createElement("button");
    stickyBtn.className = "btn sticky-insert-btn";
    stickyBtn.textContent = i18n("📌 Стикер");
    stickyBtn.title = i18n("Вставить инлайн-заметку в текст");
    stickyBtn.addEventListener("click", () => insertSticky(textarea, chapter));
    wrap.appendChild(stickyBtn);
    pane.appendChild(wrap);
  }

  const notes = document.createElement("details");
  notes.className = "author-notes";
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
  pane.appendChild(notes);

  if (!viewMode && (chapter.stickies || []).length) {
    pane.appendChild(buildStickyEditor(chapter));
  }

  pane.appendChild(buildSnapshots(chapter));

  return pane;
}

function buildStickyEditor(chapter) {
  const details = document.createElement("details");
  details.className = "author-notes";
  details.open = true;
  const summary = document.createElement("summary");
  summary.textContent = i18n("Стикеры ({n})", { n: chapter.stickies.length });
  details.appendChild(summary);

  for (const sticky of chapter.stickies) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:6px;align-items:flex-start;margin-top:8px;";
    const area = document.createElement("textarea");
    area.value = sticky.text || "";
    area.placeholder = i18n("Текст заметки…");
    area.style.cssText =
      "flex:1;background:none;border:1px solid var(--border);border-radius:6px;color:var(--text-dim);font-family:inherit;font-size:0.85rem;padding:6px 8px;resize:vertical;min-height:34px;";
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
    empty.style.cssText = "color:var(--text-faint);font-size:0.82rem;margin-top:8px;";
    empty.textContent = i18n("Пока нет снимков — кнопка «Снимок» в шапке главы сохранит текущий текст.");
    details.appendChild(empty);
    return details;
  }

  for (const snap of chapter.snapshots) {
    const wrap = document.createElement("div");
    wrap.style.marginTop = "8px";

    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:10px;";

    const date = document.createElement("span");
    date.style.cssText = "font-family:'JetBrains Mono',monospace;font-size:0.75rem;color:var(--text-faint);";
    date.textContent = new Date(snap.savedAt).toLocaleString();
    row.appendChild(date);

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:6px;";

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
  const items = container.querySelectorAll(".chapter-item span:last-child");
  manuscript.chapters.forEach((ch, i) => {
    if (items[i]) items[i].textContent = ch.title || i18n("Без названия");
  });
}
