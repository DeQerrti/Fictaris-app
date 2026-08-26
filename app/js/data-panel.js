import { apiGet, apiPost } from "./api.js";
import { buildDemoBundle } from "./demo-data.js";

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

// Инлайн-подтверждение вместо browser confirm() — общая полоска
// «сообщение + Да/Отмена», которую показывает и импорт, и демо-данные.
function showConfirmBar(bar, message, onConfirm) {
  bar.innerHTML = "";
  bar.className = "confirm-bar";
  const text = document.createElement("span");
  text.textContent = message;
  const yes = document.createElement("button");
  yes.className = "btn danger";
  yes.textContent = "Да, заменить";
  yes.addEventListener("click", () => {
    bar.innerHTML = "";
    onConfirm();
  });
  const no = document.createElement("button");
  no.className = "btn";
  no.textContent = "Отмена";
  no.addEventListener("click", () => {
    bar.innerHTML = "";
  });
  bar.append(text, yes, no);
}

export async function renderData(root) {
  root.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "data-panel";

  wrap.appendChild(buildExportSection());
  wrap.appendChild(buildImportSection());
  wrap.appendChild(buildDemoSection());
  wrap.appendChild(buildHistorySection());

  root.appendChild(wrap);
}

const HISTORY_FILES = [
  ["characters.json", "Персонажи"],
  ["locations.json", "Локации"],
  ["relationships.json", "Связи"],
  ["factions.json", "Фракции"],
  ["timeline.json", "Таймлайн"],
  ["board.json", "Доска"],
  ["map.json", "Карта"],
  ["manuscript.json", "Рукопись"],
];

// Vault пишет .history на каждое сохранение (см. electron/vault.js) —
// здесь просто витрина для того, что уже лежит на диске: посмотреть
// прошлые версии файла модуля и откатиться на любую из них.
function buildHistorySection() {
  const section = document.createElement("div");
  section.className = "data-section";
  section.innerHTML =
    "<h3>История версий</h3><p>Каждое сохранение оставляет прошлую версию файла в папке <code>.history</code>. Выбери модуль, чтобы увидеть его версии.</p>";

  const select = document.createElement("select");
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Выбери модуль…";
  select.appendChild(placeholder);
  for (const [file, label] of HISTORY_FILES) {
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
      list.innerHTML = '<div class="empty-state">Пока нет прошлых версий — история появляется со второго сохранения.</div>';
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
  btn.textContent = "Восстановить";
  btn.addEventListener("click", () => {
    if (btn.dataset.confirm === "1") {
      apiPost("/api/history/restore", { file, id: version.id }).then(() => location.reload());
      return;
    }
    btn.dataset.confirm = "1";
    btn.textContent = "Заменит текущую версию. Точно?";
    setTimeout(() => {
      btn.dataset.confirm = "";
      btn.textContent = "Восстановить";
    }, 4000);
  });
  row.appendChild(btn);

  return row;
}

function buildExportSection() {
  const section = document.createElement("div");
  section.className = "data-section";
  section.innerHTML =
    "<h3>Экспорт проекта</h3><p>Один JSON-файл со всеми модулями: персонажи, локации, связи, фракции, таймлайн, доска, карта (только метки — картинки остаются файлами на диске), рукопись.</p>";
  const btn = document.createElement("button");
  btn.className = "btn";
  btn.textContent = "Экспортировать";
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
  section.innerHTML =
    "<h3>Импорт проекта</h3><p>Полностью заменяет текущие данные содержимым файла. Сохрани экспорт перед импортом, если сомневаешься — отменить нельзя.</p>";

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "application/json";
  fileInput.style.display = "none";

  const btn = document.createElement("button");
  btn.className = "btn";
  btn.textContent = "Импортировать…";
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
      alert("Файл повреждён или это не JSON.");
      return;
    }
    showConfirmBar(confirmBar, "Заменить все текущие данные содержимым файла?", async () => {
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
  section.innerHTML =
    "<h3>Заполнить примером</h3><p>Связный тестовый сюжет — персонажи, локации, связи, фракции, таймлайн, доска и две главы рукописи, чтобы сразу увидеть, как модули работают вместе.</p>";

  const btn = document.createElement("button");
  btn.className = "btn";
  btn.textContent = "Заполнить примером…";
  const confirmBar = document.createElement("div");
  btn.addEventListener("click", () => {
    showConfirmBar(confirmBar, "Текущие данные будут заменены примером. Продолжить?", async () => {
      await applyAll(buildDemoBundle());
      location.reload();
    });
  });

  section.append(btn, confirmBar);
  return section;
}
