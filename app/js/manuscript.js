import { apiGet, apiPost, uid } from "./api.js";
import { debounceSave } from "./save-badge.js";
import { escapeHtml } from "./chips.js";
import { mentionsToHtml, attachMentionAutocomplete, attachMentionHoverPreview } from "./mentions.js";
import { stickersToHtml, attachStickyPopover } from "./stickies.js";
import { buildManuscriptDocx } from "./docx.js";

const STATUSES = [
  ["draft", "Черновик"],
  ["editing", "На редактуре"],
  ["done", "Готово"],
];

let manuscript = { chapters: [], activeChapterId: null };
let characters = [];
let viewMode = false;
let focusMode = false;
let container = null;
const save = debounceSave((data) => apiPost("/api/manuscript", data));

function persist() {
  save(manuscript);
}

const SNAPSHOT_LIMIT = 20;

function blankChapter() {
  return { id: uid(), title: "Новая глава", content: "", status: "draft", authorNotes: "", stickies: [], snapshots: [] };
}

function wordCount(text) {
  const m = (text || "").trim().match(/\S+/g);
  return m ? m.length : 0;
}

// Заметки автора не входят — они и на сайте, и здесь предназначены для
// самого пишущего, а не для читателя итогового текста.
function exportMarkdown() {
  const body = manuscript.chapters
    .map((ch) => `# ${ch.title || "Без названия"}\n\n${ch.content || ""}`)
    .join("\n\n---\n\n");
  const blob = new Blob([body], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "manuscript.md";
  a.click();
  URL.revokeObjectURL(url);
}

function exportDocx() {
  const bytes = buildManuscriptDocx(manuscript.chapters);
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "manuscript.docx";
  a.click();
  URL.revokeObjectURL(url);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && focusMode) {
    focusMode = false;
    draw();
  }
});

export async function renderManuscript(root, focusChapterId) {
  container = root;
  focusMode = false; // модуль всегда открывается в обычном виде, фокус — временное состояние сессии просмотра
  [manuscript, characters] = await Promise.all([apiGet("/api/manuscript"), apiGet("/api/characters")]);
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
      <span>${escapeHtml(ch.title || "Без названия")}</span>
    `;
    item.addEventListener("click", () => {
      manuscript.activeChapterId = ch.id;
      draw();
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
  addBtn.textContent = "+ Глава";
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
  exportBtn.textContent = "Экспорт в .md";
  exportBtn.addEventListener("click", exportMarkdown);
  list.appendChild(exportBtn);

  const exportDocxBtn = document.createElement("button");
  exportDocxBtn.className = "add-chapter";
  exportDocxBtn.textContent = "Экспорт в .docx";
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
    empty.textContent = "Выбери или создай главу.";
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
    opt.textContent = label;
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
  modeBtn.textContent = viewMode ? "Правка" : "Просмотр";
  modeBtn.addEventListener("click", () => {
    viewMode = !viewMode;
    draw();
  });
  header.appendChild(modeBtn);

  const focusBtn = document.createElement("button");
  focusBtn.className = "btn";
  focusBtn.title = focusMode ? "Выйти из фокус-режима (Esc)" : "Фокус-режим — скрыть сайдбар и список глав";
  focusBtn.textContent = focusMode ? "⤢" : "⛶";
  focusBtn.addEventListener("click", () => {
    focusMode = !focusMode;
    draw();
  });
  header.appendChild(focusBtn);

  const snapshotBtn = document.createElement("button");
  snapshotBtn.className = "btn";
  snapshotBtn.textContent = "Снимок";
  snapshotBtn.title = "Сохранить текущий текст как снимок версии (до 20 на главу)";
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
  wc.textContent = `${wordCount(chapter.content)} слов · всего ${total}`;
  header.appendChild(wc);

  pane.appendChild(header);

  if (viewMode) {
    const view = document.createElement("div");
    view.className = "chapter-content chapter-content-view";
    const mentioned = mentionsToHtml(chapter.content, characters);
    view.innerHTML = stickersToHtml(mentioned, chapter.stickies || []) || '<span class="empty-state">Глава пуста.</span>';
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
    textarea.placeholder = "Пиши здесь… @имя вставит упоминание персонажа";
    textarea.addEventListener("input", () => {
      chapter.content = textarea.value;
      wc.textContent = `${wordCount(chapter.content)} слов · всего ${manuscript.chapters.reduce((s, c) => s + wordCount(c.content), 0)}`;
      persist();
    });
    wrap.appendChild(textarea);
    attachMentionAutocomplete(textarea, () => characters);

    const stickyBtn = document.createElement("button");
    stickyBtn.className = "btn sticky-insert-btn";
    stickyBtn.textContent = "📌 Стикер";
    stickyBtn.title = "Вставить инлайн-заметку в текст";
    stickyBtn.addEventListener("click", () => {
      const sticky = { id: uid(), text: "" };
      chapter.stickies = [...(chapter.stickies || []), sticky];
      const pos = textarea.selectionStart;
      const marker = `[[note:${sticky.id}]]`;
      textarea.value = textarea.value.slice(0, pos) + marker + textarea.value.slice(pos);
      chapter.content = textarea.value;
      persist();
      draw();
    });
    wrap.appendChild(stickyBtn);
    pane.appendChild(wrap);
  }

  const notes = document.createElement("details");
  notes.className = "author-notes";
  const summary = document.createElement("summary");
  summary.textContent = "Заметки автора";
  notes.appendChild(summary);
  const notesArea = document.createElement("textarea");
  notesArea.value = chapter.authorNotes || "";
  notesArea.placeholder = "Не входит в текст главы и в экспорт.";
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
  summary.textContent = `Стикеры (${chapter.stickies.length})`;
  details.appendChild(summary);

  for (const sticky of chapter.stickies) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:6px;align-items:flex-start;margin-top:8px;";
    const area = document.createElement("textarea");
    area.value = sticky.text || "";
    area.placeholder = "Текст заметки…";
    area.style.cssText =
      "flex:1;background:none;border:1px solid var(--border);border-radius:6px;color:var(--text-dim);font-family:inherit;font-size:0.85rem;padding:6px 8px;resize:vertical;min-height:34px;";
    area.addEventListener("input", () => { sticky.text = area.value; persist(); });
    row.appendChild(area);

    const delBtn = document.createElement("button");
    delBtn.className = "btn danger";
    delBtn.textContent = "✕";
    delBtn.title = "Удалить стикер (маркер [[note:…]] в тексте останется как обычный текст)";
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
  summary.textContent = `Снимки версий (${(chapter.snapshots || []).length})`;
  details.appendChild(summary);

  if (!(chapter.snapshots || []).length) {
    const empty = document.createElement("div");
    empty.style.cssText = "color:var(--text-faint);font-size:0.82rem;margin-top:8px;";
    empty.textContent = "Пока нет снимков — кнопка «Снимок» в шапке главы сохранит текущий текст.";
    details.appendChild(empty);
    return details;
  }

  for (const snap of chapter.snapshots) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:8px;";

    const date = document.createElement("span");
    date.style.cssText = "font-family:'JetBrains Mono',monospace;font-size:0.75rem;color:var(--text-faint);";
    date.textContent = new Date(snap.savedAt).toLocaleString();
    row.appendChild(date);

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:6px;";

    const restoreBtn = document.createElement("button");
    restoreBtn.className = "btn";
    restoreBtn.textContent = "Восстановить";
    restoreBtn.addEventListener("click", () => {
      if (restoreBtn.dataset.confirm === "1") {
        chapter.content = snap.content;
        persist();
        draw();
        return;
      }
      restoreBtn.dataset.confirm = "1";
      restoreBtn.textContent = "Заменит текущий текст. Точно?";
      setTimeout(() => { restoreBtn.dataset.confirm = ""; restoreBtn.textContent = "Восстановить"; }, 4000);
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
    details.appendChild(row);
  }

  return details;
}

function refreshChapterListTitles() {
  const items = container.querySelectorAll(".chapter-item span:last-child");
  manuscript.chapters.forEach((ch, i) => {
    if (items[i]) items[i].textContent = ch.title || "Без названия";
  });
}
