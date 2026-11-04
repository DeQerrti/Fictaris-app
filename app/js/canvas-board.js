import { uid } from "./api.js";
import { escapeHtml } from "./chips.js";
import { iconSvg } from "./icons.js";
import { i18n, i18nPlural } from "./i18n.js";
import { chapterLabel } from "./books.js";
import { sectionHeading, buildNone, buildSelect, autoGrow, openEntity } from "./entity-view.js";

// ══════════════════════════════════════════════
//  ХОЛСТ — САМА ДОСКА
//
//  Бесконечное поле: карточки, стрелки между ними, группы-рамки.
//  Щелчок выбирает (Shift — добавить к выбранному), перетаскивание
//  фона — рамка выбора, перетаскивание выбранного — сдвиг всех разом.
//  Двойной щелчок по полю — новая карточка, по карточке — правка текста.
//  Стрелку тянут из точки на краю карточки: отпустили на другой — связь,
//  на пустом месте — новая карточка, уже связанная. Справа — свойства
//  выбранного вместо меню правой кнопки. Ctrl+Z / Ctrl+Shift+Z — отмена
//  и повтор, Delete — удалить, пробел или правая кнопка — двигать поле.
//
//  Данные — те же canvas.json → canvases[id]: cards, edges и groups
//  (рамки { id, x, y, w, h, title, color }).
// ══════════════════════════════════════════════

export const CARD_COLORS = [null, "#c9944a", "#4f7d74", "#a4483c", "#7d6a9e", "#6a8fae", "#5a8a5f"];
const MIN_W = 140;
const MIN_H = 70;
const MIN_SCALE = 0.2;
const MAX_SCALE = 2.5;
const SVG_NS = "http://www.w3.org/2000/svg";

// История отмены — на холст, переживает перерисовку экрана.
const histories = new Map();
// Масштаб и сдвиг — тоже на холст, только на время работы.
const views = new Map();

export function blankCard(x, y) {
  return { id: uid(), x, y, w: 220, h: 130, text: "", title: "", chapterId: null, color: null };
}

function cardBox(c) {
  return { x: c.x, y: c.y, w: c.w || 220, h: c.h || 130 };
}

// Точка на краю карточки, ближайшем к другой, и направление выхода.
function anchor(a, b) {
  const A = cardBox(a);
  const B = cardBox(b);
  const dx = B.x + B.w / 2 - (A.x + A.w / 2);
  const dy = B.y + B.h / 2 - (A.y + A.h / 2);
  if (Math.abs(dx) * A.h > Math.abs(dy) * A.w) {
    return dx > 0 ? { x: A.x + A.w, y: A.y + A.h / 2, nx: 1, ny: 0 } : { x: A.x, y: A.y + A.h / 2, nx: -1, ny: 0 };
  }
  return dy > 0 ? { x: A.x + A.w / 2, y: A.y + A.h, nx: 0, ny: 1 } : { x: A.x + A.w / 2, y: A.y, nx: 0, ny: -1 };
}

// Плавная стрелка от края к краю; mid — середина кривой для подписи.
export function edgeGeometry(a, b) {
  const p = anchor(a, b);
  const q = anchor(b, a);
  const k = Math.min(90, Math.hypot(q.x - p.x, q.y - p.y) / 2.5);
  const c1 = { x: p.x + p.nx * k, y: p.y + p.ny * k };
  const c2 = { x: q.x + q.nx * k, y: q.y + q.ny * k };
  const mid = {
    x: 0.125 * p.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * q.x,
    y: 0.125 * p.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * q.y,
  };
  return { p, q, c1, c2, mid, d: `M${p.x},${p.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${q.x},${q.y}` };
}

// ctx — что даёт canvas.js: cv (холст), chapters, books, persist(),
// onBack(), focusCardId, onRename().
export function buildBoard(ctx) {
  const { cv } = ctx;
  if (!Array.isArray(cv.groups)) cv.groups = [];
  if (!histories.has(cv.id)) histories.set(cv.id, { undo: [], redo: [] });
  const history = histories.get(cv.id);

  // Выбор: карточки и рамки — множеством, стрелка — одна.
  let selCards = new Set();
  let selGroups = new Set();
  let selEdge = null;
  let editingId = null;
  let tool = "select";
  let spaceDown = false;

  const pane = document.createElement("div");
  pane.className = "characters-pane cboard";

  // ── Шапка
  const bar = document.createElement("div");
  bar.className = "timeline-toolbar";
  const back = document.createElement("button");
  back.className = "btn";
  back.textContent = i18n("← Все холсты");
  back.addEventListener("click", ctx.onBack);
  const nameInput = document.createElement("input");
  nameInput.className = "cboard-name";
  nameInput.value = cv.name || "";
  nameInput.placeholder = i18n("Название холста");
  nameInput.addEventListener("input", () => {
    cv.name = nameInput.value;
    ctx.persist();
  });
  const meta = document.createElement("div");
  meta.className = "timeline-meta";
  bar.append(back, nameInput, meta);
  pane.appendChild(bar);

  // ── Поле
  const stage = document.createElement("div");
  stage.className = "cboard-stage";
  const world = document.createElement("div");
  world.className = "cboard-world";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.classList.add("cboard-svg");
  const layer = document.createElement("div");
  layer.className = "cboard-layer";
  world.append(svg, layer);
  const marquee = document.createElement("div");
  marquee.className = "cboard-marquee";
  marquee.hidden = true;
  stage.append(world, marquee);
  pane.appendChild(stage);

  const side = document.createElement("aside");
  side.className = "cboard-side";
  stage.appendChild(side);

  // ── Вид
  let view = views.get(cv.id) || null;
  const applyView = () => {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    zoomLabel.textContent = `${Math.round(view.scale * 100)}%`;
  };
  const toWorld = (clientX, clientY) => {
    const r = stage.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.scale, y: (clientY - r.top - view.y) / view.scale };
  };
  const zoomAt = (factor, sx, sy) => {
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
    view.x = sx - ((sx - view.x) * scale) / view.scale;
    view.y = sy - ((sy - view.y) * scale) / view.scale;
    view.scale = scale;
    applyView();
  };
  const bounds = () => {
    const boxes = [...cv.cards.map(cardBox), ...cv.groups];
    if (!boxes.length) return null;
    const x1 = Math.min(...boxes.map((b) => b.x));
    const y1 = Math.min(...boxes.map((b) => b.y));
    const x2 = Math.max(...boxes.map((b) => b.x + b.w));
    const y2 = Math.max(...boxes.map((b) => b.y + b.h));
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  };
  const fit = () => {
    const r = stage.getBoundingClientRect();
    const b = bounds();
    if (!b || !r.width) {
      view = { x: r.width / 2, y: r.height / 2, scale: 1 };
    } else {
      const scale = Math.min(1.2, Math.max(MIN_SCALE, Math.min((r.width - 120) / b.w, (r.height - 140) / b.h)));
      view = { scale, x: r.width / 2 - (b.x + b.w / 2) * scale, y: r.height / 2 - (b.y + b.h / 2) * scale };
    }
    views.set(cv.id, view);
    applyView();
  };
  const centerOn = (c) => {
    const r = stage.getBoundingClientRect();
    const b = cardBox(c);
    view.x = r.width / 2 - (b.x + b.w / 2) * view.scale;
    view.y = r.height / 2 - (b.y + b.h / 2) * view.scale;
    applyView();
  };

  // ── История
  const snapshot = () => JSON.stringify({ cards: cv.cards, edges: cv.edges, groups: cv.groups });
  const remember = () => {
    history.undo.push(snapshot());
    if (history.undo.length > 80) history.undo.shift();
    history.redo.length = 0;
  };
  const restore = (text) => {
    const s = JSON.parse(text);
    cv.cards = s.cards;
    cv.edges = s.edges;
    cv.groups = s.groups || [];
  };
  const undo = () => {
    if (!history.undo.length) return;
    history.redo.push(snapshot());
    restore(history.undo.pop());
    clearSelection();
    changed();
  };
  const redo = () => {
    if (!history.redo.length) return;
    history.undo.push(snapshot());
    restore(history.redo.pop());
    clearSelection();
    changed();
  };
  // Одна запись в историю на всю серию правок поля ввода, а не на
  // каждую букву: первая правка после фокуса — remember().
  const rememberOnce = (input) => {
    let done = false;
    input.addEventListener("focus", () => { done = false; });
    return () => {
      if (!done) {
        remember();
        done = true;
      }
    };
  };

  const changed = () => {
    ctx.persist();
    renderScene();
    renderSide();
  };
  const clearSelection = () => {
    selCards = new Set();
    selGroups = new Set();
    selEdge = null;
    editingId = null;
  };

  // ── Сцена
  function renderScene() {
    meta.textContent = [
      i18nPlural(cv.cards.length, ["{n} карточка", "{n} карточки", "{n} карточек"]),
      cv.edges.length ? i18nPlural(cv.edges.length, ["{n} стрелка", "{n} стрелки", "{n} стрелок"]) : "",
      cv.groups.length ? i18nPlural(cv.groups.length, ["{n} группа", "{n} группы", "{n} групп"]) : "",
    ].filter(Boolean).join(" · ");
    undoBtn.disabled = !history.undo.length;
    redoBtn.disabled = !history.redo.length;

    svg.innerHTML = `<defs><marker id="cboard-arrow-${cv.id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--accent)"/></marker></defs>`;
    layer.innerHTML = "";
    const byId = new Map(cv.cards.map((c) => [c.id, c]));

    for (const g of cv.groups) {
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", g.x);
      rect.setAttribute("y", g.y);
      rect.setAttribute("width", g.w);
      rect.setAttribute("height", g.h);
      rect.setAttribute("rx", 14);
      rect.classList.add("cboard-group");
      rect.style.setProperty("--group-color", g.color || "var(--accent)");
      svg.appendChild(rect);
      const tab = document.createElement("div");
      tab.className = "cboard-group-title";
      tab.dataset.group = g.id;
      tab.style.left = `${g.x + 14}px`;
      tab.style.top = `${g.y - 12}px`;
      tab.style.setProperty("--group-color", g.color || "var(--accent)");
      tab.textContent = g.title || i18n("Группа");
      layer.appendChild(tab);
      const handle = document.createElement("div");
      handle.className = "cboard-resize cboard-group-resize";
      handle.dataset.resizeGroup = g.id;
      handle.style.left = `${g.x + g.w - 8}px`;
      handle.style.top = `${g.y + g.h - 8}px`;
      layer.appendChild(handle);
    }

    const labels = [];
    for (const e of cv.edges) {
      const a = byId.get(e.fromId);
      const b = byId.get(e.toId);
      if (!a || !b) continue;
      const geo = edgeGeometry(a, b);
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", geo.d);
      path.classList.add("cboard-edge");
      path.dataset.edgeId = e.id;
      path.setAttribute("marker-end", `url(#cboard-arrow-${cv.id})`);
      svg.appendChild(path);
      const hit = document.createElementNS(SVG_NS, "path");
      hit.setAttribute("d", geo.d);
      hit.classList.add("cboard-edge-hit");
      hit.dataset.edge = e.id;
      svg.appendChild(hit);
      if (e.label) {
        // Подписи — поверх карточек: между соседними карточками иначе их не видно.
        const label = document.createElement("div");
        label.className = "cboard-edge-label";
        label.dataset.edge = e.id;
        label.style.left = `${geo.mid.x}px`;
        label.style.top = `${geo.mid.y}px`;
        label.textContent = e.label;
        labels.push(label);
      }
    }

    for (const c of cv.cards) layer.appendChild(buildCard(c));
    layer.append(...labels);
    markSelection();
  }

  // Выбор меняет только классы — без перерисовки, иначе узел под
  // курсором подменяется между щелчками и двойной щелчок не доходит.
  function markSelection() {
    layer.querySelectorAll("[data-card]").forEach((el) => el.classList.toggle("selected", selCards.has(el.dataset.card)));
    layer.querySelectorAll(".cboard-group-title").forEach((el) => el.classList.toggle("selected", selGroups.has(el.dataset.group)));
    layer.querySelectorAll("[data-resize-group]").forEach((el) => el.classList.toggle("selected", selGroups.has(el.dataset.resizeGroup)));
    svg.querySelectorAll(".cboard-group").forEach((el, i) => el.classList.toggle("selected", selGroups.has(cv.groups[i]?.id)));
    svg.querySelectorAll(".cboard-edge:not(.cboard-edge-ghost)").forEach((el) => el.classList.toggle("selected", el.dataset.edgeId === selEdge));
    layer.querySelectorAll(".cboard-edge-label").forEach((el) => el.classList.toggle("selected", el.dataset.edge === selEdge));
    stage.classList.toggle("single", selCards.size === 1 && !selGroups.size);
    stage.classList.toggle("single-group", selGroups.size === 1 && !selCards.size);
  }

  function buildCard(c) {
    const b = cardBox(c);
    const el = document.createElement("div");
    el.className = "cboard-card" + (c.color ? " colored" : "");
    el.dataset.card = c.id;
    el.style.left = `${b.x}px`;
    el.style.top = `${b.y}px`;
    el.style.width = `${b.w}px`;
    el.style.height = `${b.h}px`;
    if (c.color) el.style.setProperty("--card-color", c.color);

    if (editingId === c.id) {
      const title = document.createElement("input");
      title.className = "cboard-card-title-input";
      title.placeholder = i18n("Заголовок");
      title.value = c.title || "";
      const text = document.createElement("textarea");
      text.className = "cboard-card-text-input";
      text.placeholder = i18n("Текст карточки");
      text.value = c.text || "";
      const once = rememberOnce(title);
      const once2 = rememberOnce(text);
      title.addEventListener("input", () => { once(); c.title = title.value; ctx.persist(); });
      text.addEventListener("input", () => { once2(); c.text = text.value; ctx.persist(); });
      // Ушли из обоих полей — правка кончилась.
      const finish = () => setTimeout(() => {
        if (el.contains(document.activeElement)) return;
        if (editingId === c.id) {
          editingId = null;
          renderScene();
          renderSide();
        }
      }, 0);
      title.addEventListener("blur", finish);
      text.addEventListener("blur", finish);
      for (const input of [title, text]) {
        input.addEventListener("keydown", (e) => {
          if (e.key === "Escape") input.blur();
          if (e.key === "Enter" && input === title) text.focus();
        });
      }
      el.append(title, text);
      setTimeout(() => (c.text || c.title ? text : title).focus(), 0);
    } else {
      if (c.title) {
        const t = document.createElement("div");
        t.className = "cboard-card-title";
        t.textContent = c.title;
        el.appendChild(t);
      }
      const body = document.createElement("div");
      body.className = "cboard-card-text";
      body.textContent = c.text || "";
      if (!c.text && !c.title) {
        body.classList.add("empty");
        body.textContent = i18n("Двойной щелчок – написать");
      }
      el.appendChild(body);
      const linked = c.chapterId ? ctx.chapters.find((ch) => ch.id === c.chapterId) : null;
      const chapterText = linked ? chapterLabel(linked, ctx.books) : c.chapterLabel;
      if (chapterText) {
        const chip = document.createElement(linked ? "button" : "span");
        chip.className = "cboard-chip";
        chip.innerHTML = `${iconSvg("manuscript", 11)}<span>${escapeHtml(chapterText)}</span>`;
        if (linked) {
          chip.title = i18n("Открыть главу");
          chip.dataset.openChapter = linked.id;
        }
        el.appendChild(chip);
      }
    }

    // Точки для стрелок — по краям; рычажок размера — у одной выбранной.
    for (const side of ["top", "right", "bottom", "left"]) {
      const port = document.createElement("span");
      port.className = `cboard-port ${side}`;
      port.dataset.port = c.id;
      port.title = i18n("Тяните к другой карточке – стрелка; на пустое место – новая карточка");
      el.appendChild(port);
    }
    // Видно только у единственной выбранной (CSS: .cboard-stage.single).
    if (editingId !== c.id) {
      const handle = document.createElement("span");
      handle.className = "cboard-resize";
      handle.dataset.resizeCard = c.id;
      el.appendChild(handle);
    }
    return el;
  }

  // ── Панель свойств
  const field = (label, control) => {
    const row = document.createElement("label");
    row.className = "cboard-field";
    const span = document.createElement("span");
    span.textContent = label;
    row.append(span, control);
    side.appendChild(row);
    return row;
  };
  const colorRow = (current, onPick) => {
    const row = document.createElement("div");
    row.className = "color-row cboard-colors";
    for (const color of CARD_COLORS) {
      const sw = document.createElement("div");
      sw.className = "swatch" + (color ? "" : " swatch-none") + ((current || null) === color ? " selected" : "");
      if (color) sw.style.background = color;
      sw.title = color ? "" : i18n("Без цвета");
      sw.addEventListener("click", () => onPick(color));
      row.appendChild(sw);
    }
    return row;
  };
  const deleteButton = (label) => {
    const del = document.createElement("button");
    del.className = "btn danger cboard-delete";
    del.innerHTML = `${iconSvg("trash", 14)}<span>${escapeHtml(label)}</span>`;
    del.addEventListener("click", removeSelection);
    side.appendChild(del);
  };

  function renderSide() {
    side.innerHTML = "";
    const cards = cv.cards.filter((c) => selCards.has(c.id));
    const groups = cv.groups.filter((g) => selGroups.has(g.id));
    const edge = cv.edges.find((e) => e.id === selEdge);
    side.hidden = !cards.length && !groups.length && !edge;
    if (side.hidden) return;

    if (cards.length === 1 && !groups.length) {
      const c = cards[0];
      side.appendChild(sectionHeading(i18n("Карточка")));
      const title = document.createElement("input");
      title.className = "characters-search";
      title.value = c.title || "";
      title.placeholder = i18n("Без заголовка");
      const once = rememberOnce(title);
      title.addEventListener("input", () => { once(); c.title = title.value; ctx.persist(); renderScene(); });
      field(i18n("Заголовок"), title);
      const text = document.createElement("textarea");
      text.className = "cboard-textarea";
      text.rows = 3;
      text.value = c.text || "";
      text.placeholder = i18n("Текст карточки");
      autoGrow(text);
      const once2 = rememberOnce(text);
      text.addEventListener("input", () => { once2(); c.text = text.value; ctx.persist(); renderScene(); });
      field(i18n("Текст"), text);
      const chapterOptions = [["", "– не привязана –"], ...ctx.chapters.map((ch) => [ch.id, chapterLabel(ch, ctx.books)])];
      const chapter = buildSelect(chapterOptions, c.chapterId || "", (value) => {
        remember();
        c.chapterId = value || null;
        if (value) c.chapterLabel = "";
        changed();
      }, "kin-kind-select cboard-select");
      field(i18n("Глава"), chapter);
      field(i18n("Цвет"), colorRow(c.color, (color) => {
        remember();
        c.color = color;
        changed();
      }));
      side.appendChild(sectionHeading(i18n("Связи")));
      const touching = cv.edges.filter((e) => e.fromId === c.id || e.toId === c.id);
      for (const e of touching) {
        const other = cv.cards.find((x) => x.id === (e.fromId === c.id ? e.toId : e.fromId));
        if (!other) continue;
        const row = document.createElement("button");
        row.className = "dossier-link-row";
        row.innerHTML = `<span class="dossier-row-icon">${e.fromId === c.id ? "→" : "←"}</span><span class="dossier-link-text">${escapeHtml(other.title || (other.text || "").slice(0, 30) || i18n("Без заголовка"))}</span>${e.label ? `<small>${escapeHtml(e.label)}</small>` : ""}`;
        row.addEventListener("click", () => {
          clearSelection();
          selCards.add(other.id);
          renderScene();
          renderSide();
          centerOn(other);
        });
        side.appendChild(row);
      }
      if (!touching.length) side.appendChild(buildNone(i18n("Тяните стрелку из точки на краю карточки")));
      deleteButton(i18n("Удалить карточку"));
      return;
    }

    if (edge && !cards.length && !groups.length) {
      side.appendChild(sectionHeading(i18n("Стрелка")));
      const label = document.createElement("input");
      label.className = "characters-search cboard-edge-input";
      label.value = edge.label || "";
      label.placeholder = i18n("Подпись (необязательно)");
      const once = rememberOnce(label);
      label.addEventListener("input", () => { once(); edge.label = label.value; ctx.persist(); renderScene(); });
      field(i18n("Подпись"), label);
      const flip = document.createElement("button");
      flip.className = "btn cboard-wide";
      flip.textContent = i18n("Развернуть стрелку");
      flip.addEventListener("click", () => {
        remember();
        [edge.fromId, edge.toId] = [edge.toId, edge.fromId];
        changed();
      });
      side.appendChild(flip);
      deleteButton(i18n("Удалить стрелку"));
      return;
    }

    if (groups.length === 1 && !cards.length) {
      const g = groups[0];
      side.appendChild(sectionHeading(i18n("Группа")));
      const title = document.createElement("input");
      title.className = "characters-search";
      title.value = g.title || "";
      title.placeholder = i18n("Группа");
      const once = rememberOnce(title);
      title.addEventListener("input", () => { once(); g.title = title.value; ctx.persist(); renderScene(); });
      field(i18n("Название"), title);
      field(i18n("Цвет"), colorRow(g.color, (color) => {
        remember();
        g.color = color;
        changed();
      }));
      side.appendChild(buildNone(i18n("Тяните за название – рамка поедет вместе с карточками внутри")));
      deleteButton(i18n("Убрать рамку"));
      return;
    }

    // Несколько сразу
    side.appendChild(sectionHeading(i18n("Выбрано: {n}", { n: cards.length + groups.length })));
    if (cards.length) {
      field(i18n("Цвет карточек"), colorRow(null, (color) => {
        remember();
        for (const c of cards) c.color = color;
        changed();
      }));
      const group = document.createElement("button");
      group.className = "btn cboard-wide";
      group.textContent = i18n("Объединить в группу");
      group.addEventListener("click", () => groupSelection());
      side.appendChild(group);
    }
    deleteButton(i18n("Удалить выбранное"));
  }

  // ── Действия
  function addCardAt(x, y, edit = true) {
    remember();
    const card = blankCard(Math.round(x - 110), Math.round(y - 65));
    cv.cards.push(card);
    clearSelection();
    selCards.add(card.id);
    if (edit) editingId = card.id;
    changed();
    return card;
  }

  function groupSelection() {
    remember();
    const boxes = [...cv.cards.filter((c) => selCards.has(c.id)).map(cardBox), ...cv.groups.filter((g) => selGroups.has(g.id))];
    let g;
    if (boxes.length) {
      const pad = 30;
      const x1 = Math.min(...boxes.map((b) => b.x)) - pad;
      const y1 = Math.min(...boxes.map((b) => b.y)) - pad;
      const x2 = Math.max(...boxes.map((b) => b.x + b.w)) + pad;
      const y2 = Math.max(...boxes.map((b) => b.y + b.h)) + pad;
      g = { id: uid(), x: x1, y: y1, w: x2 - x1, h: y2 - y1, title: i18n("Группа"), color: null };
    } else {
      const r = stage.getBoundingClientRect();
      const c = toWorld(r.left + r.width / 2, r.top + r.height / 2);
      g = { id: uid(), x: Math.round(c.x - 220), y: Math.round(c.y - 140), w: 440, h: 280, title: i18n("Группа"), color: null };
    }
    cv.groups.push(g);
    clearSelection();
    selGroups.add(g.id);
    changed();
  }

  function removeSelection() {
    if (!selCards.size && !selGroups.size && !selEdge) return;
    remember();
    cv.cards = cv.cards.filter((c) => !selCards.has(c.id));
    cv.edges = cv.edges.filter((e) => e.id !== selEdge && !selCards.has(e.fromId) && !selCards.has(e.toId));
    cv.groups = cv.groups.filter((g) => !selGroups.has(g.id));
    clearSelection();
    changed();
  }

  // Карточки, чей центр внутри рамки, — едут вместе с ней.
  function cardsInside(g) {
    return cv.cards.filter((c) => {
      const b = cardBox(c);
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      return cx > g.x && cx < g.x + g.w && cy > g.y && cy < g.y + g.h;
    });
  }

  // ── Нажатия
  let gesture = null;
  const pointers = new Map();

  stage.addEventListener("pointerdown", (e) => {
    if (!view || e.target.closest(".cboard-side, .cboard-bar, input, textarea, select")) return;
    if (e.target.closest(".cboard-chip[data-open-chapter]")) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {
      // указатель уже отпущен (бывает у пера и при быстром щелчке)
    }
    const pt = toWorld(e.clientX, e.clientY);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { kind: "pinch", dist: Math.hypot(a.x - b.x, a.y - b.y) };
      return;
    }
    const panning = e.button === 1 || e.button === 2 || spaceDown || tool === "hand";
    if (panning) {
      gesture = { kind: "pan", x: e.clientX, y: e.clientY };
      stage.classList.add("panning");
      return;
    }
    const port = e.target.closest("[data-port]");
    if (port) {
      gesture = { kind: "connect", fromId: port.dataset.port, start: pt };
      return;
    }
    const resizeCard = e.target.closest("[data-resize-card]");
    const resizeGroup = e.target.closest("[data-resize-group]");
    if (resizeCard || resizeGroup) {
      const item = resizeCard ? cv.cards.find((c) => c.id === resizeCard.dataset.resizeCard) : cv.groups.find((g) => g.id === resizeGroup.dataset.resizeGroup);
      const b = resizeCard ? cardBox(item) : item;
      gesture = { kind: "resize", item, start: pt, w: b.w, h: b.h, moved: false, isCard: Boolean(resizeCard) };
      return;
    }
    const cardEl = e.target.closest("[data-card]");
    const groupEl = e.target.closest("[data-group]");
    const edgeEl = e.target.closest("[data-edge]");
    if (cardEl || groupEl) {
      const id = cardEl ? cardEl.dataset.card : groupEl.dataset.group;
      // clearSelection() заводит новые множества — берём их заново.
      const set = () => (cardEl ? selCards : selGroups);
      if (e.shiftKey) {
        if (set().has(id)) set().delete(id);
        else set().add(id);
      } else if (!set().has(id)) {
        clearSelection();
        set().add(id);
      }
      selEdge = null;
      if (editingId && editingId !== id) editingId = null;
      // Что поедет: выбранные карточки и рамки, а с рамкой — то, что внутри.
      const moving = new Map();
      for (const c of cv.cards) if (selCards.has(c.id)) moving.set(c, { x: c.x, y: c.y });
      for (const g of cv.groups) {
        if (!selGroups.has(g.id)) continue;
        moving.set(g, { x: g.x, y: g.y });
        for (const c of cardsInside(g)) if (!moving.has(c)) moving.set(c, { x: c.x, y: c.y });
      }
      gesture = { kind: "move", start: pt, moving, moved: false };
      markSelection();
      renderSide();
      return;
    }
    if (edgeEl) {
      clearSelection();
      selEdge = edgeEl.dataset.edge;
      gesture = null;
      markSelection();
      renderSide();
      return;
    }
    // Пустое место — рамка выбора.
    gesture = { kind: "marquee", start: pt, sx: e.clientX, sy: e.clientY, add: e.shiftKey, moved: false };
  });

  stage.addEventListener("pointermove", (e) => {
    if (!gesture) return;
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pt = toWorld(e.clientX, e.clientY);
    const r = stage.getBoundingClientRect();
    if (gesture.kind === "pinch" && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt(dist / gesture.dist, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      gesture.dist = dist;
    } else if (gesture.kind === "pan") {
      view.x += e.clientX - gesture.x;
      view.y += e.clientY - gesture.y;
      gesture.x = e.clientX;
      gesture.y = e.clientY;
      applyView();
    } else if (gesture.kind === "move") {
      const dx = pt.x - gesture.start.x;
      const dy = pt.y - gesture.start.y;
      if (!gesture.moved && Math.hypot(dx, dy) * view.scale < 4) return;
      if (!gesture.moved) {
        remember();
        gesture.moved = true;
        if (editingId) editingId = null;
      }
      for (const [item, from] of gesture.moving) {
        item.x = Math.round(from.x + dx);
        item.y = Math.round(from.y + dy);
      }
      renderScene();
    } else if (gesture.kind === "resize") {
      if (!gesture.moved) {
        remember();
        gesture.moved = true;
      }
      const item = gesture.item;
      item.w = Math.max(gesture.isCard ? MIN_W : 200, Math.round(gesture.w + pt.x - gesture.start.x));
      item.h = Math.max(gesture.isCard ? MIN_H : 120, Math.round(gesture.h + pt.y - gesture.start.y));
      renderScene();
    } else if (gesture.kind === "connect") {
      const from = cv.cards.find((c) => c.id === gesture.fromId);
      const b = cardBox(from);
      const ghost = { x: pt.x - 1, y: pt.y - 1, w: 2, h: 2 };
      const geo = edgeGeometry({ ...b }, ghost);
      let line = svg.querySelector(".cboard-edge-ghost");
      if (!line) {
        line = document.createElementNS(SVG_NS, "path");
        line.classList.add("cboard-edge", "cboard-edge-ghost");
        line.setAttribute("marker-end", `url(#cboard-arrow-${cv.id})`);
        svg.appendChild(line);
      }
      line.setAttribute("d", geo.d);
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-card]");
      layer.querySelectorAll(".cboard-card.drop-target").forEach((x) => x.classList.remove("drop-target"));
      if (over && over.dataset.card !== gesture.fromId) over.classList.add("drop-target");
    } else if (gesture.kind === "marquee") {
      const x = Math.min(e.clientX, gesture.sx) - r.left;
      const y = Math.min(e.clientY, gesture.sy) - r.top;
      const w = Math.abs(e.clientX - gesture.sx);
      const h = Math.abs(e.clientY - gesture.sy);
      if (!gesture.moved && w + h < 6) return;
      gesture.moved = true;
      marquee.hidden = false;
      Object.assign(marquee.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
      const x1 = Math.min(pt.x, gesture.start.x);
      const y1 = Math.min(pt.y, gesture.start.y);
      const x2 = Math.max(pt.x, gesture.start.x);
      const y2 = Math.max(pt.y, gesture.start.y);
      const inside = (b) => b.x >= x1 && b.y >= y1 && b.x + b.w <= x2 && b.y + b.h <= y2;
      if (!gesture.add) clearSelection();
      gesture.base ||= { cards: new Set(selCards), groups: new Set(selGroups) };
      selCards = new Set([...gesture.base.cards, ...cv.cards.filter((c) => inside(cardBox(c))).map((c) => c.id)]);
      selGroups = new Set([...gesture.base.groups, ...cv.groups.filter(inside).map((g) => g.id)]);
      markSelection();
    }
  });

  const endGesture = (e) => {
    pointers.delete(e.pointerId);
    const g = gesture;
    if (pointers.size === 0) gesture = null;
    stage.classList.remove("panning");
    if (!g) return;
    if (g.kind === "move" || g.kind === "resize") {
      if (g.moved) ctx.persist();
      renderSide();
    } else if (g.kind === "connect") {
      svg.querySelector(".cboard-edge-ghost")?.remove();
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-card]");
      const pt = toWorld(e.clientX, e.clientY);
      if (over && over.dataset.card !== g.fromId) {
        const toId = over.dataset.card;
        if (!cv.edges.some((x) => x.fromId === g.fromId && x.toId === toId)) {
          remember();
          const edge = { id: uid(), fromId: g.fromId, toId, label: "" };
          cv.edges.push(edge);
          clearSelection();
          selEdge = edge.id;
          changed();
          side.querySelector(".cboard-edge-input")?.focus();
        }
      } else if (!over && Math.hypot(pt.x - g.start.x, pt.y - g.start.y) > 40) {
        // На пустое место — новая карточка, сразу со стрелкой к ней.
        remember();
        const card = blankCard(Math.round(pt.x - 110), Math.round(pt.y - 65));
        cv.cards.push(card);
        cv.edges.push({ id: uid(), fromId: g.fromId, toId: card.id, label: "" });
        clearSelection();
        selCards.add(card.id);
        editingId = card.id;
        changed();
      } else {
        renderScene();
      }
    } else if (g.kind === "marquee") {
      marquee.hidden = true;
      if (!g.moved && !g.add) {
        const wasEditing = editingId;
        clearSelection();
        if (wasEditing) renderScene();
      }
      markSelection();
      renderSide();
    }
  };
  stage.addEventListener("pointerup", endGesture);
  stage.addEventListener("pointercancel", endGesture);
  stage.addEventListener("contextmenu", (e) => e.preventDefault());

  stage.addEventListener("wheel", (e) => {
    if (!view || e.target.closest(".cboard-side")) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  stage.addEventListener("dblclick", (e) => {
    if (e.target.closest(".cboard-side, .cboard-bar, input, textarea")) return;
    const cardEl = e.target.closest("[data-card]");
    if (cardEl) {
      editingId = cardEl.dataset.card;
      renderScene();
      return;
    }
    const edgeEl = e.target.closest("[data-edge]");
    if (edgeEl) {
      side.querySelector(".cboard-edge-input")?.focus();
      return;
    }
    if (e.target.closest("[data-group]")) {
      side.querySelector("input")?.focus();
      return;
    }
    const pt = toWorld(e.clientX, e.clientY);
    addCardAt(pt.x, pt.y);
  });

  layer.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-open-chapter]");
    if (chip) openEntity("chapter", chip.dataset.openChapter);
  });

  // ── Нижняя панель
  const tools = document.createElement("div");
  tools.className = "cboard-bar";
  const toolBtn = (key, label, svgPath) => {
    const b = document.createElement("button");
    b.className = "cboard-tool" + (tool === key ? " active" : "");
    b.title = label;
    b.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${svgPath}</svg>`;
    b.addEventListener("click", () => {
      tool = key;
      tools.querySelectorAll(".cboard-tool").forEach((x) => x.classList.toggle("active", x === b));
      stage.classList.toggle("hand", tool === "hand");
    });
    return b;
  };
  const action = (label, onClick, title) => {
    const b = document.createElement("button");
    b.className = "cboard-action";
    b.innerHTML = label;
    if (title) b.title = title;
    b.addEventListener("click", onClick);
    return b;
  };
  const sep = () => {
    const s = document.createElement("span");
    s.className = "cboard-sep";
    return s;
  };
  const undoBtn = action("↶", undo, i18n("Отменить (Ctrl+Z)"));
  const redoBtn = action("↷", redo, i18n("Повторить (Ctrl+Shift+Z)"));
  const zoomLabel = document.createElement("span");
  zoomLabel.className = "cboard-zoom";
  tools.append(
    toolBtn("select", i18n("Выбор (V)"), '<path d="M5 3l14 8-6 2-2 6z"/>'),
    toolBtn("hand", i18n("Рука – двигать поле (H, пробел)"), '<path d="M7 11V5a1.5 1.5 0 0 1 3 0v5m0-6a1.5 1.5 0 0 1 3 0v6m0-5a1.5 1.5 0 0 1 3 0v6m0-3a1.5 1.5 0 0 1 3 0v5a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-3l-3-5a1.5 1.5 0 0 1 2.5-1.6L7 13"/>'),
    sep(),
    action(escapeHtml(i18n("+ Карточка")), () => {
      const r = stage.getBoundingClientRect();
      const c = toWorld(r.left + r.width / 2, r.top + r.height / 2);
      addCardAt(c.x, c.y);
    }),
    action(escapeHtml(i18n("Группа")), () => groupSelection(), i18n("Рамка вокруг выбранного или пустая")),
    sep(),
    undoBtn,
    redoBtn,
    sep(),
    action("−", () => { const r = stage.getBoundingClientRect(); zoomAt(1 / 1.2, r.width / 2, r.height / 2); }, i18n("Уменьшить")),
    zoomLabel,
    action("+", () => { const r = stage.getBoundingClientRect(); zoomAt(1.2, r.width / 2, r.height / 2); }, i18n("Увеличить")),
    action(iconSvg("focus", 14), fit, i18n("Вписать")),
  );
  stage.appendChild(tools);

  const hint = document.createElement("div");
  hint.className = "map-hint cboard-hint";
  hint.textContent = i18n("Двойной щелчок – новая карточка · тяните фон – выделить · пробел или правая кнопка – двигать поле");
  stage.appendChild(hint);

  // ── Клавиши
  const onKey = (e) => {
    if (!pane.isConnected) {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keyup", onKeyUp);
      return;
    }
    if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && key === "y") {
      e.preventDefault();
      redo();
    } else if (mod && key === "a") {
      e.preventDefault();
      selCards = new Set(cv.cards.map((c) => c.id));
      selGroups = new Set(cv.groups.map((g) => g.id));
      selEdge = null;
      renderScene();
      renderSide();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeSelection();
    } else if (e.key === "Escape") {
      clearSelection();
      renderScene();
      renderSide();
    } else if (e.key === " ") {
      e.preventDefault();
      spaceDown = true;
      stage.classList.add("hand");
    } else if (!mod && (key === "v" || key === "м")) {
      tools.querySelector(".cboard-tool")?.click();
    } else if (!mod && (key === "h" || key === "р")) {
      tools.querySelectorAll(".cboard-tool")[1]?.click();
    }
  };
  const onKeyUp = (e) => {
    if (e.key === " ") {
      spaceDown = false;
      stage.classList.toggle("hand", tool === "hand");
    }
  };
  document.addEventListener("keydown", onKey);
  document.addEventListener("keyup", onKeyUp);

  // Размер поля известен только в документе — вид считаем после вставки.
  setTimeout(() => {
    if (!view) fit();
    else applyView();
    const focus = ctx.focusCardId && cv.cards.find((c) => c.id === ctx.focusCardId);
    if (focus) {
      selCards.add(focus.id);
      renderScene();
      renderSide();
      centerOn(focus);
    }
  }, 0);

  renderScene();
  renderSide();
  return pane;
}
