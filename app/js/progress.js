import { uid } from "./api.js";
import { escapeHtml } from "./chips.js";
import { iconSvg } from "./icons.js";
import { openPopover, closeMenu } from "./context-menu.js";
import { i18n, i18nPlural } from "./i18n.js";

// ══════════════════════════════════════════════
//  ИЗМЕНЕНИЯ ПО ХОДУ КНИГИ
//
//  Сведения о персонаже меняются по мере сюжета: «с главы 4 – ранена»,
//  «с главы 12 – предатель». Поле анкеты в досье — каким персонаж
//  входит в книгу, а изменения лежат рядом списком:
//  character.changes = [{ id, chapterId, key, value }], key — ключ поля
//  анкеты. Досье показывает состояние на выбранной главе (ползунок
//  «Как на главе»), панель главы — каким персонаж стал к ней.
//  «Кто что знает» (knowledge.json) — того же рода сведения, поэтому
//  показывается здесь же.
// ══════════════════════════════════════════════

// Порядок чтения: книги по порядку, главы — как в manuscript.chapters.
export function readingOrder(manuscript) {
  const chapters = manuscript?.chapters || [];
  const books = Array.isArray(manuscript?.books) && manuscript.books.length ? manuscript.books : [{ id: null }];
  const first = books[0].id;
  const out = [];
  for (const b of books) for (const ch of chapters) if (b.id === null || (ch.bookId || first) === b.id) out.push(ch);
  for (const ch of chapters) if (!out.includes(ch)) out.push(ch);
  return out;
}

const indexOf = (order, chapterId) => order.findIndex((ch) => ch.id === chapterId);

// Состояние полей к главе (включительно): key → { value, chapterId, prev }.
export function stateAt(entity, chapterId, order) {
  const at = indexOf(order, chapterId);
  const out = new Map();
  if (at < 0) return out;
  const list = (entity.changes || [])
    .map((x) => ({ ...x, i: indexOf(order, x.chapterId) }))
    .filter((x) => x.i >= 0 && x.i <= at)
    .sort((a, b) => a.i - b.i);
  for (const x of list) {
    const prev = out.has(x.key) ? out.get(x.key).value : entity[x.key];
    out.set(x.key, { value: x.value, chapterId: x.chapterId, prev });
  }
  return out;
}

// Что персонаж знает к главе — по «Кто что знает».
export function knowledgeAt(entityId, chapterId, order, facts) {
  const at = indexOf(order, chapterId);
  return (facts || [])
    .filter((f) => f.entries && entityId in f.entries)
    .map((f) => {
      const from = f.entries[entityId];
      const i = from === "__start__" ? -1 : indexOf(order, from);
      return { fact: f, from, known: at >= 0 && i <= at && (from === "__start__" || i >= 0) };
    });
}

export function chapterShort(ch) {
  if (!ch) return "";
  const m = /^(Глава|Chapter)\s+(\d+)/i.exec(ch.title || "");
  return m ? `${i18n("Гл.")} ${m[2]}` : ch.title || i18n("Без названия");
}

// ── Форма «изменение с главы» ──
// x, y — где открыть; onSaved() — после записи в entity.changes.
export function openChangeForm(x, y, entity, fields, order, chapterId, onSaved) {
  const box = document.createElement("div");
  box.className = "pg-form";
  box.innerHTML = `<div class="pg-form-title"></div>
    <label class="sec-new-label" data-l="f"></label><select class="kin-kind-select pg-form-field"></select>
    <label class="sec-new-label" data-l="c"></label><select class="kin-kind-select pg-form-ch"></select>
    <label class="sec-new-label" data-l="v"></label><textarea class="sec-new-input pg-form-value" rows="2"></textarea>
    <div class="pg-form-was"></div>
    <div class="sec-new-actions"><button class="btn" data-a="cancel"></button><button class="btn primary" data-a="ok"></button></div>`;
  box.querySelector(".pg-form-title").textContent = i18n("Изменение по ходу книги");
  box.querySelector('[data-l="f"]').textContent = i18n("Что меняется");
  box.querySelector('[data-l="c"]').textContent = i18n("С какой главы");
  box.querySelector('[data-l="v"]').textContent = i18n("Новое значение");
  box.querySelector('[data-a="cancel"]').textContent = i18n("Отмена");
  box.querySelector('[data-a="ok"]').textContent = i18n("Сохранить");
  const fieldSel = box.querySelector(".pg-form-field");
  for (const f of fields) {
    const o = document.createElement("option");
    o.value = f.key;
    o.textContent = f.label;
    fieldSel.appendChild(o);
  }
  const chSel = box.querySelector(".pg-form-ch");
  for (const ch of order) {
    const o = document.createElement("option");
    o.value = ch.id;
    o.textContent = ch.title || i18n("Без названия");
    if (ch.id === chapterId) o.selected = true;
    chSel.appendChild(o);
  }
  const value = box.querySelector(".pg-form-value");
  const was = box.querySelector(".pg-form-was");
  const showWas = () => {
    const s = stateAt(entity, chSel.value, order).get(fieldSel.value);
    const before = s && s.chapterId !== chSel.value ? s.value : s ? s.prev : entity[fieldSel.value];
    was.textContent = before ? i18n("Было: {v}", { v: String(before).slice(0, 140) }) : i18n("Раньше не заполнено");
    const same = (entity.changes || []).find((c) => c.key === fieldSel.value && c.chapterId === chSel.value);
    value.value = same ? same.value : "";
  };
  fieldSel.addEventListener("change", showWas);
  chSel.addEventListener("change", showWas);
  showWas();
  box.querySelector('[data-a="cancel"]').addEventListener("click", closeMenu);
  box.querySelector('[data-a="ok"]').addEventListener("click", () => {
    const v = value.value.trim();
    entity.changes = (entity.changes || []).filter((c) => !(c.key === fieldSel.value && c.chapterId === chSel.value));
    if (v) entity.changes.push({ id: uid(), chapterId: chSel.value, key: fieldSel.value, value: v });
    if (!entity.changes.length) delete entity.changes;
    closeMenu();
    onSaved();
  });
  openPopover(x, y, box, "pg-form-pop");
  value.focus();
}

// ── Панель в досье ──
// Возвращает { el, decorate } — decorate(field, fieldEl) дописывает под
// полем анкеты его значение на выбранной главе.
export function buildProgressPanel(entity, { manuscript, fields, facts, selected, onSelect, onChange }) {
  const order = readingOrder(manuscript);
  const el = document.createElement("div");
  el.className = "pg";
  if (!order.length) return { el, decorate: () => {} };
  const sel = order.find((ch) => ch.id === selected) || null;
  const books = Array.isArray(manuscript.books) && manuscript.books.length ? manuscript.books : [{ id: null }];
  const bookOf = (ch) => ch.bookId || books[0].id;
  const track = sel ? order.filter((ch) => bookOf(ch) === bookOf(sel)) : order.filter((ch) => bookOf(ch) === bookOf(order[0]));
  const changedAt = new Set((entity.changes || []).map((c) => c.chapterId));
  const fieldLabel = (key) => fields.find((f) => f.key === key)?.label || key;

  // Ползунок
  const bar = document.createElement("div");
  bar.className = "pg-scrub";
  const label = document.createElement("span");
  label.className = "pg-scrub-label";
  label.textContent = i18n("Как на главе");
  const line = document.createElement("div");
  line.className = "pg-track";
  line.innerHTML = `<div class="pg-line"></div>`;
  track.forEach((ch, i) => {
    const t = document.createElement("button");
    t.className = "pg-tick" + (changedAt.has(ch.id) ? " ch" : "") + (sel && ch.id === sel.id ? " cur" : "");
    t.style.left = `${track.length > 1 ? (i / (track.length - 1)) * 100 : 50}%`;
    t.title = ch.title || "";
    t.setAttribute("aria-label", ch.title || "");
    t.addEventListener("click", () => onSelect(ch.id));
    line.appendChild(t);
  });
  const step = (d) => {
    const i = sel ? order.indexOf(sel) : -1;
    const next = order[Math.max(0, Math.min(order.length - 1, i + d))];
    if (next) onSelect(next.id);
  };
  const prev = document.createElement("button");
  prev.className = "btn pg-step";
  prev.innerHTML = iconSvg("chevronLeft", 14);
  prev.title = i18n("Предыдущая глава");
  prev.addEventListener("click", () => step(-1));
  const pick = document.createElement("select");
  pick.className = "kin-kind-select pg-pick";
  pick.innerHTML = `<option value="">${escapeHtml(i18n("Начало книги – как в анкете"))}</option>${order.map((ch) => `<option value="${escapeHtml(ch.id)}"${sel && sel.id === ch.id ? " selected" : ""}>${escapeHtml(ch.title || i18n("Без названия"))}</option>`).join("")}`;
  pick.addEventListener("change", () => onSelect(pick.value || null));
  const next = document.createElement("button");
  next.className = "btn pg-step";
  next.innerHTML = iconSvg("chevronRight", 14);
  next.title = i18n("Следующая глава");
  next.addEventListener("click", () => step(1));
  bar.append(label, line, prev, pick, next);
  el.appendChild(bar);

  const state = sel ? stateAt(entity, sel.id, order) : new Map();
  const changes = (entity.changes || [])
    .map((c) => ({ ...c, i: order.findIndex((ch) => ch.id === c.chapterId) }))
    .sort((a, b) => a.i - b.i);
  const known = knowledgeAt(entity.id, sel?.id, order, facts);
  if (!changes.length && !known.length && !sel) {
    const hint = document.createElement("div");
    hint.className = "pg-hint";
    hint.textContent = i18n("Сведения меняются по ходу сюжета? «+ Изменение с главы» – и досье покажет, каким персонаж стал к выбранной главе.");
    el.appendChild(hint);
  }

  const cols = document.createElement("div");
  cols.className = "pg-cols";
  if (known.length) {
    const card = document.createElement("div");
    card.className = "pg-card";
    const n = known.filter((k) => k.known).length;
    card.innerHTML = `<div class="pg-card-head"></div>`;
    card.firstChild.textContent = sel ? i18n("Что знает к этой главе – {n} из {total}", { n, total: known.length }) : i18n("Что узнаёт по ходу книги");
    for (const k of known) {
      const row = document.createElement("div");
      row.className = "pg-know" + (sel && !k.known ? " no" : "");
      const from = k.from === "__start__" ? i18n("с начала") : chapterShort(order.find((ch) => ch.id === k.from));
      row.innerHTML = `<span class="pg-know-mark">${sel ? (k.known ? "✓" : "–") : "•"}</span><span></span><i></i>`;
      row.querySelector("span:nth-child(2)").textContent = k.fact.label || i18n("Без названия");
      row.querySelector("i").textContent = from;
      card.appendChild(row);
    }
    cols.appendChild(card);
  }
  const hist = document.createElement("div");
  hist.className = "pg-card";
  hist.innerHTML = `<div class="pg-card-head"></div>`;
  hist.firstChild.textContent = i18n("Что меняется по ходу книги");
  for (const c of changes) {
    const row = document.createElement("div");
    row.className = "pg-hist" + (sel && c.i > order.indexOf(sel) ? " later" : "");
    row.innerHTML = `<i></i><span></span><button class="fac-member-remove" title="${escapeHtml(i18n("Убрать изменение"))}">${iconSvg("close", 11)}</button>`;
    row.querySelector("i").textContent = `${order[c.i]?.title || i18n("Удалённая глава")} · ${fieldLabel(c.key)}`;
    row.querySelector("span").textContent = c.value;
    row.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      onSelect(c.chapterId);
    });
    row.querySelector("button").addEventListener("click", () => {
      entity.changes = (entity.changes || []).filter((x) => x.id !== c.id);
      if (!entity.changes.length) delete entity.changes;
      onChange();
    });
    hist.appendChild(row);
  }
  const add = document.createElement("button");
  add.className = "pg-add";
  add.textContent = i18n("+ Изменение с главы…");
  add.addEventListener("click", () => {
    const r = add.getBoundingClientRect();
    openChangeForm(r.left, r.bottom + 6, entity, fields, order, sel?.id || order[0].id, onChange);
  });
  hist.appendChild(add);
  cols.appendChild(hist);
  el.appendChild(cols);

  const decorate = (f, fieldEl) => {
    const s = state.get(f.key);
    if (!s) return;
    const note = document.createElement("div");
    note.className = "pg-now";
    note.innerHTML = `<span class="pg-now-tag"></span><span class="pg-now-value"></span>`;
    note.querySelector(".pg-now-tag").textContent = i18n("к «{ch}» · с {from}", { ch: chapterShort(sel), from: chapterShort(order.find((ch) => ch.id === s.chapterId)) });
    note.querySelector(".pg-now-value").textContent = s.value;
    fieldEl.appendChild(note);
    fieldEl.classList.add("pg-changed");
  };
  return { el, decorate };
}

// Короткая сводка для панели главы: «Ранена · знает 3 из 8».
export function summaryAt(entity, chapterId, order, fields, facts) {
  const state = stateAt(entity, chapterId, order);
  const parts = [...state.entries()].map(([key, s]) => {
    const label = fields.find((f) => f.key === key)?.label || key;
    return { text: `${label}: ${s.value}`, fresh: s.chapterId === chapterId };
  });
  const known = knowledgeAt(entity.id, chapterId, order, facts);
  const n = known.filter((k) => k.known).length;
  return { parts, known: known.length ? i18nPlural(n, ["знает {n} тайну из {total}", "знает {n} тайны из {total}", "знает {n} тайн из {total}"], { total: known.length }) : "" };
}
