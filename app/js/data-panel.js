import { apiGet, apiPost } from "./api.js";
import { buildDemoBundle } from "./demo-data.js";
import { exportSiteZip } from "./export-site.js";
import { exportWorldPdf } from "./export-pdf.js";
import { diffLines, collapseContext } from "./diff.js";
import { iconSvg } from "./icons.js";
import { i18n } from "./i18n.js";

const SCHEMA_VERSION = 1;
const EMPTY_MANUSCRIPT = { chapters: [], activeChapterId: null };
const EMPTY_BOARD = { columns: [], cards: {}, cardOrder: {} };
const EMPTY_MAP = { rootIds: [], maps: {} };
const EMPTY_PLOT = { nodes: [], edges: [] };
const EMPTY_KNOWLEDGE = { facts: [] };

async function fetchAll() {
  const [characters, locations, relationships, factions, timeline, board, map, manuscript, plot, knowledge] = await Promise.all([
    apiGet("/api/characters"),
    apiGet("/api/locations"),
    apiGet("/api/relationships"),
    apiGet("/api/factions"),
    apiGet("/api/timeline"),
    apiGet("/api/board"),
    apiGet("/api/map"),
    apiGet("/api/manuscript"),
    apiGet("/api/plot"),
    apiGet("/api/knowledge"),
  ]);
  return { characters, locations, relationships, factions, timeline, board, map, manuscript, plot, knowledge };
}

// Полная замена — импорт и «Заполнить примером» идут одним и тем же
// путём, чтобы не держать два места, которые пишут во все десять
// файлов. Карта переносит только структуру (метки, названия под-карт) —
// сами картинки лежат файлами в maps/ и в JSON-экспорт не попадают.
async function applyAll(bundle) {
  await Promise.all([
    apiPost("/api/characters", Array.isArray(bundle.characters) ? bundle.characters : []),
    apiPost("/api/locations", Array.isArray(bundle.locations) ? bundle.locations : []),
    apiPost("/api/relationships", Array.isArray(bundle.relationships) ? bundle.relationships : []),
    apiPost("/api/factions", Array.isArray(bundle.factions) ? bundle.factions : []),
    apiPost("/api/timeline", Array.isArray(bundle.timeline) ? bundle.timeline : []),
    apiPost("/api/board", bundle.board && Array.isArray(bundle.board.columns) ? bundle.board : EMPTY_BOARD),
    apiPost("/api/map", bundle.map && typeof bundle.map.maps === "object" ? bundle.map : EMPTY_MAP),
    apiPost("/api/manuscript", bundle.manuscript && Array.isArray(bundle.manuscript.chapters) ? bundle.manuscript : EMPTY_MANUSCRIPT),
    apiPost("/api/plot", bundle.plot && Array.isArray(bundle.plot.nodes) ? bundle.plot : EMPTY_PLOT),
    apiPost("/api/knowledge", bundle.knowledge && Array.isArray(bundle.knowledge.facts) ? bundle.knowledge : EMPTY_KNOWLEDGE),
  ]);
}

// Используется онбордингом (onboarding.js) — тот же путь, что и кнопка
// «Заполнить примером» ниже, но без подтверждения: на первом запуске
// заменять нечего, проект и так пуст.
export async function fillWithDemoData() {
  await applyAll(await buildDemoBundle());
  location.reload();
}

// Инлайн-подтверждение вместо browser confirm() — общая полоска
// «сообщение + Да/Отмена», которую показывает и импорт, и демо-данные.
function showConfirmBar(bar, message, onConfirm) {
  bar.innerHTML = "";
  bar.className = "confirm-bar";
  const text = document.createElement("span");
  text.textContent = message;
  const yes = document.createElement("button");
  yes.className = "btn danger";
  yes.textContent = i18n("Да, заменить");
  yes.addEventListener("click", () => {
    bar.innerHTML = "";
    onConfirm();
  });
  const no = document.createElement("button");
  no.className = "btn";
  no.textContent = i18n("Отмена");
  no.addEventListener("click", () => {
    bar.innerHTML = "";
  });
  bar.append(text, yes, no);
}

// Экспортируются как набор секций, а не готовый экран (как раньше
// renderData(root)) — «Данные» теперь одна из вкладок Настроек
// (settings-panel.js), а не отдельный пункт сайдбара, и вкладке нужны
// именно секции, чтобы вписать их в общий контейнер вкладки самой.
export function buildDataSections() {
  return [buildExportSection(), buildSiteExportSection(), buildPdfExportSection(), buildImportSection(), buildDemoSection(), buildHistorySection()];
}

function historyFiles() {
  return [
    ["characters.json", i18n("Персонажи")],
    ["locations.json", i18n("Локации")],
    ["relationships.json", i18n("Связи")],
    ["factions.json", i18n("Фракции")],
    ["timeline.json", i18n("Таймлайн")],
    ["board.json", i18n("Доска")],
    ["map.json", i18n("Карта")],
    ["canvas.json", i18n("Холст")],
    ["manuscript.json", i18n("Рукопись")],
    ["writing-log.json", i18n("Писательская серия")],
    ["plot.json", i18n("Карта сюжета")],
    ["knowledge.json", i18n("Знания")],
  ];
}

// days: null/0 — автоочистка выключена. Ключ в site-settings.json —
// свойство устройства-независимое, живёт с самим проектом, как и всё
// остальное там: открыл тот же vault с другого компьютера — та же
// настройка, а не заново её включать.
const AUTO_CLEANUP_OPTIONS = [
  [0, "Никогда"],
  [7, "Раз в неделю"],
  [30, "Раз в месяц"],
  [182, "Раз в полгода"],
  [365, "Раз в год"],
];

// Раз в день максимум (при каждом запуске приложения, но не чаще) —
// сама очистка не заводит фоновый таймер (десктоп-приложение не всегда
// открыто, ждать неделю в фоне бессмысленно), а просто проверяет при
// каждом старте, не пора ли, и досрочно ничего не трогает.
const CLEANUP_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export async function maybeRunHistoryCleanup() {
  const settings = await apiGet("/api/site-settings").catch(() => ({}));
  const days = Number(settings.historyCleanupDays) || 0;
  if (days <= 0) return;
  const last = Date.parse(settings.historyCleanupLastRun || "");
  if (Number.isFinite(last) && Date.now() - last < CLEANUP_CHECK_INTERVAL_MS) return;
  await apiPost("/api/history/cleanup", { days }).catch(() => {});
  await apiPost("/api/site-settings", { ...settings, historyCleanupLastRun: new Date().toISOString() }).catch(() => {});
}

// Vault пишет .history на каждое сохранение (см. electron/vault.js) —
// здесь просто витрина для того, что уже лежит на диске: посмотреть
// прошлые версии файла модуля, откатиться на любую из них или стереть
// её насовсем, плюс настройка автоочистки старых версий целиком.
function buildHistorySection() {
  const section = document.createElement("div");
  section.className = "data-section";
  section.innerHTML = `<h3>${i18n("История версий")}</h3><p>${i18n("Каждое сохранение оставляет прошлую версию файла в папке")} <code>.history</code>. ${i18n("Выбери модуль, чтобы увидеть его версии.")}</p>`;

  const cleanupRow = document.createElement("div");
  cleanupRow.className = "sync-actions";
  const cleanupLabel = document.createElement("span");
  cleanupLabel.textContent = i18n("Автоочистка старых версий: ");
  cleanupLabel.style.color = "var(--text-dim)";
  const cleanupSelect = document.createElement("select");
  for (const [days, label] of AUTO_CLEANUP_OPTIONS) {
    const opt = document.createElement("option");
    opt.value = days;
    opt.textContent = i18n(label);
    cleanupSelect.appendChild(opt);
  }
  apiGet("/api/site-settings").then((s) => {
    cleanupSelect.value = Number(s?.historyCleanupDays) || 0;
  });
  cleanupSelect.addEventListener("change", async () => {
    const s = (await apiGet("/api/site-settings").catch(() => ({}))) || {};
    await apiPost("/api/site-settings", { ...s, historyCleanupDays: Number(cleanupSelect.value) });
  });
  cleanupRow.append(cleanupLabel, cleanupSelect);
  section.appendChild(cleanupRow);

  const select = document.createElement("select");
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = i18n("Выбери модуль…");
  select.appendChild(placeholder);
  for (const [file, label] of historyFiles()) {
    const opt = document.createElement("option");
    opt.value = file;
    opt.textContent = label;
    select.appendChild(opt);
  }
  section.appendChild(select);

  const list = document.createElement("div");
  list.className = "history-list";
  section.appendChild(list);

  select.addEventListener("change", async () => {
    list.innerHTML = "";
    if (!select.value) return;
    const versions = await apiGet(`/api/history?file=${encodeURIComponent(select.value)}`);
    if (!versions.length) {
      list.innerHTML = `<div class="empty-state">${i18n("Пока нет прошлых версий — история появляется со второго сохранения.")}</div>`;
      return;
    }
    for (const v of versions) {
      list.appendChild(buildHistoryRow(select.value, v));
    }
  });

  return section;
}

// Та же строка "characters.json" и так же выглядит как путь к её
// собственному REST-маршруту без ".json" — /api/characters,
// /api/manuscript и т.д. — совпадение не случайное (см. core/api.js),
// поэтому отдельной таблицы соответствий не заводим.
function currentDataApi(file) {
  return `/api/${file.replace(/\.json$/, "")}`;
}

// Показывает построчный diff между версией из истории и текущим
// содержимым файла — обе стороны через JSON.stringify(..., null, 2),
// см. app/js/diff.js о том, почему построчно по всему файлу, а не по
// одной карточке. diffLines сама обрезает одинаковые края перед
// сравнением и возвращает null, если оставшееся различие всё равно
// больше DIFF_LINE_LIMIT — тогда вместо зависшей вкладки честно
// говорим, что не считаем, а не тихо виснем.
async function buildDiffPanel(file, version) {
  const panel = document.createElement("div");
  panel.className = "history-diff";
  panel.textContent = i18n("Считаю разницу…");

  let current, past;
  try {
    [current, past] = await Promise.all([apiGet(currentDataApi(file)), apiGet(`/api/history/version?file=${encodeURIComponent(file)}&id=${encodeURIComponent(version.id)}`)]);
  } catch {
    panel.textContent = i18n("Не получилось загрузить это сравнение.");
    return panel;
  }

  const oldLines = JSON.stringify(past, null, 2).split("\n");
  const newLines = JSON.stringify(current, null, 2).split("\n");

  const rows = diffLines(oldLines, newLines);
  if (!rows) {
    panel.textContent = i18n("Файл слишком большой для построчного сравнения — воспользуйся «Восстановить», если нужно вернуть именно эту версию.");
    return panel;
  }
  if (rows.every((r) => r.type === "equal")) {
    panel.textContent = i18n("Между этой версией и текущим состоянием нет отличий.");
    return panel;
  }

  panel.textContent = "";
  const pre = document.createElement("pre");
  pre.className = "history-diff-pre";
  for (const r of collapseContext(rows)) {
    const line = document.createElement("div");
    if (r.type === "gap") {
      line.className = "diff-line diff-gap";
      line.textContent = i18n("… ещё {count} неизменных строк …", { count: r.count });
    } else {
      line.className = "diff-line diff-" + r.type;
      line.textContent = (r.type === "add" ? "+ " : r.type === "del" ? "- " : "  ") + r.text;
    }
    pre.appendChild(line);
  }
  panel.appendChild(pre);
  return panel;
}

function buildHistoryRow(file, version) {
  const wrap = document.createElement("div");
  wrap.className = "history-row-wrap";

  const row = document.createElement("div");
  row.className = "history-row";
  wrap.appendChild(row);

  const date = document.createElement("span");
  const parsed = new Date(version.date);
  date.textContent = Number.isNaN(parsed.getTime()) ? version.date : parsed.toLocaleString();
  row.appendChild(date);

  const diffBtn = document.createElement("button");
  diffBtn.className = "btn";
  diffBtn.textContent = i18n("Сравнить с текущей");
  let diffPanel = null;
  diffBtn.addEventListener("click", async () => {
    if (diffPanel) {
      diffPanel.remove();
      diffPanel = null;
      diffBtn.textContent = i18n("Сравнить с текущей");
      return;
    }
    diffBtn.textContent = i18n("Скрыть сравнение");
    diffPanel = await buildDiffPanel(file, version);
    wrap.appendChild(diffPanel);
  });

  const btn = document.createElement("button");
  btn.className = "btn";
  btn.textContent = i18n("Восстановить");
  btn.addEventListener("click", () => {
    if (btn.dataset.confirm === "1") {
      apiPost("/api/history/restore", { file, id: version.id }).then(() => location.reload());
      return;
    }
    btn.dataset.confirm = "1";
    btn.textContent = i18n("Заменит текущую версию. Точно?");
    setTimeout(() => {
      btn.dataset.confirm = "";
      btn.textContent = i18n("Восстановить");
    }, 4000);
  });
  const actions = document.createElement("div");
  actions.className = "history-row-actions";
  actions.append(diffBtn, btn);

  const delBtn = document.createElement("button");
  delBtn.className = "btn danger";
  delBtn.innerHTML = iconSvg("trash", 14);
  delBtn.title = i18n("Удалить этот снимок навсегда");
  delBtn.addEventListener("click", () => {
    if (delBtn.dataset.confirm === "1") {
      apiPost("/api/history/delete", { file, id: version.id }).then(() => wrap.remove());
      return;
    }
    delBtn.dataset.confirm = "1";
    delBtn.textContent = i18n("Точно?");
    setTimeout(() => {
      delBtn.dataset.confirm = "";
      delBtn.innerHTML = iconSvg("trash", 14);
    }, 4000);
  });
  actions.appendChild(delBtn);
  row.appendChild(actions);

  return wrap;
}

function buildExportSection() {
  const section = document.createElement("div");
  section.className = "data-section";
  section.innerHTML = `<h3>${i18n("Экспорт проекта")}</h3><p>${i18n("Один JSON-файл со всеми модулями: персонажи, локации, связи, фракции, таймлайн, доска, карта (только метки — картинки остаются файлами на диске), карта сюжета, знания, рукопись.")}</p>`;
  const btn = document.createElement("button");
  btn.className = "btn";
  btn.textContent = i18n("Экспортировать");
  btn.addEventListener("click", async () => {
    const data = await fetchAll();
    const bundle = { schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), ...data };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fictaris-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
  section.appendChild(btn);
  return section;
}

// Отдельно от JSON-экспорта выше — тот для переноса данных обратно в
// Fictaris (импорт/резервная копия), этот для показа мира кому-то
// постороннему: набор HTML-страниц с рабочими ссылками между
// персонажами/локациями/фракциями/таймлайном, который открывается в
// любом браузере без самого приложения. См. export-site.js.
function buildSiteExportSection() {
  const section = document.createElement("div");
  section.className = "data-section";
  section.innerHTML = `<h3>${i18n("Экспорт мира как сайта")}</h3><p>${i18n("Персонажи, локации, фракции и таймлайн — набором связанных HTML-страниц в архиве. Открывается в браузере у кого угодно, без интернета и без Fictaris — чтобы показать мир бета-ридеру или просто сохранить читаемый снимок.")}</p>`;
  const btn = document.createElement("button");
  btn.className = "btn";
  btn.textContent = i18n("Экспортировать сайт");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = i18n("Собираю…");
    try {
      await exportSiteZip();
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });
  section.appendChild(btn);
  return section;
}

// Только десктоп: печатает через Electron/Chromium (см. комментарий в
// electron/main.js о том, почему не свой PDF-писатель) — на телефоне/
// в браузере POST /api/app/export-pdf отвечать некому, и клик честно
// говорит об этом, а не зависает молча.
function buildPdfExportSection() {
  const section = document.createElement("div");
  section.className = "data-section";
  section.innerHTML = `<h3>${i18n("Экспорт мира в PDF")}</h3><p>${i18n("Тот же материал, что и в экспорте сайта, — одним печатным документом: обложка, персонажи, локации, фракции, таймлайн, со ссылками внутри файла. Доступно в десктопной версии.")}</p>`;
  const btn = document.createElement("button");
  btn.className = "btn";
  btn.textContent = i18n("Экспортировать PDF");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = i18n("Готовлю…");
    try {
      const res = await exportWorldPdf();
      if (res && res.ok === false) return; // диалог сохранения отменили — не ошибка
    } catch (e) {
      alert(e.message || i18n("Не получилось создать PDF. Доступно только в десктопной версии Fictaris."));
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });
  section.appendChild(btn);
  return section;
}

function buildImportSection() {
  const section = document.createElement("div");
  section.className = "data-section";
  section.innerHTML = `<h3>${i18n("Импорт проекта")}</h3><p>${i18n("Полностью заменяет текущие данные содержимым файла. Сохрани экспорт перед импортом, если сомневаешься — отменить нельзя.")}</p>`;

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "application/json";
  fileInput.style.display = "none";

  const btn = document.createElement("button");
  btn.className = "btn";
  btn.textContent = i18n("Импортировать…");
  btn.addEventListener("click", () => fileInput.click());

  const confirmBar = document.createElement("div");

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    let bundle;
    try {
      bundle = JSON.parse(await file.text());
    } catch {
      alert(i18n("Файл повреждён или это не JSON."));
      return;
    }
    showConfirmBar(confirmBar, i18n("Заменить все текущие данные содержимым файла?"), async () => {
      await applyAll(bundle);
      location.reload();
    });
  });

  section.append(btn, fileInput, confirmBar);
  return section;
}

function buildDemoSection() {
  const section = document.createElement("div");
  section.className = "data-section";
  section.innerHTML = `<h3>${i18n("Заполнить примером")}</h3><p>${i18n("Связный тестовый сюжет — персонажи, локации, связи, фракции, таймлайн, доска, карта и две главы рукописи, чтобы сразу увидеть, как модули работают вместе.")}</p>`;

  const btn = document.createElement("button");
  btn.className = "btn";
  btn.textContent = i18n("Заполнить примером…");
  const confirmBar = document.createElement("div");
  btn.addEventListener("click", () => {
    showConfirmBar(confirmBar, i18n("Текущие данные будут заменены примером. Продолжить?"), async () => {
      await applyAll(await buildDemoBundle());
      location.reload();
    });
  });

  section.append(btn, confirmBar);
  return section;
}
