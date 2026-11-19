import { apiGet } from "./api.js";
import { flattenBoards } from "./board-data.js";
import { escapeHtml } from "./chips.js";
import { locationTypeInfo, factionTypeInfo, iconSvg } from "./icons.js";
import { exportWorldPdf } from "./export-pdf.js";
import { exportSiteZip } from "./export-site.js";
import { i18n } from "./i18n.js";
import { chapterLabel } from "./books.js";
import { toReaderText } from "./text-format.js";
import { loadEntries, entryViews, sectionKind } from "./sections.js";
import { loadTemplates, templateFor } from "./templates.js";
import { readRecent } from "./recent-nav.js";
import { openTagsPanel, openTemplatesPanel, openCalendarPanel } from "./world-panels.js";

// ══════════════════════════════════════════════
//  ГЛОБАЛЬНЫЙ ПОИСК И КОМАНДНАЯ ПАЛИТРА
//
//  Ни у Fictaris, ни у TasteID раньше не было поиска, который смотрит
//  сразу во все модули — у TasteID это фильтр внутри одной вкладки
//  (отзывы), а здесь модулей больше десятка и искать в них по одному
//  не годится.
//
//  Индекс строится один раз на открытие (кэш на 5 секунд — не бегать в
//  сеть при каждом нажатии "/"), сам поиск — простая подстрока по
//  названию и подписи, без библиотек: справочник вряд ли настолько
//  велик, чтобы это стало узким местом.
//
//  Действия (COMMANDS ниже) — то же самое окно, тот же ввод, просто
//  вторая группа результатов под найденными сущностями: не отдельный
//  режим с своим сочетанием клавиш, а естественное расширение того
//  же поиска, раз он и так уже открыт на Ctrl+/. Список нарочно
//  короткий и без разрушительных действий (ничего похожего на
//  "Заполнить примером" или импорт, которые стирают текущие данные и
//  в основном интерфейсе защищены отдельным подтверждением) — только
//  то, что безопасно вызвать одним кликом не глядя.
// ══════════════════════════════════════════════

function commandList() {
  return [
    {
      id: "cmd-export-pdf",
      label: i18n("Экспортировать мир в PDF"),
      icon: "book",
      run: async () => {
        try {
          const res = await exportWorldPdf();
          if (res && res.ok === false) return; // диалог сохранения отменили — не ошибка
        } catch (e) {
          alert(e.message || i18n("Не получилось создать PDF. Доступно только в десктопной версии Fictaris."));
        }
      },
    },
    {
      id: "cmd-export-site",
      label: i18n("Экспортировать мир как сайт"),
      icon: "globe",
      run: () => exportSiteZip(),
    },
    {
      id: "cmd-settings-appearance",
      label: i18n("Настройки → Оформление"),
      icon: "eye",
      run: (navigate) => navigate("settings", "appearance"),
    },
    {
      id: "cmd-settings-sections",
      label: i18n("Настройки → Разделы и клавиши"),
      icon: "keyboard",
      run: (navigate) => navigate("settings", "sections"),
    },
    {
      id: "cmd-templates",
      label: i18n("Поля анкеты"),
      icon: "note",
      run: () => openTemplatesPanel("characters"),
    },
    {
      id: "cmd-tags",
      label: i18n("Теги"),
      icon: "pushpin",
      run: () => openTagsPanel(),
    },
    {
      id: "cmd-calendar",
      label: i18n("Календарь мира"),
      icon: "clock",
      run: () => openCalendarPanel(),
    },
  ];
}

function moduleLabels() {
  return {
    characters: i18n("Персонаж"),
    locations: i18n("Локация"),
    factions: i18n("Фракция"),
    timeline: i18n("Событие"),
    manuscript: i18n("Глава"),
    board: i18n("Карточка"),
    relationships: i18n("Связь"),
    knowledge: i18n("Факт"),
    canvas: i18n("Карточка холста"),
  };
}

// Разделы без своей карточки по id (buildIndex ниже кладёт их записи с
// id: null) — у "недавнего" им нечего резолвить через index, показываем
// сам раздел по имени, как ярлык.
function sectionLabels() {
  return {
    board: i18n("Доска"),
    knowledge: i18n("Знания"),
  };
}

let overlay = null;
let input = null;
let list = null;
let onNavigate = null; // (module, focusId) => void
let index = [];
let indexLoadedAt = 0;

// Кусок текста вокруг найденного — чтобы было видно, где в главе это место.
function contextSnippet(text, q, radius = 45) {
  const clean = (text || "").replace(/\s+/g, " ");
  const at = clean.toLowerCase().indexOf(q);
  if (at < 0) return null;
  const start = Math.max(0, at - radius);
  const end = Math.min(clean.length, at + q.length + radius);
  return `${start > 0 ? "…" : ""}${clean.slice(start, end).trim()}${end < clean.length ? "…" : ""}`;
}

// Текст для поиска — без маркеров форматирования (**, *, ~~, ==, <u>).
function plain(text) {
  return toReaderText(text).replace(/\*\*|~~|==|<\/?u>|\*/g, "");
}

function snippet(text, max = 90) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

async function buildIndex() {
  const [characters, locations, factions, timeline, manuscript, board, relationships, knowledge, canvas] = await Promise.all([
    apiGet("/api/characters"),
    apiGet("/api/locations"),
    apiGet("/api/factions"),
    apiGet("/api/timeline"),
    apiGet("/api/manuscript"),
    apiGet("/api/board"),
    apiGet("/api/relationships"),
    apiGet("/api/knowledge"),
    apiGet("/api/canvas"),
  ]);
  const own = entryViews(await loadEntries());

  const entries = [];
  // Записи своих разделов — переход открывает запись в её разделе.
  const tplCache = new Map();
  for (const e of own) {
    const kind = sectionKind(e.sectionId);
    if (!tplCache.has(kind)) tplCache.set(kind, await loadTemplates(kind));
    const fields = templateFor(tplCache.get(kind), e.templateId)?.fields || [];
    const text = [e.tags, ...fields.map((f) => e[f.key])].filter((v) => typeof v === "string").join("\n");
    entries.push({ module: "section", id: e.id, title: e.name, subtitle: snippet(fields.map((f) => e[f.key]).find((v) => typeof v === "string" && v.trim())), text, color: e._sec.color || "#7d6a9e", typeLabel: e._sec.name });
  }
  for (const c of characters) {
    // text — по чему ещё искать, кроме заголовка: раньше поиск видел только
    // первые 90 символов, и фраза из середины главы не находилась.
    const text = Object.entries(c).filter(([k, v]) => typeof v === "string" && !["id", "color", "templateId", "gender"].includes(k)).map(([, v]) => v).join("\n");
    entries.push({ module: "characters", id: c.id, title: c.name, subtitle: snippet(c.role), text, color: c.color || "#7c7157" });
  }
  for (const l of locations) {
    const [, , , color] = locationTypeInfo(l.type);
    entries.push({ module: "locations", id: l.id, title: l.name, subtitle: snippet(l.description), text: [l.description, l.notes, l.tags].join("\n"), color });
  }
  for (const f of factions) {
    const [, , , color] = factionTypeInfo(f.type);
    entries.push({ module: "factions", id: f.id, title: f.name, subtitle: snippet(f.description), text: [f.description, f.notes, f.tags].join("\n"), color });
  }
  for (const e of timeline) {
    entries.push({ module: "timeline", id: e.id, title: e.title, subtitle: snippet(e.description || e.date), text: plain([e.date, e.description].join("\n")), color: "#6a8fae" });
  }
  for (const c of manuscript.chapters || []) {
    entries.push({
      module: "manuscript",
      id: c.id,
      title: chapterLabel(c, manuscript.books),
      subtitle: snippet(plain(c.content)),
      text: [plain(c.content), c.synopsis, ...(c.notes || []).map((n) => n?.text)].join("\n"),
      color: "#c9944a",
    });
  }
  // У карточек доски нет отдельного экрана-редактора с фокусом по id
  // (board.js правит их прямо внутри колонок) — переход просто
  // открывает доску, без подсветки конкретной карточки.
  const allBoards = flattenBoards(board);
  for (const col of allBoards.columns) {
    for (const cardId of allBoards.cardOrder[col.id] || []) {
      const card = allBoards.cards[cardId];
      if (card) entries.push({ module: "board", id: null, title: card.title, subtitle: col.title, color: "#9a9250" });
    }
  }

  // У связи нет своего раздела (мини-редактор — прямо в дровере
  // персонажа, characters.js) — переход открывает charA, там она и
  // правится; main.js подменяет module "relationships" на "characters"
  // при навигации, здесь же id — сразу нужного персонажа, не null.
  const charName = (id) => characters.find((c) => c.id === id)?.name || i18n("?");
  for (const r of relationships) {
    entries.push({
      module: "relationships",
      id: r.charA,
      title: `${charName(r.charA)} ↔ ${charName(r.charB)}`,
      subtitle: snippet(r.label || r.note),
      color: "#5a8a5f",
    });
  }

  // Знания — как и Доска, без своего экрана с фокусом по id
  // (renderKnowledge принимает только root, без второго аргумента) —
  // переход просто открывает раздел целиком, найти нужную запись в
  // нём — уже глазами.
  for (const f of knowledge.facts || []) {
    entries.push({ module: "knowledge", id: null, title: f.label || i18n("Без названия"), subtitle: snippet(f.note), color: "#b5636b" });
  }

  // Карточки холста — у renderCanvas есть фокус по id (focusCardId,
  // canvas.js): переход открывает нужную доску и центрирует вид прямо
  // на этой карточке, а не только сам холст целиком.
  for (const cv of Object.values(canvas.canvases || {})) {
    for (const card of cv.cards || []) {
      const title = card.title || snippet(card.text, 40) || i18n("Без названия");
      entries.push({
        module: "canvas",
        id: card.id,
        title,
        subtitle: snippet(card.title ? card.text : cv.name),
        color: card.color || "#7d6a9e",
      });
    }
  }

  return entries;
}

async function refreshIndex() {
  index = await buildIndex().catch(() => []);
  indexLoadedAt = Date.now();
}

function ensureOverlay() {
  if (overlay) return;
  overlay = document.createElement("div");
  overlay.className = "search-overlay hidden";
  overlay.innerHTML = `<div class="search-modal"><input type="text" class="search-input" placeholder="${i18n("Персонажи, локации, фракции, таймлайн, рукопись, связи, знания, холст…")}" /><div class="search-results"></div></div>`;
  document.body.appendChild(overlay);
  input = overlay.querySelector(".search-input");
  list = overlay.querySelector(".search-results");

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  input.addEventListener("input", () => renderResults(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
    if (e.key === "Enter") list.querySelector(".search-result")?.click();
  });
}

function appendGroupLabel(text) {
  const label = document.createElement("div");
  label.className = "search-group-label";
  label.textContent = text;
  list.appendChild(label);
}

function appendContentRow(m, labels) {
  const row = document.createElement("button");
  row.className = "search-result";
  row.style.setProperty("--result-color", m.color);
  row.innerHTML =
    // ?? а не || — renderRecent намеренно передаёт "" для разделов без
    // карточек по id (Доска/Знания), чтобы не дублировать название раздела
    // ещё и типом рядом ("Доска" + бейдж "Доска"); || бы счёл пустую
    // строку отсутствующим значением и откатился к m.module.
    `<span class="search-result-type">${m.typeLabel ? escapeHtml(m.typeLabel) : labels[m.module] ?? m.module}</span>` +
    `<span class="search-result-title">${escapeHtml(m.title || i18n("Без названия"))}</span>` +
    (m.subtitle ? `<span class="search-result-sub">${escapeHtml(m.subtitle)}</span>` : "");
  row.addEventListener("click", () => {
    close();
    onNavigate?.(m.module, m.id);
  });
  list.appendChild(row);
}

function appendCommandRow(cmd) {
  const row = document.createElement("button");
  row.className = "search-result search-result-command";
  row.innerHTML =
    `<span class="search-result-icon">${iconSvg(cmd.icon, 16)}</span>` +
    `<span class="search-result-title">${escapeHtml(cmd.label)}</span>`;
  row.addEventListener("click", () => {
    close();
    cmd.run(onNavigate);
  });
  list.appendChild(row);
}

// Пустой запрос — не "ничего не найдено", а список недавно открытого
// (recent-nav.js), тем же приёмом MRU, что и в палитре VS Code/Obsidian:
// на пустой ввод есть что показать сразу, не заставляя вспоминать
// заголовок или набирать хоть одну букву.
function renderRecent() {
  const recents = readRecent();
  if (!recents.length) return;
  const sections = sectionLabels();
  // Бейдж типа скрываем только у разделов без карточек по id — иначе
  // "Доска" в заголовке ещё и подписана "Карточка" рядом, что путает
  // больше, чем помогает.
  const labels = { ...moduleLabels(), ...Object.fromEntries(Object.keys(sections).map((k) => [k, ""])) };
  const rows = [];
  for (const r of recents) {
    if (r.id != null) {
      const match = index.find((e) => e.module === r.module && e.id === r.id);
      if (match) rows.push(match);
    } else if (sections[r.module]) {
      rows.push({ module: r.module, id: null, title: sections[r.module], subtitle: "", color: "#7c7157" });
    }
  }
  if (!rows.length) return;
  appendGroupLabel(i18n("Недавнее"));
  for (const m of rows.slice(0, 6)) appendContentRow(m, labels);
}

function renderResults(query) {
  const q = query.trim().toLowerCase();
  list.innerHTML = "";
  if (!q) {
    renderRecent();
    return;
  }
  const contentMatches = [];
  for (const e of index) {
    if (contentMatches.length >= 20) break;
    if ((e.title || "").toLowerCase().includes(q) || (e.subtitle || "").toLowerCase().includes(q)) contentMatches.push(e);
    else {
      const where = e.text && contextSnippet(e.text, q);
      if (where) contentMatches.push({ ...e, subtitle: where });
    }
  }
  const commandMatches = commandList()
    .filter((c) => c.label.toLowerCase().includes(q))
    .slice(0, 6);

  if (!contentMatches.length && !commandMatches.length) {
    list.innerHTML = `<div class="search-empty">${i18n("Ничего не найдено")}</div>`;
    return;
  }

  if (contentMatches.length) {
    const labels = moduleLabels();
    appendGroupLabel(i18n("Найдено"));
    for (const m of contentMatches) appendContentRow(m, labels);
  }
  if (commandMatches.length) {
    appendGroupLabel(i18n("Действия"));
    for (const c of commandMatches) appendCommandRow(c);
  }
}

function close() {
  overlay?.classList.add("hidden");
}

// query — сразу искать это (дневник письма: «где это слово»).
export async function openSearch(query = "") {
  ensureOverlay();
  overlay.classList.remove("hidden");
  input.value = query;
  input.focus();
  if (Date.now() - indexLoadedAt > 5000) await refreshIndex();
  renderResults(query); // индекс (для резолва недавнего) уже свежий на этот момент
}

// navigate(module, focusId) — вызывающая сторона (main.js) решает, как
// переключить модуль; здесь мы не знаем и не должны знать про openModule.
export function initSearch(navigate) {
  onNavigate = navigate;
  document.addEventListener("keydown", (e) => {
    // Физическая клавиша (e.code), а не символ (e.key) — по той же
    // причине, что и в shortcuts.js: на русской раскладке та же клавиша
    // отдаёт в e.key не "/", а "." (она стоит на месте точки), и поиск
    // молча переставал бы открываться при переключении раскладки.
    // "/" открывает поиск — но не когда фокус уже в поле ввода/тексте
    // главы, иначе там нельзя было бы напечатать сам слэш.
    const tag = document.activeElement?.tagName;
    const typing = tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable;
    if (e.code === "Slash" && !e.ctrlKey && !e.metaKey && !e.altKey && !typing) {
      e.preventDefault();
      openSearch();
    }
  });
}
