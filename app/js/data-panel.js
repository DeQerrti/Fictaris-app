import { apiGet, apiPost } from "./api.js";
import { buildDemoBundle } from "./demo-data.js";
import { i18n } from "./i18n.js";

const SCHEMA_VERSION = 1;
const EMPTY_MANUSCRIPT = { chapters: [], activeChapterId: null };
const EMPTY_BOARD = { columns: [], cards: {}, cardOrder: {} };
const EMPTY_MAP = { rootIds: [], maps: {} };

async function fetchAll() {
  const [characters, locations, relationships, factions, timeline, board, map, manuscript] = await Promise.all([
    apiGet("/api/characters"),
    apiGet("/api/locations"),
    apiGet("/api/relationships"),
    apiGet("/api/factions"),
    apiGet("/api/timeline"),
    apiGet("/api/board"),
    apiGet("/api/map"),
    apiGet("/api/manuscript"),
  ]);
  return { characters, locations, relationships, factions, timeline, board, map, manuscript };
}

// Полная замена — импорт и «Заполнить примером» идут одним и тем же
// путём, чтобы не держать два места, которые пишут во все восемь файлов.
// Карта переносит только структуру (метки, названия под-карт) — сами
// картинки лежат файлами в maps/ и в JSON-экспорт не попадают.
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
  return [buildExportSection(), buildImportSection(), buildDemoSection(), buildHistorySection()];
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
    ["manuscript.json", i18n("Рукопись")],
  ];
}

// Vault пишет .history на каждое сохранение (см. electron/vault.js) —
// здесь просто витрина для того, что уже лежит на диске: посмотреть
// прошлые версии файла модуля и откатиться на любую из них.
function buildHistorySection() {
  const section = document.createElement("div");
  section.className = "data-section";
  section.innerHTML = `<h3>${i18n("История версий")}</h3><p>${i18n("Каждое сохранение оставляет прошлую версию файла в папке")} <code>.history</code>. ${i18n("Выбери модуль, чтобы увидеть его версии.")}</p>`;

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

function buildHistoryRow(file, version) {
  const row = document.createElement("div");
  row.className = "history-row";

  const date = document.createElement("span");
  const parsed = new Date(version.date);
  date.textContent = Number.isNaN(parsed.getTime()) ? version.date : parsed.toLocaleString();
  row.appendChild(date);

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
  row.appendChild(btn);

  return row;
}

function buildExportSection() {
  const section = document.createElement("div");
  section.className = "data-section";
  section.innerHTML = `<h3>${i18n("Экспорт проекта")}</h3><p>${i18n("Один JSON-файл со всеми модулями: персонажи, локации, связи, фракции, таймлайн, доска, карта (только метки — картинки остаются файлами на диске), рукопись.")}</p>`;
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
