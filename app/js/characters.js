import { apiGet, apiPost, uid } from "./api.js";
import { debounceSave } from "./save-badge.js";
import { escapeHtml, characterSelect, buildEmptyState, buildCardFieldsHtml, reorderById, attachCardDrag } from "./chips.js";
import { pushTrash } from "./trash.js";
import { buildReverseLinks } from "./reverse-links.js";
import { loadTagsMap, buildTagsField } from "./tags.js";
import { buildNameGeneratorButton } from "./name-generator.js";
import { avatarInnerHtml, buildAvatarsField } from "./avatars.js";
import { iconSvg } from "./icons.js";
import { loadTemplates, saveTemplates, templateFor, buildFieldHint } from "./templates.js";
import { chooseTemplate } from "./template-choice.js";
import { openTemplateEditorModal } from "./template-editor-modal.js";
import { i18n } from "./i18n.js";

const PALETTE = [
  "#c9944a", "#4f7d74", "#a4483c", "#7d6a9e",
  "#6a8fae", "#9a9250", "#b5636b", "#5a8a5f",
];

let characters = [];
let relationships = [];
let tagsMap = {};
let timeline = [];
let factions = [];
let board = { cards: {} };
let mapData = { maps: {} };
let templates = [];
let activeId = null;
let container = null;
const save = debounceSave((list) => apiPost("/api/characters", list));
const saveRelationships = debounceSave((list) => apiPost("/api/relationships", list));

function persist() {
  save(characters);
}

function persistRelationships() {
  saveRelationships(relationships);
}

function addWithTemplate(templateId) {
  const c = blank(templateId);
  characters.push(c);
  activeId = c.id;
  persist();
  draw();
}

// "+ Новый шаблон…" в меню выбора (template-choice.js) — заводит
// шаблон на лету, не уходя в Настройки → Шаблоны анкет, и сразу же
// создаёт карточку по нему. С полей первого имеющегося шаблона (или
// пустого списка, если шаблонов ещё вовсе нет) — та же отправная
// точка, что у кнопки "+ Шаблон" в самих Настройках.
function addWithNewTemplate() {
  openTemplateEditorModal({
    initialFields: (templates[0]?.fields || []).map((f) => ({ ...f })),
    onSave: async ({ name, fields }) => {
      const fresh = { id: `t_${Date.now().toString(36)}`, name, fields };
      templates = [...templates, fresh];
      await saveTemplates("characters", templates);
      addWithTemplate(fresh.id);
    },
  });
}

function blank(templateId) {
  return {
    id: uid(),
    name: i18n("Новый персонаж"),
    color: PALETTE[characters.length % PALETTE.length],
    tags: "",
    parentIds: [],
    templateId: templateId || templates[0]?.id || "default",
  };
}

function initials(name) {
  return (name || "?").trim().slice(0, 1).toUpperCase();
}

export async function renderCharacters(root, focusId) {
  container = root;
  [characters, relationships, timeline, factions, board, mapData, tagsMap, templates] = await Promise.all([
    apiGet("/api/characters"),
    apiGet("/api/relationships"),
    apiGet("/api/timeline"),
    apiGet("/api/factions"),
    apiGet("/api/board"),
    apiGet("/api/map"),
    loadTagsMap(),
    loadTemplates("characters"),
  ]);
  if (focusId && characters.some((c) => c.id === focusId)) activeId = focusId;
  draw();
}

function childrenOf(c) {
  return characters.filter((x) => (x.parentIds || []).includes(c.id));
}

function reverseLinksFor(c) {
  const relRows = relationships
    .filter((r) => r.charA === c.id || r.charB === c.id)
    .map((r) => {
      const other = characters.find((x) => x.id === (r.charA === c.id ? r.charB : r.charA));
      return other ? `${other.name}${r.label ? " – " + r.label : ""}` : null;
    })
    .filter(Boolean);

  const eventRows = timeline
    .filter((e) => (e.characterIds || []).includes(c.id))
    .map((e) => `${e.title}${e.date ? ` (${e.date})` : ""}`);

  const factionRows = factions
    .filter((f) => f.leaderId === c.id || (f.memberIds || []).includes(c.id))
    .map((f) => `${f.name}${f.leaderId === c.id ? ` (${i18n("глава")})` : ""}`);

  const cardRows = Object.values(board.cards || {})
    .filter((card) => card.characterId === c.id)
    .map((card) => card.title);

  const pinRows = [];
  for (const m of Object.values(mapData.maps || {})) {
    for (const pin of m.pins || []) {
      if (pin.characterId === c.id) pinRows.push(i18n("{label} (карта «{name}»)", { label: pin.label, name: m.name }));
    }
  }

  return buildReverseLinks([
    [i18n("Связи"), relRows],
    [i18n("Таймлайн"), eventRows],
    [i18n("Фракции"), factionRows],
    [i18n("Карточки доски"), cardRows],
    [i18n("Метки на карте"), pinRows],
  ]);
}

function draw() {
  container.innerHTML = "";
  const view = document.createElement("div");
  view.className = "characters-view";

  const grid = document.createElement("div");
  grid.className = "characters-grid";

  if (!characters.length) {
    const empty = buildEmptyState(i18n("Персонажей пока нет – добавь первого."), "user");
    empty.style.gridColumn = "1 / -1";
    grid.appendChild(empty);
  }

  const dragState = { current: null };
  for (const c of characters) {
    const template = templateFor(templates, c.templateId);
    const fields = (template?.fields || []).map((f) => ({ label: f.label, value: c[f.key] }));
    const card = document.createElement("button");
    card.className = "entity-card";
    card.innerHTML = `
      <div class="entity-card-header">
        <div class="entity-card-avatar" style="background:${c.color}">${avatarInnerHtml(c, initials(c.name))}</div>
        <div class="entity-card-heading">
          <div class="char-name">${escapeHtml(c.name || i18n("Без имени"))}</div>
          <div class="char-role">${escapeHtml(c.role || "")}</div>
        </div>
      </div>
      <div class="entity-card-fields">${buildCardFieldsHtml(fields)}</div>
    `;
    card.addEventListener("click", () => { activeId = c.id; draw(); });
    attachCardDrag(card, c.id, dragState, (draggedId, targetId) => {
      characters = reorderById(characters, draggedId, targetId);
      persist();
      draw();
    });
    grid.appendChild(card);
  }

  const addCard = document.createElement("button");
  addCard.className = "entity-card add-card";
  addCard.textContent = i18n("+ Добавить персонажа");
  addCard.title = i18n("Правая кнопка – выбрать шаблон анкеты или завести новый");
  addCard.addEventListener("click", () => {
    chooseTemplate(templates, addCard, addWithTemplate, { onCreateNew: addWithNewTemplate });
  });
  // Правая кнопка форсирует меню выбора шаблона, даже если он пока один —
  // иначе "+ Новый шаблон…" был бы недостижим, пока не заведён хотя бы
  // второй шаблон (см. комментарий в template-choice.js).
  addCard.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    chooseTemplate(templates, addCard, addWithTemplate, { forceMenu: true, onCreateNew: addWithNewTemplate });
  });
  grid.appendChild(addCard);

  view.appendChild(grid);

  const active = characters.find((c) => c.id === activeId);
  if (active) view.appendChild(buildDrawer(active));

  // Дровер теперь модальное окно по центру экрана (style.css, .drawer) —
  // клик по затемнению вокруг него (не по самой панели) закрывает его,
  // как и у обычных модалок в приложении.
  view.addEventListener("click", (e) => {
    if (e.target === view) { activeId = null; draw(); }
  });

  container.appendChild(view);
}

// Мини-редактор связей прямо в карточке персонажа — та же коллекция
// relationships.json, что и редактор ребра по клику в графе проекта
// (graph.js, openEdgeEditor), просто отфильтрованная под текущего
// персонажа, без графа и с возможностью завести новую связь (в графе
// можно только править/удалять уже существующую — новую заводят здесь).
function buildRelationshipsField(c) {
  const wrap = document.createElement("div");
  wrap.className = "field rel-mini-field";
  const label = document.createElement("label");
  label.textContent = i18n("Связи");
  wrap.appendChild(label);

  const list = document.createElement("div");
  list.className = "rel-mini-list";
  wrap.appendChild(list);

  function otherId(rel) {
    return rel.charA === c.id ? rel.charB : rel.charA;
  }

  function renderList() {
    list.innerHTML = "";
    const others = characters.filter((x) => x.id !== c.id);
    for (const rel of relationships.filter((r) => r.charA === c.id || r.charB === c.id)) {
      const row = document.createElement("div");
      row.className = "rel-row rel-mini-row";

      const top = document.createElement("div");
      top.className = "rel-row-top";
      const sel = characterSelect(others, otherId(rel));
      sel.addEventListener("change", () => {
        if (rel.charA === c.id) rel.charB = sel.value;
        else rel.charA = sel.value;
        persistRelationships();
      });
      const labelInput = document.createElement("input");
      labelInput.className = "field-inline-control field-inline-control-bright rel-row-label";
      labelInput.placeholder = i18n("Метка (наставник, вражда…)");
      labelInput.value = rel.label || "";
      labelInput.addEventListener("input", () => { rel.label = labelInput.value; persistRelationships(); });

      const delBtn = document.createElement("button");
      delBtn.className = "btn danger";
      delBtn.innerHTML = iconSvg("close", 12);
      delBtn.addEventListener("click", async () => {
        await pushTrash("relationship", rel);
        relationships = relationships.filter((r) => r.id !== rel.id);
        renderList();
      });
      top.append(sel, labelInput, delBtn);
      row.appendChild(top);

      const sliderRow = document.createElement("div");
      sliderRow.className = "rel-sliders";
      const scoreLabel = document.createElement("span");
      scoreLabel.className = "rel-score-label";
      scoreLabel.textContent = rel.score || 0;
      const slider = document.createElement("input");
      slider.type = "range";
      slider.className = "rel-slider";
      slider.min = -100;
      slider.max = 100;
      slider.value = rel.score || 0;
      slider.addEventListener("input", () => {
        rel.score = Number(slider.value);
        scoreLabel.textContent = rel.score;
        persistRelationships();
      });
      sliderRow.append(scoreLabel, slider);
      row.appendChild(sliderRow);

      list.appendChild(row);
    }
  }
  renderList();

  const addBtn = document.createElement("button");
  addBtn.className = "btn rel-mini-add";
  addBtn.textContent = i18n("+ Добавить связь");
  addBtn.addEventListener("click", () => {
    const other = characters.find((x) => x.id !== c.id);
    if (!other) return;
    relationships.push({ id: uid(), charA: c.id, charB: other.id, label: "", score: 0, note: "" });
    persistRelationships();
    renderList();
  });
  wrap.appendChild(addBtn);

  return wrap;
}

// Родители — тот же набор фишек-переключателей, что и buildToggleGroup
// (chips.js), но не он сам: под выбранными нужна ещё строка чекбоксов
// "приёмный от…", а её состав меняется вместе с самим выбором родителей,
// поэтому обе строки перерисовываются своими локальными функциями, а не
// одним onChange наружу. adoptiveParentIds — подмножество parentIds
// (family-tree.js рисует эту связь пунктиром, а не сплошной линией).
function buildParentsField(c) {
  const field = document.createElement("div");
  field.className = "field";
  const label = document.createElement("label");
  label.textContent = i18n("Родители");
  field.appendChild(label);

  const chipsRow = document.createElement("div");
  chipsRow.className = "timeline-filter-bar";
  field.appendChild(chipsRow);

  const adoptRow = document.createElement("div");
  adoptRow.className = "parent-adopt-row";
  field.appendChild(adoptRow);

  function renderAdopt() {
    adoptRow.innerHTML = "";
    for (const pid of c.parentIds || []) {
      const p = characters.find((x) => x.id === pid);
      if (!p) continue;
      const chip = document.createElement("label");
      chip.className = "parent-adopt-chip";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = (c.adoptiveParentIds || []).includes(pid);
      checkbox.addEventListener("change", () => {
        const ids = new Set(c.adoptiveParentIds || []);
        if (checkbox.checked) ids.add(pid);
        else ids.delete(pid);
        c.adoptiveParentIds = [...ids];
        persist();
      });
      const text = document.createElement("span");
      text.textContent = i18n("приёмный от {name}", { name: p.name || i18n("Без имени") });
      chip.append(checkbox, text);
      adoptRow.appendChild(chip);
    }
  }

  function renderChips() {
    chipsRow.innerHTML = "";
    for (const other of characters.filter((x) => x.id !== c.id)) {
      const active = (c.parentIds || []).includes(other.id);
      const chip = document.createElement("button");
      chip.className = "filter-chip" + (active ? " active" : "");
      chip.style.setProperty("--chip-color", other.color || "#7c7157");
      chip.textContent = other.name || i18n("Без имени");
      chip.addEventListener("click", () => {
        const ids = new Set(c.parentIds || []);
        if (ids.has(other.id)) {
          ids.delete(other.id);
          c.adoptiveParentIds = (c.adoptiveParentIds || []).filter((id) => id !== other.id);
        } else {
          ids.add(other.id);
        }
        c.parentIds = [...ids];
        persist();
        renderChips();
        renderAdopt();
      });
      chipsRow.appendChild(chip);
    }
  }
  renderChips();
  renderAdopt();

  return field;
}

// Партнёры/супруги — симметричная связь: добавили B партнёром A, у B
// тоже должен появиться A, иначе family-tree.js не сможет нарисовать
// пару как одну ячейку (там читается partnerIds обеих сторон). Раз оба
// объекта — это ссылки на элементы одного и того же characters (не
// копии), правка other.partnerIds и один persist() пишут обе стороны
// разом, без отдельного запроса за "другим" персонажем.
function buildPartnersField(c) {
  const field = document.createElement("div");
  field.className = "field";
  const label = document.createElement("label");
  label.textContent = i18n("Партнёры / супруги");
  field.appendChild(label);

  const row = document.createElement("div");
  row.className = "timeline-filter-bar";
  field.appendChild(row);

  function render() {
    row.innerHTML = "";
    for (const other of characters.filter((x) => x.id !== c.id)) {
      const active = (c.partnerIds || []).includes(other.id);
      const chip = document.createElement("button");
      chip.className = "filter-chip" + (active ? " active" : "");
      chip.style.setProperty("--chip-color", other.color || "#7c7157");
      chip.textContent = other.name || i18n("Без имени");
      chip.addEventListener("click", () => {
        const cIds = new Set(c.partnerIds || []);
        const oIds = new Set(other.partnerIds || []);
        if (cIds.has(other.id)) {
          cIds.delete(other.id);
          oIds.delete(c.id);
        } else {
          cIds.add(other.id);
          oIds.add(c.id);
        }
        c.partnerIds = [...cIds];
        other.partnerIds = [...oIds];
        persist();
        render();
      });
      row.appendChild(chip);
    }
    if (characters.length <= 1) {
      const none = document.createElement("span");
      none.className = "filter-count";
      none.textContent = i18n("пока нет");
      row.appendChild(none);
    }
  }
  render();

  return field;
}

function buildDrawer(c) {
  const drawer = document.createElement("div");
  drawer.className = "drawer";

  const nameRow = document.createElement("div");
  nameRow.className = "drawer-name-row";
  const nameField = document.createElement("input");
  nameField.value = c.name;
  nameField.className = "drawer-name-field";
  nameField.addEventListener("input", () => {
    c.name = nameField.value;
    updateCardLive();
    persist();
  });
  nameRow.appendChild(nameField);
  nameRow.appendChild(
    buildNameGeneratorButton((name) => {
      nameField.value = name;
      c.name = name;
      updateCardLive();
      persist();
    })
  );
  drawer.appendChild(nameRow);

  const colorRow = document.createElement("div");
  colorRow.className = "color-row";
  colorRow.style.marginTop = "12px";
  for (const color of PALETTE) {
    const sw = document.createElement("div");
    sw.className = "swatch" + (c.color === color ? " selected" : "");
    sw.style.background = color;
    sw.addEventListener("click", () => {
      c.color = color;
      persist();
      draw();
    });
    colorRow.appendChild(sw);
  }
  drawer.appendChild(colorRow);

  drawer.appendChild(buildAvatarsField(c, () => { persist(); draw(); }));

  drawer.appendChild(buildParentsField(c));
  drawer.appendChild(buildPartnersField(c));

  const kids = childrenOf(c);
  if (kids.length) {
    const kidsField = document.createElement("div");
    kidsField.className = "field";
    const kidsLabel = document.createElement("label");
    kidsLabel.textContent = i18n("Дети");
    kidsField.appendChild(kidsLabel);
    const kidsValue = document.createElement("div");
    kidsValue.className = "readonly-value";
    kidsValue.textContent = kids.map((k) => k.name || i18n("Без имени")).join(", ");
    kidsField.appendChild(kidsValue);
    drawer.appendChild(kidsField);
  }

  drawer.appendChild(buildRelationshipsField(c));

  const template = templateFor(templates, c.templateId);
  for (const f of template?.fields || []) {
    const field = document.createElement("div");
    field.className = "field";
    const lab = document.createElement("label");
    lab.textContent = f.label;
    field.appendChild(lab);
    const hint = buildFieldHint(f.type);
    if (hint) field.appendChild(hint);
    const input = document.createElement(f.type === "input" ? "input" : "textarea");
    input.value = c[f.key] || "";
    input.addEventListener("input", () => {
      c[f.key] = input.value;
      persist();
    });
    field.appendChild(input);
    drawer.appendChild(field);
  }

  drawer.appendChild(
    buildTagsField(tagsMap, c.tags, (value) => {
      c.tags = value;
      persist();
    })
  );

  const reverse = reverseLinksFor(c);
  if (reverse) drawer.appendChild(reverse);

  const actions = document.createElement("div");
  actions.className = "drawer-actions";
  const closeBtn = document.createElement("button");
  closeBtn.className = "btn";
  closeBtn.textContent = i18n("Закрыть");
  closeBtn.addEventListener("click", () => {
    activeId = null;
    draw();
  });
  const delBtn = document.createElement("button");
  delBtn.className = "btn danger";
  delBtn.textContent = i18n("Удалить");
  delBtn.addEventListener("click", async () => {
    await pushTrash("character", c);
    characters = characters.filter((x) => x.id !== c.id);
    activeId = null;
    persist();
    draw();
  });
  actions.append(closeBtn, delBtn);
  drawer.appendChild(actions);

  function updateCardLive() {
    // Заголовок карточки в сетке слева обновляется только при полной
    // перерисовке — она недёшева на каждый keystroke, поэтому имя в
    // самой карточке подтягивается уже при следующем draw() (открытии/
    // закрытии дровера), а не посимвольно.
  }

  return drawer;
}
