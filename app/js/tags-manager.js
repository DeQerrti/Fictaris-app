import { apiGet, apiPost } from "./api.js";
import { iconSvg } from "./icons.js";
import { openPopover, closeMenu } from "./context-menu.js";
import { DEFAULT_TAGS_MAP, CATEGORY_LABELS, loadCategoryLabels, saveCategoryLabel, newCategoryId, deleteCategory, parseTags, stringifyTags } from "./tags.js";
import { i18n, i18nPlural } from "./i18n.js";

// ══════════════════════════════════════════════
//  СЛОВАРЬ ТЕГОВ (боковая панель, world-panels.js)
//
//  Категории — карточками, теги в них — чипами с числом «у скольких
//  карточек стоит». Отдельно «Найдено в карточках»: теги, которые уже
//  проставлены персонажам, местам и фракциям, но в словаре их нет, —
//  перетащить в категорию, и они станут обычными тегами словаря.
//  Щелчок по тегу — окошко: имя (переименовывает и на карточках),
//  категория, подсказка, у кого стоит, объединить с другим, убрать.
//
//  Данные — как и раньше, site-settings.json: customTags { имя: {cat,
//  tip} } поверх встроенного DEFAULT_TAGS_MAP, hiddenTags — убранные
//  встроенные, customCategories — подписи категорий. На карточках тег —
//  имя в строке через запятую (tags.js), поэтому переименование и
//  объединение переписывают и сами карточки.
// ══════════════════════════════════════════════

const CAT_COLORS = ["#7d6a9e", "#c9944a", "#6a8fae", "#b5636b", "#5a8a5f", "#9a9250", "#4f7d74", "#a4483c"];
const FOUND = "__found__";
const ENTITY_PATHS = [["/api/characters", "character"], ["/api/locations", "location"], ["/api/factions", "faction"]];

let root = null;
let query = "";
let state = null; // { settings, dict, labels, cats, usage }

export async function renderTagsManager(body) {
  root = body;
  query = "";
  await reload();
}

async function reload() {
  const [settings, labels, ...lists] = await Promise.all([
    apiGet("/api/site-settings").catch(() => ({})),
    loadCategoryLabels(),
    ...ENTITY_PATHS.map(([p]) => apiGet(p).catch(() => [])),
  ]);
  const hidden = new Set(settings.hiddenTags || []);
  const dict = {};
  for (const [name, info] of Object.entries({ ...DEFAULT_TAGS_MAP, ...(settings.customTags || {}) })) {
    if (!hidden.has(name)) dict[name] = info;
  }
  // кто носит тег — по точному имени; без учёта регистра — для поиска
  // «то же, что стандартный, но с маленькой буквы»
  const usage = new Map();
  lists.forEach((list, i) => {
    for (const e of Array.isArray(list) ? list : []) {
      for (const t of parseTags(e.tags)) {
        if (!usage.has(t)) usage.set(t, []);
        usage.get(t).push({ type: ENTITY_PATHS[i][1], name: e.name || "?" });
      }
    }
  });
  const cats = [...new Set([...Object.keys(labels), ...Object.values(dict).map((i) => i.cat)])];
  state = { settings, dict, labels, cats, usage };
  render();
}

const colorOf = (cat) => (cat === FOUND ? "#857959" : CAT_COLORS[Math.max(0, state.cats.indexOf(cat)) % CAT_COLORS.length]);
const usedBy = (name) => state.usage.get(name) || [];

// Проставлены на карточках, но в словаре их нет (с учётом регистра —
// «протагонист» при словарном «Протагонист» тоже сюда: на деле это
// разные теги, и поле тегов показывает их отдельно).
function foundTags() {
  return [...state.usage.keys()].filter((t) => !state.dict[t]);
}

function caseTwins() {
  const lower = new Map(Object.keys(state.dict).map((n) => [n.toLowerCase(), n]));
  return foundTags().map((t) => [t, lower.get(t.toLowerCase())]).filter(([, d]) => d);
}

// ── Запись ─────────────────────────────────────
async function saveDict(mutate) {
  const s = (await apiGet("/api/site-settings").catch(() => ({}))) || {};
  const customTags = { ...(s.customTags || {}) };
  const hidden = new Set(s.hiddenTags || []);
  mutate({ customTags, hidden });
  await apiPost("/api/site-settings", { ...s, customTags, hiddenTags: [...hidden] });
}

function dictPut(ctx, name, info) {
  ctx.customTags[name] = { cat: info.cat, tip: info.tip || "" };
  ctx.hidden.delete(name);
}

function dictDrop(ctx, name) {
  delete ctx.customTags[name];
  if (DEFAULT_TAGS_MAP[name]) ctx.hidden.add(name);
}

// map: старое имя → новое (null — снять тег). Карточки переписываются
// только там, где что-то поменялось.
async function rewriteCards(map) {
  for (const [path] of ENTITY_PATHS) {
    const list = await apiGet(path).catch(() => null);
    if (!Array.isArray(list)) continue;
    let changed = false;
    const next = list.map((item) => {
      const tags = parseTags(item.tags);
      if (!tags.some((t) => t in map)) return item;
      changed = true;
      const out = [];
      for (const t of tags) {
        const v = t in map ? map[t] : t;
        if (v && !out.includes(v)) out.push(v);
      }
      return { ...item, tags: stringifyTags(out) };
    });
    if (changed) await apiPost(path, next);
  }
}

async function renameTag(oldName, newName) {
  newName = newName.trim();
  if (!newName || newName === oldName) return;
  const info = state.dict[oldName];
  if (info) {
    await saveDict((ctx) => {
      dictDrop(ctx, oldName);
      dictPut(ctx, newName, info);
    });
  }
  await rewriteCards({ [oldName]: newName });
}

async function moveTag(name, cat) {
  const info = state.dict[name] || { tip: "" };
  await saveDict((ctx) => dictPut(ctx, name, { ...info, cat }));
}

// ── Отрисовка ──────────────────────────────────
function render() {
  root.innerHTML = "";
  const top = document.createElement("div");
  top.className = "tagm-top";
  const search = document.createElement("input");
  search.type = "search";
  search.className = "characters-search";
  search.placeholder = i18n("Найти тег…");
  search.value = query;
  search.addEventListener("input", () => {
    query = search.value;
    renderGrid(grid);
  });
  const addCat = document.createElement("button");
  addCat.className = "btn";
  addCat.textContent = i18n("+ Категория");
  addCat.addEventListener("click", async () => {
    const id = newCategoryId();
    await saveCategoryLabel(id, i18n("Новая категория"));
    await reload();
    root.querySelector(`[data-cat="${id}"] .tagm-cat-name`)?.click();
  });
  top.append(search, addCat);
  root.appendChild(top);

  const twins = caseTwins();
  if (twins.length) {
    const warn = document.createElement("div");
    warn.className = "tagm-warn";
    warn.innerHTML = `${iconSvg("alert", 16)}<span></span>`;
    warn.querySelector("span").textContent = i18n("«{list}» – то же, что теги словаря, но с другой буквы. Сейчас это разные теги.", { list: twins.map(([t]) => t).join("», «") });
    const fix = document.createElement("button");
    fix.className = "btn";
    fix.textContent = i18n("Объединить");
    fix.title = i18n("Переписать на карточках как в словаре");
    fix.addEventListener("click", async () => {
      await rewriteCards(Object.fromEntries(twins));
      await reload();
    });
    warn.appendChild(fix);
    root.appendChild(warn);
  }

  const grid = document.createElement("div");
  grid.className = "tagm-grid";
  root.appendChild(grid);
  renderGrid(grid);

  const hint = document.createElement("div");
  hint.className = "tagm-hint";
  hint.textContent = i18n("Число на теге – у скольких карточек он стоит. Щелчок – изменить, перетаскивание – в другую категорию.");
  root.appendChild(hint);
}

function renderGrid(grid) {
  grid.innerHTML = "";
  const q = query.trim().toLowerCase();
  const match = (n) => !q || n.toLowerCase().includes(q) || i18n(n).toLowerCase().includes(q);
  for (const cat of state.cats) {
    const names = Object.keys(state.dict).filter((n) => state.dict[n].cat === cat && match(n));
    if (q && !names.length) continue;
    grid.appendChild(buildCatCard(cat, names));
  }
  const found = foundTags().filter(match);
  if (found.length) grid.appendChild(buildCatCard(FOUND, found));
}

function buildCatCard(cat, names) {
  const card = document.createElement("div");
  card.className = "tagm-cat" + (cat === FOUND ? " found" : "");
  card.dataset.cat = cat;

  const head = document.createElement("div");
  head.className = "tagm-cat-head";
  head.innerHTML = `<span class="tagm-dot" style="background:${colorOf(cat)}"></span><span class="tagm-cat-name"></span><span class="tagm-cat-count"></span>`;
  const nameEl = head.querySelector(".tagm-cat-name");
  head.querySelector(".tagm-cat-count").textContent = String(names.length);
  if (cat === FOUND) {
    nameEl.textContent = i18n("Найдено в карточках");
    const sub = document.createElement("span");
    sub.className = "tagm-cat-sub";
    sub.textContent = i18n("не в словаре – перетащи в категорию");
    head.appendChild(sub);
  } else {
    nameEl.textContent = i18n(state.labels[cat] || cat);
    nameEl.title = i18n("Щелчок – переименовать");
    nameEl.addEventListener("click", () => renameCategoryInline(nameEl, cat));
    if (!(cat in CATEGORY_LABELS)) {
      const del = document.createElement("button");
      del.className = "tagm-cat-del";
      del.innerHTML = iconSvg("trash", 13);
      del.title = i18n("Удалить категорию вместе с её тегами из словаря (на карточках они останутся)");
      del.addEventListener("click", async () => {
        if (del.dataset.confirm !== "1") {
          del.dataset.confirm = "1";
          del.textContent = i18n("Точно?");
          setTimeout(() => { del.dataset.confirm = ""; del.innerHTML = iconSvg("trash", 13); }, 3000);
          return;
        }
        await deleteCategory(cat);
        await reload();
      });
      head.appendChild(del);
    }
  }
  card.appendChild(head);

  const chips = document.createElement("div");
  chips.className = "tagm-chips";
  for (const n of names) chips.appendChild(buildChip(n, cat));
  if (cat !== FOUND) chips.appendChild(buildAddChip(cat));
  card.appendChild(chips);

  if (cat !== FOUND) {
    card.addEventListener("dragover", (e) => {
      if (!e.dataTransfer.types.includes("text/x-fictaris-tag")) return;
      e.preventDefault();
      card.classList.add("drop");
    });
    card.addEventListener("dragleave", () => card.classList.remove("drop"));
    card.addEventListener("drop", async (e) => {
      card.classList.remove("drop");
      const name = e.dataTransfer.getData("text/x-fictaris-tag");
      if (!name || state.dict[name]?.cat === cat) return;
      e.preventDefault();
      await moveTag(name, cat);
      await reload();
    });
  }
  return card;
}

function buildChip(name, cat) {
  const n = usedBy(name).length;
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "tagm-chip" + (n ? "" : " unused");
  chip.draggable = true;
  chip.innerHTML = `<span class="tagm-dot" style="background:${colorOf(cat)}"></span><span class="tagm-chip-name"></span><span class="tagm-chip-n"></span>`;
  chip.querySelector(".tagm-chip-name").textContent = i18n(name);
  chip.querySelector(".tagm-chip-n").textContent = n ? String(n) : "·";
  const tip = state.dict[name]?.tip;
  if (tip) chip.title = i18n(tip);
  chip.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/x-fictaris-tag", name);
    e.dataTransfer.effectAllowed = "move";
  });
  chip.addEventListener("click", () => openTagPopover(name, chip));
  return chip;
}

function buildAddChip(cat) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "tagm-chip add";
  chip.textContent = i18n("+ тег");
  chip.addEventListener("click", () => {
    const input = document.createElement("input");
    input.className = "tagm-add-input";
    input.placeholder = i18n("Название");
    chip.replaceWith(input);
    input.focus();
    let done = false;
    const commit = async () => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (!name) return renderGrid(root.querySelector(".tagm-grid"));
      await saveDict((ctx) => dictPut(ctx, name, { cat, tip: state.dict[name]?.tip || "" }));
      await reload();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit();
      if (e.key === "Escape") { done = true; renderGrid(root.querySelector(".tagm-grid")); }
    });
    input.addEventListener("blur", commit);
  });
  return chip;
}

function renameCategoryInline(el, cat) {
  const input = document.createElement("input");
  input.className = "tagm-add-input";
  input.value = state.labels[cat] || "";
  el.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const commit = async () => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (v && v !== state.labels[cat]) await saveCategoryLabel(cat, v);
    await reload();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") { done = true; reload(); }
  });
  input.addEventListener("blur", commit);
}

// ── Окошко тега ────────────────────────────────
function openTagPopover(name, anchor) {
  const inDict = !!state.dict[name];
  const info = state.dict[name] || { cat: "", tip: "" };
  const who = usedBy(name);
  const box = document.createElement("div");
  box.className = "tagm-pop";

  const title = document.createElement("div");
  title.className = "tagm-pop-k";
  title.textContent = inDict ? i18n("Тег") : i18n("Тег не из словаря");
  box.appendChild(title);

  const nameInput = document.createElement("input");
  nameInput.className = "field-inline-control field-inline-control-bright";
  nameInput.value = name;
  nameInput.title = i18n("Enter – переименовать и в словаре, и на карточках");
  nameInput.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    closeMenu();
    await renameTag(name, nameInput.value);
    await reload();
  });
  box.appendChild(nameInput);

  const catRow = document.createElement("label");
  catRow.className = "tagm-pop-row";
  catRow.innerHTML = `<span></span>`;
  catRow.firstChild.textContent = inDict ? i18n("Категория") : i18n("В словарь");
  const catSelect = document.createElement("select");
  catSelect.className = "kin-kind-select";
  if (!inDict) catSelect.innerHTML = `<option value="">${i18n("– выбрать –")}</option>`;
  for (const cat of state.cats) {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = i18n(state.labels[cat] || cat);
    if (cat === info.cat) opt.selected = true;
    catSelect.appendChild(opt);
  }
  catSelect.addEventListener("change", async () => {
    if (!catSelect.value) return;
    closeMenu();
    await moveTag(name, catSelect.value);
    await reload();
  });
  catRow.appendChild(catSelect);
  box.appendChild(catRow);

  if (inDict) {
    const tip = document.createElement("textarea");
    tip.className = "field-inline-control rel-note";
    tip.placeholder = i18n("Подсказка – что значит тег");
    tip.value = info.tip || "";
    tip.addEventListener("change", async () => {
      await saveDict((ctx) => dictPut(ctx, name, { ...info, tip: tip.value.trim() }));
      state.dict[name] = { ...info, tip: tip.value.trim() };
    });
    box.appendChild(tip);
  }

  const whoTitle = document.createElement("div");
  whoTitle.className = "tagm-pop-k";
  whoTitle.textContent = who.length ? i18nPlural(who.length, ["Стоит у {n} карточки", "Стоит у {n} карточек", "Стоит у {n} карточек"]) : i18n("Пока ни у кого");
  box.appendChild(whoTitle);
  if (who.length) {
    const list = document.createElement("div");
    list.className = "tagm-pop-who";
    list.textContent = who.map((w) => w.name).join(", ");
    box.appendChild(list);
  }

  const others = Object.keys(state.dict).filter((n) => n !== name);
  const merge = document.createElement("select");
  merge.className = "kin-kind-select";
  merge.innerHTML = `<option value="">${i18n("Объединить с…")}</option>`;
  for (const n of others) {
    const opt = document.createElement("option");
    opt.value = n;
    opt.textContent = i18n(n);
    merge.appendChild(opt);
  }
  merge.title = i18n("Этот тег на карточках заменится выбранным, а сам уйдёт из словаря");
  merge.addEventListener("change", async () => {
    const target = merge.value;
    if (!target) return;
    closeMenu();
    await rewriteCards({ [name]: target });
    if (inDict) await saveDict((ctx) => dictDrop(ctx, name));
    await reload();
  });

  const actions = document.createElement("div");
  actions.className = "tagm-pop-actions";
  actions.appendChild(merge);
  if (inDict) {
    const drop = document.createElement("button");
    drop.className = "btn danger";
    drop.textContent = i18n("Убрать из словаря");
    drop.title = i18n("На карточках тег останется – появится в «Найдено в карточках»");
    drop.addEventListener("click", async () => {
      closeMenu();
      await saveDict((ctx) => dictDrop(ctx, name));
      await reload();
    });
    actions.appendChild(drop);
  }
  if (who.length) {
    const strip = document.createElement("button");
    strip.className = "btn danger";
    strip.textContent = i18n("Снять со всех");
    strip.addEventListener("click", async () => {
      if (strip.dataset.confirm !== "1") {
        strip.dataset.confirm = "1";
        strip.textContent = i18n("Точно?");
        return;
      }
      closeMenu();
      await rewriteCards({ [name]: null });
      await reload();
    });
    actions.appendChild(strip);
  }
  box.appendChild(actions);

  const r = anchor.getBoundingClientRect();
  openPopover(r.left, r.bottom + 6, box, "tagm-popover");
  setTimeout(() => nameInput.focus(), 0);
}
