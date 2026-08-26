import { apiGet, apiPost, uid } from "./api.js";
import { debounceSave } from "./save-badge.js";
import { escapeHtml } from "./chips.js";
import { mentionsToHtml, attachMentionAutocomplete } from "./mentions.js";

const STATUSES = [
  ["draft", "Черновик"],
  ["editing", "На редактуре"],
  ["done", "Готово"],
];

let manuscript = { chapters: [], activeChapterId: null };
let characters = [];
let viewMode = false;
let container = null;
const save = debounceSave((data) => apiPost("/api/manuscript", data));

function persist() {
  save(manuscript);
}

function blankChapter() {
  return { id: uid(), title: "Новая глава", content: "", status: "draft", authorNotes: "" };
}

function wordCount(text) {
  const m = (text || "").trim().match(/\S+/g);
  return m ? m.length : 0;
}

export async function renderManuscript(root) {
  container = root;
  [manuscript, characters] = await Promise.all([apiGet("/api/manuscript"), apiGet("/api/characters")]);
  if (!manuscript.chapters.length) {
    const c = blankChapter();
    manuscript.chapters = [c];
    manuscript.activeChapterId = c.id;
    persist();
  }
  if (!manuscript.activeChapterId) manuscript.activeChapterId = manuscript.chapters[0]?.id || null;
  draw();
}

function draw() {
  container.innerHTML = "";
  const view = document.createElement("div");
  view.className = "manuscript-view";

  view.appendChild(buildChapterList());
  view.appendChild(buildEditor());

  container.appendChild(view);
}

function buildChapterList() {
  const list = document.createElement("div");
  list.className = "chapter-list";

  for (const ch of manuscript.chapters) {
    const item = document.createElement("div");
    item.className = "chapter-item" + (ch.id === manuscript.activeChapterId ? " active" : "");
    item.innerHTML = `
      <span class="status-dot status-${ch.status}"></span>
      <span>${escapeHtml(ch.title || "Без названия")}</span>
    `;
    item.addEventListener("click", () => {
      manuscript.activeChapterId = ch.id;
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

  const wc = document.createElement("div");
  wc.className = "word-count";
  const total = manuscript.chapters.reduce((sum, c) => sum + wordCount(c.content), 0);
  wc.textContent = `${wordCount(chapter.content)} слов · всего ${total}`;
  header.appendChild(wc);

  pane.appendChild(header);

  if (viewMode) {
    const view = document.createElement("div");
    view.className = "chapter-content chapter-content-view";
    view.innerHTML = mentionsToHtml(chapter.content, characters) || '<span class="empty-state">Глава пуста.</span>';
    view.addEventListener("click", (e) => {
      const charId = e.target.dataset?.charId;
      if (charId) document.dispatchEvent(new CustomEvent("fictaris:open-character", { detail: { id: charId } }));
    });
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

  return pane;
}

function refreshChapterListTitles() {
  const items = container.querySelectorAll(".chapter-item span:last-child");
  manuscript.chapters.forEach((ch, i) => {
    if (items[i]) items[i].textContent = ch.title || "Без названия";
  });
}
