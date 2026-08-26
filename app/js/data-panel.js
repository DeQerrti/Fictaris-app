import { apiGet, apiPost } from "./api.js";
import { buildDemoBundle } from "./demo-data.js";

const SCHEMA_VERSION = 1;
const EMPTY_MANUSCRIPT = { chapters: [], activeChapterId: null };
const EMPTY_BOARD = { columns: [], cards: {}, cardOrder: {} };

async function fetchAll() {
  const [characters, locations, relationships, timeline, board, manuscript] = await Promise.all([
    apiGet("/api/characters"),
    apiGet("/api/locations"),
    apiGet("/api/relationships"),
    apiGet("/api/timeline"),
    apiGet("/api/board"),
    apiGet("/api/manuscript"),
  ]);
  return { characters, locations, relationships, timeline, board, manuscript };
}

// Полная замена — импорт и «Заполнить примером» идут одним и тем же
// путём, чтобы не держать два места, которые пишут во все шесть файлов.
async function applyAll(bundle) {
  await Promise.all([
    apiPost("/api/characters", Array.isArray(bundle.characters) ? bundle.characters : []),
    apiPost("/api/locations", Array.isArray(bundle.locations) ? bundle.locations : []),
    apiPost("/api/relationships", Array.isArray(bundle.relationships) ? bundle.relationships : []),
    apiPost("/api/timeline", Array.isArray(bundle.timeline) ? bundle.timeline : []),
    apiPost("/api/board", bundle.board && Array.isArray(bundle.board.columns) ? bundle.board : EMPTY_BOARD),
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

  root.appendChild(wrap);
}

function buildExportSection() {
  const section = document.createElement("div");
  section.className = "data-section";
  section.innerHTML =
    "<h3>Экспорт проекта</h3><p>Один JSON-файл со всеми модулями: персонажи, локации, связи, таймлайн, доска, рукопись.</p>";
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
    "<h3>Заполнить примером</h3><p>Связный тестовый сюжет — персонажи, локации, связи, таймлайн, доска и две главы рукописи, чтобы сразу увидеть, как модули работают вместе.</p>";

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
