import { apiGet, apiPost } from "./api.js";
import { buildDemoBundle } from "./demo-data.js";
import { THEME_PRESETS, saveTheme } from "./theme.js";
import { DEFAULT_LABELS, saveLabels, resetLabels } from "./labels.js";
import {
  getSyncConfig,
  saveSyncConfig,
  clearSyncConfig,
  getSyncState,
  checkGithubUser,
  repoExists,
  createRepo,
  runSync,
  resolveConflict,
  AUTOSYNC_CONFLICTS_KEY,
} from "./sync.js";

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

  const info = await apiGet("/api/app/info").catch(() => ({}));

  wrap.appendChild(await buildAppearanceSection());
  wrap.appendChild(await buildLabelsSection());
  wrap.appendChild(buildUpdateSection(info));
  wrap.appendChild(buildSyncSection());
  wrap.appendChild(buildExportSection());
  wrap.appendChild(buildImportSection());
  wrap.appendChild(buildDemoSection());
  wrap.appendChild(buildHistorySection());

  root.appendChild(wrap);
}

async function buildAppearanceSection() {
  const section = document.createElement("div");
  section.className = "data-section";
  section.innerHTML = "<h3>Оформление</h3><p>Тема и акцентный цвет — применяются сразу, без перезагрузки.</p>";

  const settings = await apiGet("/api/site-settings").catch(() => ({}));
  const currentSkin = THEME_PRESETS[settings.theme] ? settings.theme : "dark";

  const swatches = document.createElement("div");
  swatches.className = "theme-swatches";

  const buttons = new Map();
  for (const [id, preset] of Object.entries(THEME_PRESETS)) {
    const btn = document.createElement("button");
    btn.className = "theme-swatch" + (id === currentSkin ? " active" : "");
    btn.dataset.skin = id;
    btn.innerHTML = `<span class="theme-swatch-preview" data-skin-preview="${id}"></span><span>${preset.label}</span><span class="theme-swatch-hint">${preset.hint}</span>`;
    btn.addEventListener("click", async () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      await saveTheme({ theme: id });
    });
    buttons.set(id, btn);
    swatches.appendChild(btn);
  }

  const accentRow = document.createElement("label");
  accentRow.className = "theme-accent-row";
  accentRow.textContent = "Акцентный цвет: ";
  const accentInput = document.createElement("input");
  accentInput.type = "color";
  accentInput.value = /^#[0-9a-f]{6}$/i.test(settings.accent || "")
    ? settings.accent
    : THEME_PRESETS[currentSkin].defaultAccent || "#c9944a";
  accentInput.addEventListener("input", () => saveTheme({ accent: accentInput.value }));
  accentRow.appendChild(accentInput);

  const resetBtn = document.createElement("button");
  resetBtn.className = "btn";
  resetBtn.textContent = "Сбросить акцент";
  resetBtn.addEventListener("click", async () => {
    await saveTheme({ accent: null });
    location.reload(); // проще перечитать цвет темы по умолчанию, чем тянуть его сюда из style.css
  });

  section.append(swatches, accentRow, resetBtn);
  return section;
}

async function buildLabelsSection() {
  const section = document.createElement("div");
  section.className = "data-section";
  section.innerHTML =
    "<h3>Подписи интерфейса</h3><p>Переименуй пункты меню под свою терминологию — применяется сразу, без перезагрузки.</p>";

  const current = window.SITE_LABELS || DEFAULT_LABELS;
  const grid = document.createElement("div");
  grid.className = "labels-grid";

  grid.appendChild(buildLabelRow("Название приложения", DEFAULT_LABELS.brand, current.brand, (value) => saveLabels({ brand: value })));
  for (const [key, defaultLabel] of Object.entries(DEFAULT_LABELS.nav)) {
    grid.appendChild(
      buildLabelRow(defaultLabel, defaultLabel, current.nav[key], (value) => saveLabels({ nav: { [key]: value } }))
    );
  }

  const resetBtn = document.createElement("button");
  resetBtn.className = "btn";
  resetBtn.textContent = "Сбросить все подписи";
  resetBtn.addEventListener("click", async () => {
    await resetLabels();
    location.reload(); // проще перечитать раздел заново, чем гонять новые значения по всем полям формы
  });

  section.append(grid, resetBtn);
  return section;
}

function buildLabelRow(caption, defaultValue, currentValue, onSave) {
  const row = document.createElement("div");
  row.className = "label-row";
  const label = document.createElement("span");
  label.className = "label-row-caption";
  label.textContent = caption;
  const input = document.createElement("input");
  input.type = "text";
  input.value = currentValue || defaultValue;
  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => onSave(input.value.trim() || defaultValue), 500);
  });
  row.append(label, input);
  return row;
}

// ── Синхронизация ────────────────────────────
// Сама логика (протокол, автосинхронизация) — в app/js/sync.js, здесь
// только экран: форма подключения либо статус + кнопки, плюс разбор
// конфликтов, если runSync их нашёл.

function buildSyncSection() {
  const section = document.createElement("div");
  section.className = "data-section";
  fillSyncSection(section);
  return section;
}

function fillSyncSection(section) {
  section.innerHTML = "<h3>Синхронизация</h3>";
  const config = getSyncConfig();
  section.appendChild(config ? buildSyncConnected(section, config) : buildSyncSetup(section));
}

function buildSyncSetup(section) {
  const wrap = document.createElement("div");

  const intro = document.createElement("p");
  intro.textContent =
    "Свободно и без своего сервера: приватный репозиторий на GitHub как общее хранилище для всех твоих устройств — телефона, компьютера, ещё одного компьютера. Токен и служебные данные синхронизации остаются только на этом устройстве.";

  const steps = document.createElement("ol");
  steps.className = "sync-steps";
  steps.innerHTML =
    "<li>Заведи аккаунт на github.com, если его ещё нет — бесплатно.</li>" +
    '<li>Создай токен доступа — <a href="https://github.com/settings/tokens/new?scopes=repo&description=Fictaris" target="_blank" rel="noopener">по этой ссылке</a>, галочка «repo» уже отмечена. Внизу страницы — «Generate token».</li>' +
    "<li>Скопируй токен (показывается один раз) и вставь сюда.</li>";

  const tokenLabel = document.createElement("label");
  tokenLabel.textContent = "Токен доступа";
  const tokenInput = document.createElement("input");
  tokenInput.type = "password";
  tokenInput.placeholder = "ghp_…";
  tokenInput.autocomplete = "off";

  const repoLabel = document.createElement("label");
  repoLabel.textContent = "Название репозитория";
  const repoInput = document.createElement("input");
  repoInput.type = "text";
  repoInput.value = "fictaris-vault";
  const repoHint = document.createElement("p");
  repoHint.className = "sync-hint";
  repoHint.textContent =
    "Если такого репозитория ещё нет на твоём GitHub — создадим сами, приватным. Если уже есть (например, второе устройство его уже завело) — подключимся к нему.";

  const btn = document.createElement("button");
  btn.className = "btn";
  btn.textContent = "Подключить";
  const status = document.createElement("div");
  status.className = "sync-status";

  btn.addEventListener("click", async () => {
    const token = tokenInput.value.trim();
    const repo = repoInput.value.trim();
    if (!token || !repo) {
      status.textContent = "Заполни токен и название репозитория.";
      return;
    }
    btn.disabled = true;
    status.textContent = "Проверяем токен…";
    try {
      const user = await checkGithubUser(token);
      const config = { token, owner: user.login, repo };
      status.textContent = "Проверяем репозиторий…";
      if (!(await repoExists(config))) {
        status.textContent = "Репозитория ещё нет — создаём…";
        await createRepo(config);
      }
      saveSyncConfig(config);
      fillSyncSection(section);
    } catch (e) {
      status.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  });

  wrap.append(intro, steps, tokenLabel, tokenInput, repoLabel, repoInput, repoHint, btn, status);
  return wrap;
}

function buildSyncConnected(section, config) {
  const state = getSyncState();
  const wrap = document.createElement("div");

  const intro = document.createElement("p");
  const link = `https://github.com/${config.owner}/${config.repo}`;
  const last = state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleString() : "ещё не было";
  intro.innerHTML = `Подключено к <a href="${link}" target="_blank" rel="noopener">${config.owner}/${config.repo}</a>. Последняя синхронизация: ${last}.`;

  const row = document.createElement("div");
  row.className = "sync-actions";
  const nowBtn = document.createElement("button");
  nowBtn.className = "btn accent";
  nowBtn.textContent = "Синхронизировать сейчас";
  const disconnectBtn = document.createElement("button");
  disconnectBtn.className = "btn";
  disconnectBtn.textContent = "Отключить";
  row.append(nowBtn, disconnectBtn);

  const status = document.createElement("div");
  status.className = "sync-status";
  const progress = document.createElement("div");
  progress.className = "sync-progress";
  const conflictsBox = document.createElement("div");
  conflictsBox.className = "sync-conflicts";

  nowBtn.addEventListener("click", () => startSync(config, nowBtn, status, progress, conflictsBox));

  let disconnectArmed = false;
  disconnectBtn.addEventListener("click", () => {
    if (!disconnectArmed) {
      disconnectArmed = true;
      disconnectBtn.textContent = "Точно отключить?";
      setTimeout(() => {
        disconnectArmed = false;
        disconnectBtn.textContent = "Отключить";
      }, 3000);
      return;
    }
    clearSyncConfig();
    fillSyncSection(section);
  });

  wrap.append(intro, row, status, progress, conflictsBox);

  // Конфликт, найденный автосинхронизацией в фоне, мог случиться, пока
  // человек не смотрел на этот раздел вовсе — открыв его, сразу
  // досчитываем ещё раз, а не заставляем сперва самому нажать кнопку.
  if (localStorage.getItem(AUTOSYNC_CONFLICTS_KEY) === "1") {
    startSync(config, nowBtn, status, progress, conflictsBox);
  }

  return wrap;
}

async function startSync(config, btn, status, progress, conflictsBox) {
  btn.disabled = true;
  conflictsBox.innerHTML = "";
  status.textContent = "Синхронизируем…";
  try {
    const result = await runSync(config, (done, total, path) => {
      progress.textContent = `${done} / ${total}: ${path}`;
    });
    progress.textContent = "";

    if (Object.keys(result.pulledFiles).length || Object.keys(result.pulledImages).length) {
      await apiPost("/api/restore-backup", {
        format: "fictaris-backup",
        files: result.pulledFiles,
        images: result.pulledImages,
      });
    }

    if (result.conflicts.length) {
      status.textContent = `Готово, но ${result.conflicts.length} файл(ов) изменились и здесь, и в репозитории — выбери, что оставить.`;
      renderConflicts(conflictsBox, config, result.conflicts);
    } else {
      status.textContent = `Готово: отправлено ${result.pushed}, забрано ${result.pulled}, без изменений ${result.skipped}.`;
    }

    if (Object.keys(result.pulledFiles).length || Object.keys(result.pulledImages).length) {
      setTimeout(() => location.reload(), 1200);
    }
  } catch (e) {
    status.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}

function renderConflicts(box, config, conflicts) {
  box.innerHTML = "";
  for (const conflict of conflicts) {
    const row = document.createElement("div");
    row.className = "sync-conflict-row";
    const title = document.createElement("span");
    title.textContent = conflict.path;
    const localBtn = document.createElement("button");
    localBtn.className = "btn";
    localBtn.textContent = "Оставить моё";
    const remoteBtn = document.createElement("button");
    remoteBtn.className = "btn";
    remoteBtn.textContent = "Взять оттуда";
    localBtn.addEventListener("click", () => pickConflict(config, conflict, "local", row));
    remoteBtn.addEventListener("click", () => pickConflict(config, conflict, "remote", row));
    row.append(title, localBtn, remoteBtn);
    box.appendChild(row);
  }
}

async function pickConflict(config, conflict, choice, row) {
  try {
    const remoteValue = await resolveConflict(config, conflict, choice);
    if (choice === "remote") {
      const payload = conflict.kind === "images" ? { images: { [conflict.path]: remoteValue } } : { files: { [conflict.path]: remoteValue } };
      await apiPost("/api/restore-backup", { format: "fictaris-backup", ...payload });
    }
    row.remove();
    if (choice === "remote") setTimeout(() => location.reload(), 800);
  } catch (e) {
    alert(e.message);
  }
}

function updateStatusText(res) {
  if (res.status === "latest") return "У тебя последняя версия.";
  if (res.status === "downloading") return `Скачивается обновление ${res.version}…`;
  if (res.status === "available") return `Доступно обновление ${res.version}.`;
  if (res.status === "dev") return "Проверка недоступна в режиме разработки (npm start).";
  return "Не удалось проверить обновления — нет сети или GitHub недоступен.";
}

function buildUpdateSection(info) {
  const section = document.createElement("div");
  section.className = "data-section";
  section.innerHTML = `<h3>Обновления</h3><p>Установленная версия: ${info.version || "—"}</p>`;

  const status = document.createElement("div");
  status.className = "update-check-status";

  const btn = document.createElement("button");
  btn.className = "btn";
  btn.textContent = "Проверить обновления";
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    status.textContent = "Проверяю…";
    try {
      status.textContent = updateStatusText(await apiPost("/api/app/check-update", {}));
    } catch {
      status.textContent = "Не удалось проверить обновления.";
    } finally {
      btn.disabled = false;
    }
  });

  section.append(btn, status);
  return section;
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
