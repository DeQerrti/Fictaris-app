import { apiGet, apiPost, uid } from "./api.js";
import { debounceSave } from "./save-badge.js";
import { openContextMenu } from "./context-menu.js";
import { buildEmptyState } from "./chips.js";
import { iconSvg } from "./icons.js";
import { i18n } from "./i18n.js";

// ══════════════════════════════════════════════
//  ЗНАНИЯ — кто из персонажей что знает и с какой главы
//
//  По мотивам глобальных переменных/условий articy:expresso: там это
//  флаги, управляющие ветвлением игры. У романа нет веток, но есть та
//  же головная боль — "с какой главы Надя вообще в курсе про
//  пророчество?" — и её так же легко перепутать при правках задним
//  числом. Разбирать саму прозу на предмет "уже знает или ещё нет" —
//  ненадёжная эвристика (как и обсуждали для склонений в mentions.js);
//  вместо этого — структурированный список: факт → для каждого
//  персонажа, если применимо, глава, с которой это стало ему известно.
//  Не автоматическая проверка текста, а справочник для самого автора и
//  несколько дешёвых структурных сверок (continuity.js): не
//  расставленные главы, ссылки на удалённых персонажей/главы.
//
//  Один факт — сразу несколько персонажей: "Пророчество" у Нади с
//  главы 7, у Вилы — с самого начала истории, у Асты — ещё никогда.
//  Порядок глав — это порядок в manuscript.chapters (как и everywhere
//  в самой рукописи, специального номера у главы нет).
// ══════════════════════════════════════════════

export const KNOWS_FROM_START = "__start__";

let facts = [];
let characters = [];
let chapters = [];
let container = null;
const save = debounceSave(() => apiPost("/api/knowledge", { facts }));
function persist() {
  save();
}

function blankFact() {
  return { id: uid(), label: i18n("Новый факт"), note: "", entries: {} };
}

export async function renderKnowledge(root) {
  container = root;
  const [data, charactersData, manuscript] = await Promise.all([
    apiGet("/api/knowledge"),
    apiGet("/api/characters"),
    apiGet("/api/manuscript"),
  ]);
  facts = Array.isArray(data.facts) ? data.facts : [];
  characters = charactersData;
  chapters = manuscript.chapters || [];
  draw();
}

function draw() {
  container.innerHTML = "";
  const view = document.createElement("div");
  view.className = "knowledge-view";

  const intro = document.createElement("p");
  intro.className = "knowledge-intro";
  intro.textContent = i18n("Факт мира и для каждого причастного персонажа — глава, с которой это стало ему известно. Свериться при редактуре: никто не должен знать раньше своей главы.");
  view.appendChild(intro);

  const list = document.createElement("div");
  list.className = "knowledge-list";

  if (!facts.length) {
    const empty = buildEmptyState(i18n("Пока нет ни одного факта — добавь первый."), "lightbulb");
    list.appendChild(empty);
  }

  for (const fact of facts) list.appendChild(buildFactCard(fact));
  view.appendChild(list);

  const addBtn = document.createElement("button");
  addBtn.className = "btn";
  addBtn.textContent = i18n("+ Факт");
  addBtn.addEventListener("click", () => {
    facts.push(blankFact());
    persist();
    draw();
  });
  view.appendChild(addBtn);

  container.appendChild(view);
}

function buildFactCard(fact) {
  const card = document.createElement("div");
  card.className = "knowledge-card";

  const head = document.createElement("div");
  head.className = "knowledge-card-head";
  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.className = "drawer-name-field";
  labelInput.value = fact.label || "";
  labelInput.addEventListener("input", () => {
    fact.label = labelInput.value;
    persist();
  });
  head.appendChild(labelInput);

  const delBtn = document.createElement("button");
  delBtn.className = "btn danger shortcut-clear";
  delBtn.innerHTML = iconSvg("trash", 14);
  delBtn.title = i18n("Удалить факт");
  delBtn.addEventListener("click", () => {
    facts = facts.filter((f) => f !== fact);
    persist();
    draw();
  });
  head.appendChild(delBtn);
  card.appendChild(head);

  const noteArea = document.createElement("textarea");
  noteArea.className = "knowledge-note";
  noteArea.placeholder = i18n("Заметка о факте (необязательно)…");
  noteArea.value = fact.note || "";
  noteArea.addEventListener("input", () => {
    fact.note = noteArea.value;
    persist();
  });
  card.appendChild(noteArea);

  const rows = document.createElement("div");
  rows.className = "knowledge-rows";
  const entryIds = Object.keys(fact.entries || {});
  for (const charId of entryIds) {
    const c = characters.find((x) => x.id === charId);
    rows.appendChild(buildEntryRow(fact, charId, c));
  }
  if (!entryIds.length) {
    const none = document.createElement("div");
    none.className = "knowledge-empty-row";
    none.textContent = i18n("Пока ни один персонаж не отмечен.");
    rows.appendChild(none);
  }
  card.appendChild(rows);

  const addCharBtn = document.createElement("button");
  addCharBtn.className = "btn";
  addCharBtn.textContent = i18n("+ Персонаж");
  addCharBtn.addEventListener("click", () => {
    const available = characters.filter((c) => !(c.id in (fact.entries || {})));
    if (!available.length) return;
    const rect = addCharBtn.getBoundingClientRect();
    openContextMenu(
      rect.left,
      rect.bottom + 4,
      available.map((c) => ({
        label: c.name || i18n("Без имени"),
        action: () => {
          fact.entries = { ...fact.entries, [c.id]: "" };
          persist();
          draw();
        },
      }))
    );
  });
  card.appendChild(addCharBtn);

  return card;
}

function buildEntryRow(fact, charId, character) {
  const row = document.createElement("div");
  row.className = "knowledge-row";

  const name = document.createElement("span");
  name.className = "knowledge-row-name";
  name.textContent = character ? character.name || i18n("Без имени") : i18n("(удалённый персонаж)");
  if (character?.color) name.style.color = character.color;
  row.appendChild(name);

  const select = document.createElement("select");
  select.className = "field-inline-control";
  const noneOpt = document.createElement("option");
  noneOpt.value = "";
  noneOpt.textContent = i18n("— глава не выбрана —");
  select.appendChild(noneOpt);
  const startOpt = document.createElement("option");
  startOpt.value = KNOWS_FROM_START;
  startOpt.textContent = i18n("С самого начала истории");
  select.appendChild(startOpt);
  for (const ch of chapters) {
    const opt = document.createElement("option");
    opt.value = ch.id;
    opt.textContent = ch.title || i18n("Без названия");
    select.appendChild(opt);
  }
  select.value = fact.entries[charId] || "";
  select.addEventListener("change", () => {
    fact.entries = { ...fact.entries, [charId]: select.value };
    persist();
  });
  row.appendChild(select);

  const removeBtn = document.createElement("button");
  removeBtn.className = "btn danger shortcut-clear";
  removeBtn.textContent = "×";
  removeBtn.title = i18n("Убрать персонажа из этого факта");
  removeBtn.addEventListener("click", () => {
    const next = { ...fact.entries };
    delete next[charId];
    fact.entries = next;
    persist();
    draw();
  });
  row.appendChild(removeBtn);

  return row;
}

// ── Проверки для continuity.js ───────────────────
// Чистые функции над уже загруженными данными — тот же контракт, что
// у остальных проверок в continuity.js (brokenRefs, orphans и т.п.).
export function knowledgeIssues({ knowledge, characters, manuscript }) {
  const chars = new Set(characters.map((c) => c.id));
  const chaps = new Set((manuscript.chapters || []).map((c) => c.id));
  const issues = [];
  for (const fact of knowledge.facts || []) {
    for (const [charId, chapterId] of Object.entries(fact.entries || {})) {
      const charName = characters.find((c) => c.id === charId)?.name;
      if (!chars.has(charId)) {
        issues.push(i18n("Факт «{label}» ссылается на несуществующего персонажа", { label: fact.label || "?" }));
        continue;
      }
      if (!chapterId) {
        issues.push(i18n("Факт «{label}»: у «{name}» не выбрана глава", { label: fact.label || "?", name: charName || "?" }));
      } else if (chapterId !== KNOWS_FROM_START && !chaps.has(chapterId)) {
        issues.push(i18n("Факт «{label}»: у «{name}» указана удалённая глава", { label: fact.label || "?", name: charName || "?" }));
      }
    }
  }
  return issues;
}
