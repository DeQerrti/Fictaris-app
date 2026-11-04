import { apiGet } from "./api.js";
import { iconSvg } from "./icons.js";
import { openPopover, closeMenu } from "./context-menu.js";
import { KIND_LABELS, loadTemplates, saveTemplates, templateFor, blankField } from "./templates.js";
import { i18n } from "./i18n.js";

// ══════════════════════════════════════════════
//  ПОЛЯ АНКЕТЫ (боковая панель, world-panels.js)
//
//  Шаблон анкеты показан так, как он выглядит в досье: строки —
//  половиной ширины, тексты — во всю. На каждом поле — сколько карточек
//  его заполнили: сразу видно, что пустует. Поля перетаскиваются,
//  переименовываются на месте; внизу — готовые поля в один щелчок.
//
//  Данные — как раньше: site-settings.json → templates[kind] =
//  [{ id, name, fields: [{ key, label, type }] }] (templates.js).
// ══════════════════════════════════════════════

const TYPES = [
  ["input", "Строка"],
  ["textarea", "Текст"],
  ["richtext", "Текст с разделами"],
];

const PRESETS = {
  characters: [
    ["Родина", "input"], ["Происхождение", "textarea"], ["Голос и речь", "textarea"], ["Страхи", "textarea"],
    ["Секрет", "textarea"], ["Вера", "input"], ["Привычки", "textarea"], ["Навыки", "textarea"], ["Внутренний конфликт", "textarea"],
  ],
  locations: [
    ["Население", "input"], ["Климат", "input"], ["Правитель", "input"], ["История", "textarea"],
    ["Достопримечательности", "textarea"], ["Опасности", "textarea"], ["Слухи", "textarea"],
  ],
  factions: [
    ["Девиз", "input"], ["Символ", "input"], ["Цели", "textarea"], ["Ресурсы", "textarea"],
    ["Враги", "textarea"], ["История", "textarea"], ["Как вступают", "textarea"],
  ],
};
const ENTITY_PATH = { characters: "/api/characters", locations: "/api/locations", factions: "/api/factions" };
const UNNAMED = /^(новое\s+)?поле$/i;

let root = null;
let kind = "characters";
let templateId = null;

export async function renderFieldsEditor(body, startKind) {
  root = body;
  if (startKind && startKind !== kind) {
    kind = startKind;
    templateId = null;
  }
  await render();
}

async function render() {
  const [list, entities] = await Promise.all([loadTemplates(kind), apiGet(ENTITY_PATH[kind]).catch(() => [])]);
  if (!list.some((t) => t.id === templateId)) templateId = list[0].id;
  const tpl = list.find((t) => t.id === templateId);
  const users = (Array.isArray(entities) ? entities : []).filter((e) => templateFor(list, e.templateId).id === tpl.id);
  const filled = (key) => users.filter((e) => String(e[key] ?? "").replace(/<[^>]*>/g, "").trim()).length;
  const save = () => saveTemplates(kind, list);

  root.innerHTML = "";

  // ── раздел и шаблон
  const top = document.createElement("div");
  top.className = "fe-top";
  const seg = document.createElement("div");
  seg.className = "segmented";
  for (const k of Object.keys(KIND_LABELS)) {
    const b = document.createElement("button");
    b.className = "segmented-btn" + (k === kind ? " active" : "");
    b.textContent = KIND_LABELS[k]();
    b.addEventListener("click", () => {
      kind = k;
      templateId = null;
      render();
    });
    seg.appendChild(b);
  }
  top.appendChild(seg);

  const tplRow = document.createElement("div");
  tplRow.className = "fe-tpl";
  const tplSelect = document.createElement("select");
  tplSelect.className = "kin-kind-select";
  for (const t of list) {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name || i18n("Без названия");
    if (t.id === tpl.id) opt.selected = true;
    tplSelect.appendChild(opt);
  }
  tplSelect.addEventListener("change", () => {
    templateId = tplSelect.value;
    render();
  });
  const more = document.createElement("button");
  more.className = "btn fe-icon-btn";
  more.innerHTML = iconSvg("more", 15);
  more.title = i18n("Шаблон: переименовать, копия, файл, удалить");
  more.addEventListener("click", () => openTemplateMenu(more, list, tpl));
  const usersNote = document.createElement("span");
  usersNote.className = "fe-sub";
  usersNote.textContent = i18n("Шаблон · по нему {n}", { n: users.length });
  tplRow.append(usersNote, tplSelect, more);
  top.appendChild(tplRow);
  root.appendChild(top);

  // ── пустые поля без названия
  const junk = tpl.fields.filter((f) => UNNAMED.test(f.label.trim()) && !filled(f.key));
  if (junk.length) {
    const warn = document.createElement("div");
    warn.className = "tagm-warn";
    warn.innerHTML = `${iconSvg("alert", 16)}<span></span>`;
    warn.querySelector("span").textContent = i18n("{n} полей без названия пусты у всех – в досье они висят строками «Не заполнено».", { n: junk.length });
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = i18n("Убрать");
    btn.addEventListener("click", async () => {
      tpl.fields = tpl.fields.filter((f) => !junk.includes(f));
      await save();
      render();
    });
    warn.appendChild(btn);
    root.appendChild(warn);
  }

  // ── поля сеткой, как в досье
  const grid = document.createElement("div");
  grid.className = "fe-grid";
  let dragKey = null;
  for (const field of tpl.fields) {
    const n = filled(field.key);
    const card = document.createElement("div");
    card.className = "fe-field" + (field.type === "input" ? "" : " wide") + (n ? "" : " empty");
    card.draggable = true;
    card.dataset.key = field.key;

    const head = document.createElement("div");
    head.className = "fe-field-head";
    const grip = document.createElement("span");
    grip.className = "fe-grip";
    grip.textContent = "⠿";
    const label = document.createElement("input");
    label.className = "fe-label";
    label.value = field.label;
    label.addEventListener("change", async () => {
      field.label = label.value.trim() || i18n("Поле");
      await save();
    });
    // перетаскивать за поле ввода нельзя — иначе не выделить текст
    label.addEventListener("mousedown", () => { card.draggable = false; });
    label.addEventListener("blur", () => { card.draggable = true; });

    const type = document.createElement("select");
    type.className = "fe-type";
    for (const [v, l] of TYPES) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = i18n(l);
      if (field.type === v) opt.selected = true;
      type.appendChild(opt);
    }
    type.addEventListener("change", async () => {
      field.type = type.value;
      await save();
      render();
    });

    const del = document.createElement("button");
    del.className = "fe-del";
    del.innerHTML = iconSvg("close", 13);
    del.title = n
      ? i18n("Убрать поле из шаблона – у {n} карточек оно заполнено; записанное не сотрётся и вернётся, если поле добавить снова", { n })
      : i18n("Убрать поле из шаблона");
    del.addEventListener("click", async () => {
      if (n && del.dataset.confirm !== "1") {
        del.dataset.confirm = "1";
        del.textContent = i18n("Точно?");
        setTimeout(() => { del.dataset.confirm = ""; del.innerHTML = iconSvg("close", 13); }, 3000);
        return;
      }
      tpl.fields = tpl.fields.filter((f) => f !== field);
      await save();
      render();
    });
    head.append(grip, label, type, del);
    card.appendChild(head);

    const fill = document.createElement("div");
    fill.className = "fe-fill";
    fill.innerHTML = `<span class="fe-fill-text"></span><span class="fe-bar"><i style="width:${users.length ? Math.round((n / users.length) * 100) : 0}%"></i></span>`;
    fill.querySelector(".fe-fill-text").textContent = !users.length
      ? i18n("Карточек по этому шаблону пока нет")
      : n ? i18n("Заполнено у {n} из {total}", { n, total: users.length }) : i18n("Пусто у всех");
    card.appendChild(fill);

    card.addEventListener("dragstart", (e) => {
      dragKey = field.key;
      e.dataTransfer.effectAllowed = "move";
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    card.addEventListener("dragover", (e) => {
      if (dragKey && dragKey !== field.key) e.preventDefault();
    });
    card.addEventListener("drop", async (e) => {
      e.preventDefault();
      if (!dragKey || dragKey === field.key) return;
      const from = tpl.fields.findIndex((f) => f.key === dragKey);
      const [moved] = tpl.fields.splice(from, 1);
      tpl.fields.splice(tpl.fields.indexOf(field), 0, moved);
      dragKey = null;
      await save();
      render();
    });
    grid.appendChild(card);
  }
  root.appendChild(grid);

  // ── добавить
  const addTitle = document.createElement("div");
  addTitle.className = "fe-k";
  addTitle.textContent = i18n("Добавить поле");
  root.appendChild(addTitle);
  const presets = document.createElement("div");
  presets.className = "tagm-chips";
  const have = new Set(tpl.fields.map((f) => f.label.trim().toLowerCase()));
  const add = async (label, fieldType) => {
    const f = { ...blankField(), label, type: fieldType };
    tpl.fields = [...tpl.fields, f];
    await save();
    await render();
    if (!label || UNNAMED.test(label)) root.querySelector(`[data-key="${f.key}"] .fe-label`)?.select();
  };
  for (const [label, fieldType] of PRESETS[kind] || []) {
    if (have.has(i18n(label).toLowerCase())) continue;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "tagm-chip add";
    chip.textContent = `+ ${i18n(label)}`;
    chip.addEventListener("click", () => add(i18n(label), fieldType));
    presets.appendChild(chip);
  }
  const own = document.createElement("button");
  own.type = "button";
  own.className = "tagm-chip add own";
  own.textContent = i18n("+ Своё поле");
  own.addEventListener("click", () => add(i18n("Новое поле"), "textarea"));
  presets.appendChild(own);
  root.appendChild(presets);
}

// ── Меню шаблона ───────────────────────────────
function openTemplateMenu(anchor, list, tpl) {
  const box = document.createElement("div");
  box.className = "fe-menu";
  const save = () => saveTemplates(kind, list);

  const name = document.createElement("input");
  name.className = "field-inline-control field-inline-control-bright";
  name.value = tpl.name || "";
  name.placeholder = i18n("Название шаблона");
  name.addEventListener("change", async () => {
    tpl.name = name.value.trim() || i18n("Без названия");
    await save();
    render();
  });
  box.appendChild(name);

  const item = (icon, text, fn, danger) => {
    const b = document.createElement("button");
    b.className = "context-menu-item" + (danger ? " danger" : "");
    b.innerHTML = `<span class="context-menu-icon">${iconSvg(icon, 14)}</span><span class="context-menu-label"></span>`;
    b.querySelector(".context-menu-label").textContent = text;
    b.addEventListener("click", fn);
    box.appendChild(b);
    return b;
  };

  item("notePlus", i18n("Новый шаблон – копия этого"), async () => {
    const fresh = { id: `t_${Date.now().toString(36)}`, name: `${tpl.name || i18n("Шаблон")} – ${i18n("копия")}`, fields: tpl.fields.map((f) => ({ ...f })) };
    list.push(fresh);
    await save();
    templateId = fresh.id;
    closeMenu();
    render();
  });

  // Обмен шаблонами между проектами — файлом: name/fields, без id.
  item("download", i18n("Сохранить шаблон в файл"), () => {
    const payload = { fictarisTemplate: 1, name: tpl.name, fields: tpl.fields };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fictaris-shablon-${(tpl.name || "shablon").toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
    closeMenu();
  });

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "application/json";
  fileInput.style.display = "none";
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed.name !== "string" || !Array.isArray(parsed.fields)) {
      alert(i18n("Это не файл шаблона Fictaris."));
      return;
    }
    const fields = parsed.fields
      .filter((f) => f && typeof f.key === "string" && typeof f.label === "string")
      .map((f) => ({ key: f.key, label: f.label, type: TYPES.some(([v]) => v === f.type) ? f.type : "textarea" }));
    const fresh = { id: `t_${Date.now().toString(36)}`, name: parsed.name || i18n("Новый шаблон"), fields };
    list.push(fresh);
    await save();
    templateId = fresh.id;
    closeMenu();
    render();
  });
  box.appendChild(fileInput);
  item("upload", i18n("Загрузить шаблон из файла"), () => fileInput.click());

  if (list.length > 1) {
    const del = item("trash", i18n("Удалить шаблон"), async () => {
      if (del.dataset.confirm !== "1") {
        del.dataset.confirm = "1";
        del.querySelector(".context-menu-label").textContent = i18n("Точно? Карточки по нему покажут первый шаблон");
        return;
      }
      const i = list.indexOf(tpl);
      list.splice(i, 1);
      await save();
      templateId = list[0].id;
      closeMenu();
      render();
    }, true);
  }

  const r = anchor.getBoundingClientRect();
  openPopover(r.left - 200, r.bottom + 6, box, "fe-popover");
}
