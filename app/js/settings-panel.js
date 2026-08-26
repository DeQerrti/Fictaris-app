import { apiGet, apiPost } from "./api.js";
import { i18n, currentLang, setLang } from "./i18n.js";
import { THEME_PRESETS, saveTheme } from "./theme.js";
import { defaultLabels, saveLabels, resetLabels } from "./labels.js";
import { captureKey, saveShortcut, clearShortcut } from "./shortcuts.js";
import { DEFAULT_TAGS_MAP, CATEGORY_LABELS } from "./tags.js";
import { defaultMonths, loadCalendar, saveCalendar } from "./calendar.js";
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

// ══════════════════════════════════════════════
//  НАСТРОЙКИ
//
//  Отдельный экран от «Данных» (data-panel.js): там — экспорт/импорт/
//  демо-данные/история версий, то есть операции над содержимым проекта;
//  здесь — то, как выглядит и ведёт себя само приложение. Разделены
//  нарочно: в других инструментах (Obsidian, TasteID) это тоже две
//  разные по смыслу вещи, и склеенные в одну кнопку «Данные» настройки
//  оказались попросту не видны — по этой самой причине раздел и завели.
// ══════════════════════════════════════════════

export async function renderSettings(root) {
  root.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "data-panel";

  const info = await apiGet("/api/app/info").catch(() => ({}));

  wrap.appendChild(await buildAppearanceSection());
  wrap.appendChild(buildLanguageSection());
  wrap.appendChild(await buildEditorSection());
  wrap.appendChild(await buildLabelsSection());
  wrap.appendChild(await buildShortcutsSection());
  wrap.appendChild(await buildTagsSection());
  wrap.appendChild(await buildCalendarSection());
  wrap.appendChild(buildSyncSection());
  wrap.appendChild(buildUpdateSection(info));
  wrap.appendChild(buildAboutSection(info));

  root.appendChild(wrap);
}

async function buildAppearanceSection() {
  const section = document.createElement("div");
  section.className = "data-section";
  section.innerHTML = `<h3>${i18n("Оформление")}</h3><p>${i18n("Тема и акцентный цвет — применяются сразу, без перезагрузки.")}</p>`;

  const settings = await apiGet("/api/site-settings").catch(() => ({}));
  const currentSkin = THEME_PRESETS[settings.theme] ? settings.theme : "dark";

  const swatches = document.createElement("div");
  swatches.className = "theme-swatches";

  const buttons = new Map();
  for (const [id, preset] of Object.entries(THEME_PRESETS)) {
    const btn = document.createElement("button");
    btn.className = "theme-swatch" + (id === currentSkin ? " active" : "");
    btn.dataset.skin = id;
    btn.innerHTML = `<span class="theme-swatch-preview" data-skin-preview="${id}"></span><span>${i18n(preset.label)}</span><span class="theme-swatch-hint">${i18n(preset.hint)}</span>`;
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
  accentRow.textContent = i18n("Акцентный цвет: ");
  const accentInput = document.createElement("input");
  accentInput.type = "color";
  accentInput.value = /^#[0-9a-f]{6}$/i.test(settings.accent || "")
    ? settings.accent
    : THEME_PRESETS[currentSkin].defaultAccent || "#c9944a";
  accentInput.addEventListener("input", () => saveTheme({ accent: accentInput.value }));
  accentRow.appendChild(accentInput);

  const resetBtn = document.createElement("button");
  resetBtn.className = "btn";
  resetBtn.textContent = i18n("Сбросить акцент");
  resetBtn.addEventListener("click", async () => {
    await saveTheme({ accent: null });
    location.reload(); // проще перечитать цвет темы по умолчанию, чем тянуть его сюда из style.css
  });

  section.append(swatches, accentRow, resetBtn);
  return section;
}

// ── Язык ──────────────────────────────────────
// Переводится оболочка приложения (навигация, настройки, данные,
// поиск, первый запуск, уведомления об обновлении) — формы внутри
// модулей (Персонажи/Локации/Таймлайн и т.д.) пока остаются на
// русском, это следующий заход (см. i18n.js/i18n-en.js).
function buildLanguageSection() {
  const section = document.createElement("div");
  section.className = "data-section";
  section.innerHTML = `<h3>${i18n("Язык")}</h3><p>${i18n("Язык интерфейса — применяется сразу после перезагрузки страницы. Общий на проект: открыв его с другого устройства через синхронизацию, увидишь тот же язык.")}</p>`;

  const row = document.createElement("div");
  row.className = "sync-actions";
  const lang = currentLang();

  const ruBtn = document.createElement("button");
  ruBtn.className = "btn" + (lang === "ru" ? " accent" : "");
  ruBtn.textContent = i18n("Русский");
  ruBtn.addEventListener("click", () => setLang("ru"));

  const enBtn = document.createElement("button");
  enBtn.className = "btn" + (lang === "en" ? " accent" : "");
  enBtn.textContent = i18n("English");
  enBtn.addEventListener("click", () => setLang("en"));

  row.append(ruBtn, enBtn);
  section.appendChild(row);
  return section;
}

// ── Редактор ──────────────────────────────────
// Единственная сквозная настройка рукописи, которую спрашивают почти
// все текстовые редакторы (Scrivener, World Anvil) — размер шрифта.
// Применяется через CSS-переменную --editor-font-size на :root, читает
// её .chapter-content в style.css.
const FONT_SIZES = [15, 16, 17, 18, 20, 22];
const DEFAULT_FONT_SIZE = 17;

async function buildEditorSection() {
  const section = document.createElement("div");
  section.className = "data-section";
  section.innerHTML = `<h3>${i18n("Редактор")}</h3><p>${i18n("Размер шрифта в тексте главы.")}</p>`;

  const settings = await apiGet("/api/site-settings").catch(() => ({}));
  const current = FONT_SIZES.includes(settings.editorFontSize) ? settings.editorFontSize : DEFAULT_FONT_SIZE;

  const row = document.createElement("div");
  row.className = "font-size-row";
  const buttons = new Map();
  for (const size of FONT_SIZES) {
    const btn = document.createElement("button");
    btn.className = "btn font-size-btn" + (size === current ? " active" : "");
    btn.textContent = String(size);
    btn.addEventListener("click", async () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const s = (await apiGet("/api/site-settings").catch(() => ({}))) || {};
      await apiPost("/api/site-settings", { ...s, editorFontSize: size });
      document.documentElement.style.setProperty("--editor-font-size", `${size}px`);
    });
    buttons.set(size, btn);
    row.appendChild(btn);
  }

  section.appendChild(row);
  return section;
}

async function buildLabelsSection() {
  const section = document.createElement("div");
  section.className = "data-section";
  section.innerHTML = `<h3>${i18n("Подписи интерфейса")}</h3><p>${i18n("Переименуй пункты меню под свою терминологию — применяется сразу, без перезагрузки.")}</p>`;

  const defaults = defaultLabels();
  const current = window.SITE_LABELS || defaults;
  const grid = document.createElement("div");
  grid.className = "labels-grid";

  grid.appendChild(buildLabelRow(i18n("Название приложения"), defaults.brand, current.brand, (value) => saveLabels({ brand: value })));
  for (const [key, defaultLabel] of Object.entries(defaults.nav)) {
    grid.appendChild(
      buildLabelRow(defaultLabel, defaultLabel, current.nav[key], (value) => saveLabels({ nav: { [key]: value } }))
    );
  }

  const resetBtn = document.createElement("button");
  resetBtn.className = "btn";
  resetBtn.textContent = i18n("Сбросить все подписи");
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

async function buildShortcutsSection() {
  const section = document.createElement("div");
  section.className = "data-section";
  section.innerHTML = `<h3>${i18n("Горячие клавиши")}</h3><p>${i18n("Цифры 1–9 переключают модули по порядку в сайдбаре. Любой модуль можно назначить на свою клавишу — она сработает независимо от позиции в списке.")}</p>`;

  const settings = await apiGet("/api/site-settings").catch(() => ({}));
  const custom = settings.keyBindings?.nav || {};
  const defaults = defaultLabels();
  const navLabels = window.SITE_LABELS?.nav || defaults.nav;

  const list = document.createElement("div");
  list.className = "shortcuts-list";

  Object.keys(defaults.nav).forEach((key, index) => {
    const row = document.createElement("div");
    row.className = "shortcut-row";

    const label = document.createElement("span");
    label.textContent = navLabels[key] || defaults.nav[key];

    const keyBtn = document.createElement("button");
    keyBtn.className = "btn shortcut-key";
    const defaultLabel = index < 9 ? String(index + 1) : "—";
    keyBtn.textContent = custom[key] ? bindingLabel(custom[key]) : defaultLabel;

    const clearBtn = document.createElement("button");
    clearBtn.className = "btn shortcut-clear";
    clearBtn.textContent = "×";
    clearBtn.title = i18n("Сбросить на клавишу по умолчанию");
    clearBtn.style.visibility = custom[key] ? "visible" : "hidden";

    keyBtn.addEventListener("click", () => {
      captureKey(keyBtn, async (result) => {
        await saveShortcut(key, result);
        keyBtn.textContent = bindingLabel(result);
        clearBtn.style.visibility = "visible";
      });
    });

    clearBtn.addEventListener("click", async () => {
      await clearShortcut(key);
      keyBtn.textContent = defaultLabel;
      clearBtn.style.visibility = "hidden";
    });

    row.append(label, keyBtn, clearBtn);
    list.appendChild(row);
  });

  section.appendChild(list);
  return section;
}

function bindingLabel(binding) {
  return (binding.shift ? "Shift+" : "") + binding.label;
}

// ── Теги ──────────────────────────────────────
// Словарь по умолчанию (DEFAULT_TAGS_MAP) правится только кодом — здесь
// можно спрятать любой встроенный тег (hiddenTags) и добавить свой
// (customTags), тем же принципом, что и TasteID. Сама витрина чипов —
// в tags.js, buildTagsField; это только экран управления словарём.

async function buildTagsSection() {
  const section = document.createElement("div");
  section.className = "data-section";
  section.innerHTML = `<h3>${i18n("Теги")}</h3><p>${i18n("Спрячь ненужный встроенный тег или добавь свой — оба применяются сразу во всех модулях.")}</p>`;

  const settings = await apiGet("/api/site-settings").catch(() => ({}));
  const hidden = new Set(settings.hiddenTags || []);
  const custom = settings.customTags || {};
  const merged = { ...DEFAULT_TAGS_MAP, ...custom };

  const list = document.createElement("div");
  list.className = "tags-manage-list";
  renderTagsManageList(list, merged, hidden, custom);
  section.appendChild(list);

  const addRow = document.createElement("div");
  addRow.className = "tags-manage-add";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = i18n("Название тега");
  const catSelect = document.createElement("select");
  for (const [cat, label] of Object.entries(CATEGORY_LABELS)) {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = i18n(label);
    catSelect.appendChild(opt);
  }
  const addBtn = document.createElement("button");
  addBtn.className = "btn";
  addBtn.textContent = i18n("Добавить тег");
  addBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    if (!name) return;
    const s = (await apiGet("/api/site-settings").catch(() => ({}))) || {};
    const nextCustom = { ...s.customTags, [name]: { cat: catSelect.value, tip: "" } };
    await apiPost("/api/site-settings", { ...s, customTags: nextCustom });
    nameInput.value = "";
    const nextHidden = new Set(s.hiddenTags || []);
    renderTagsManageList(list, { ...DEFAULT_TAGS_MAP, ...nextCustom }, nextHidden, nextCustom);
  });
  addRow.append(nameInput, catSelect, addBtn);
  section.appendChild(addRow);

  return section;
}

function renderTagsManageList(list, merged, hidden, custom) {
  list.innerHTML = "";
  const byCategory = {};
  for (const [name, info] of Object.entries(merged)) {
    (byCategory[info.cat] ||= []).push(name);
  }
  for (const [cat, names] of Object.entries(byCategory)) {
    const group = document.createElement("div");
    group.className = "tags-manage-group";
    const title = document.createElement("div");
    title.className = "tags-manage-group-title";
    title.textContent = i18n(CATEGORY_LABELS[cat] || cat);
    group.appendChild(title);
    for (const name of names) {
      const row = document.createElement("div");
      row.className = "tags-manage-row" + (hidden.has(name) ? " hidden-tag" : "");
      const label = document.createElement("span");
      label.textContent = i18n(name) + (custom[name] ? i18n(" (своя)") : "");
      const toggle = document.createElement("button");
      toggle.className = "btn shortcut-clear";
      toggle.textContent = hidden.has(name) ? "↺" : "×";
      toggle.title = hidden.has(name) ? i18n("Вернуть") : i18n("Спрятать");
      toggle.addEventListener("click", async () => {
        const s = (await apiGet("/api/site-settings").catch(() => ({}))) || {};
        const nextHidden = new Set(s.hiddenTags || []);
        if (nextHidden.has(name)) nextHidden.delete(name);
        else nextHidden.add(name);
        await apiPost("/api/site-settings", { ...s, hiddenTags: [...nextHidden] });
        renderTagsManageList(list, merged, nextHidden, custom);
      });
      row.append(label, toggle);
      group.appendChild(row);
    }
    list.appendChild(group);
  }
}

// ── Календарь ─────────────────────────────────
// Выключен по умолчанию — таймлайн работает как раньше, свободный
// текст с числом внутри двигает событие по шкале (timeline.js,
// orderFromDate). Включив, получаешь три поля вместо текста: год/
// месяц/день по названиям месяцев отсюда, и точный порядок на шкале
// вместо эвристики.

async function buildCalendarSection() {
  const section = document.createElement("div");
  section.className = "data-section";
  section.innerHTML = `<h3>${i18n("Календарь")}</h3><p>${i18n("Своё летоисчисление для таймлайна — свои месяцы вместо реальных, произвольная длина года.")}</p>`;

  const calendar = await loadCalendar();
  const toggleBtn = document.createElement("button");
  toggleBtn.className = "btn";
  toggleBtn.textContent = calendar ? i18n("Отключить свой календарь") : i18n("Включить свой календарь");

  const body = document.createElement("div");
  body.className = "calendar-editor";

  function renderBody(cal) {
    body.innerHTML = "";
    if (!cal) return;

    const eraRow = document.createElement("div");
    eraRow.className = "field";
    eraRow.innerHTML = `<label>${i18n("Название года")}</label>`;
    const eraInput = document.createElement("input");
    eraInput.type = "text";
    eraInput.value = cal.eraLabel || i18n("год");
    let eraTimer;
    eraInput.addEventListener("input", () => {
      clearTimeout(eraTimer);
      eraTimer = setTimeout(async () => {
        cal.eraLabel = eraInput.value.trim() || "год";
        await saveCalendar(cal);
      }, 500);
    });
    eraRow.appendChild(eraInput);
    body.appendChild(eraRow);

    const monthsList = document.createElement("div");
    monthsList.className = "calendar-months";
    cal.months.forEach((m, i) => {
      const row = document.createElement("div");
      row.className = "calendar-month-row";

      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.value = m.name;
      let nameTimer;
      nameInput.addEventListener("input", () => {
        clearTimeout(nameTimer);
        nameTimer = setTimeout(async () => {
          m.name = nameInput.value.trim() || m.name;
          await saveCalendar(cal);
        }, 500);
      });

      const daysInput = document.createElement("input");
      daysInput.type = "number";
      daysInput.min = "1";
      daysInput.max = "99";
      daysInput.value = m.days;
      daysInput.addEventListener("change", async () => {
        m.days = Math.max(1, Math.min(99, Number(daysInput.value) || 30));
        daysInput.value = m.days;
        await saveCalendar(cal);
      });

      const daysLabel = document.createElement("span");
      daysLabel.className = "calendar-days-label";
      daysLabel.textContent = i18n("дней");

      const removeBtn = document.createElement("button");
      removeBtn.className = "btn shortcut-clear";
      removeBtn.textContent = "×";
      removeBtn.title = i18n("Убрать месяц");
      removeBtn.addEventListener("click", async () => {
        if (cal.months.length <= 1) return;
        cal.months.splice(i, 1);
        await saveCalendar(cal);
        renderBody(cal);
      });

      row.append(nameInput, daysInput, daysLabel, removeBtn);
      monthsList.appendChild(row);
    });
    body.appendChild(monthsList);

    const addBtn = document.createElement("button");
    addBtn.className = "btn";
    addBtn.textContent = i18n("Добавить месяц");
    addBtn.addEventListener("click", async () => {
      cal.months.push({ name: `Месяц ${cal.months.length + 1}`, days: 30 });
      await saveCalendar(cal);
      renderBody(cal);
    });
    body.appendChild(addBtn);
  }

  let current = calendar;
  renderBody(current);

  toggleBtn.addEventListener("click", async () => {
    if (current) {
      current = null;
      await saveCalendar(null);
      toggleBtn.textContent = i18n("Включить свой календарь");
    } else {
      current = { months: defaultMonths().map((m) => ({ ...m })), eraLabel: i18n("год") };
      await saveCalendar(current);
      toggleBtn.textContent = i18n("Отключить свой календарь");
    }
    renderBody(current);
  });

  section.append(toggleBtn, body);
  return section;
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
  section.innerHTML = `<h3>${i18n("Синхронизация")}</h3>`;
  const config = getSyncConfig();
  section.appendChild(config ? buildSyncConnected(section, config) : buildSyncSetup(section));
}

function buildSyncSetup(section) {
  const wrap = document.createElement("div");

  const intro = document.createElement("p");
  intro.textContent = i18n(
    "Свободно и без своего сервера: приватный репозиторий на GitHub как общее хранилище для всех твоих устройств — телефона, компьютера, ещё одного компьютера. Токен и служебные данные синхронизации остаются только на этом устройстве."
  );

  const steps = document.createElement("ol");
  steps.className = "sync-steps";
  steps.innerHTML =
    `<li>${i18n("Заведи аккаунт на github.com, если его ещё нет — бесплатно.")}</li>` +
    `<li>${i18n("Создай токен доступа —")} <a href="https://github.com/settings/tokens/new?scopes=repo&description=Fictaris" target="_blank" rel="noopener">${i18n("по этой ссылке")}</a>, ${i18n('галочка «repo» уже отмечена. Внизу страницы — «Generate token».')}</li>` +
    `<li>${i18n("Скопируй токен (показывается один раз) и вставь сюда.")}</li>`;

  const tokenLabel = document.createElement("label");
  tokenLabel.textContent = i18n("Токен доступа");
  const tokenInput = document.createElement("input");
  tokenInput.type = "password";
  tokenInput.placeholder = "ghp_…";
  tokenInput.autocomplete = "off";

  const repoLabel = document.createElement("label");
  repoLabel.textContent = i18n("Название репозитория");
  const repoInput = document.createElement("input");
  repoInput.type = "text";
  repoInput.value = "fictaris-vault";
  const repoHint = document.createElement("p");
  repoHint.className = "sync-hint";
  repoHint.textContent = i18n(
    "Если такого репозитория ещё нет на твоём GitHub — создадим сами, приватным. Если уже есть (например, второе устройство его уже завело) — подключимся к нему."
  );

  const btn = document.createElement("button");
  btn.className = "btn";
  btn.textContent = i18n("Подключить");
  const status = document.createElement("div");
  status.className = "sync-status";

  btn.addEventListener("click", async () => {
    const token = tokenInput.value.trim();
    const repo = repoInput.value.trim();
    if (!token || !repo) {
      status.textContent = i18n("Заполни токен и название репозитория.");
      return;
    }
    btn.disabled = true;
    status.textContent = i18n("Проверяем токен…");
    try {
      const user = await checkGithubUser(token);
      const config = { token, owner: user.login, repo };
      status.textContent = i18n("Проверяем репозиторий…");
      if (!(await repoExists(config))) {
        status.textContent = i18n("Репозитория ещё нет — создаём…");
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
  const last = state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleString() : i18n("ещё не было");
  intro.innerHTML = `${i18n("Подключено к")} <a href="${link}" target="_blank" rel="noopener">${config.owner}/${config.repo}</a>. ${i18n("Последняя синхронизация: {when}.", { when: last })}`;

  const row = document.createElement("div");
  row.className = "sync-actions";
  const nowBtn = document.createElement("button");
  nowBtn.className = "btn accent";
  nowBtn.textContent = i18n("Синхронизировать сейчас");
  const disconnectBtn = document.createElement("button");
  disconnectBtn.className = "btn";
  disconnectBtn.textContent = i18n("Отключить");
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
      disconnectBtn.textContent = i18n("Точно отключить?");
      setTimeout(() => {
        disconnectArmed = false;
        disconnectBtn.textContent = i18n("Отключить");
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
  status.textContent = i18n("Синхронизируем…");
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
      status.textContent = i18n("Готово, но {n} файл(ов) изменились и здесь, и в репозитории — выбери, что оставить.", {
        n: result.conflicts.length,
      });
      renderConflicts(conflictsBox, config, result.conflicts);
    } else {
      status.textContent = i18n("Готово: отправлено {pushed}, забрано {pulled}, без изменений {skipped}.", result);
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
    localBtn.textContent = i18n("Оставить моё");
    const remoteBtn = document.createElement("button");
    remoteBtn.className = "btn";
    remoteBtn.textContent = i18n("Взять оттуда");
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
  if (res.status === "latest") return i18n("У тебя последняя версия.");
  if (res.status === "downloading") return i18n("Скачивается обновление {version}…", res);
  if (res.status === "ready") return i18n("Обновление {version} скачано — перезапусти, чтобы установить.", res);
  if (res.status === "available") return i18n("Доступно обновление {version}.", res);
  if (res.status === "dev") return i18n("Проверка недоступна в режиме разработки (npm start).");
  if (res.status === "error" && res.message) return i18n("Не удалось скачать обновление: {message}", res);
  return i18n("Не удалось проверить обновления — нет сети или GitHub недоступен.");
}

function buildUpdateSection(info) {
  const section = document.createElement("div");
  section.className = "data-section";
  section.innerHTML = `<h3>${i18n("Обновления")}</h3><p>${i18n("Установленная версия: {version}", { version: info.version || "—" })}</p>`;

  const status = document.createElement("div");
  status.className = "update-check-status";

  const btn = document.createElement("button");
  btn.className = "btn";
  btn.textContent = i18n("Проверить обновления");

  let pollTimer = null;
  function stopPolling() {
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  // Скачивание идёт в фоне главного процесса и может занять больше
  // времени, чем один ответ check-update, — поэтому статус "downloading"
  // не финальный: следом опрашиваем update-status, пока не придёт
  // готовый файл или явная ошибка (см. electron/main.js — раньше
  // сорвавшееся на середине скачивание было незаметно и текст навсегда
  // застревал на «Скачивается…»).
  function renderResult(res) {
    if (!document.body.contains(status)) return; // ушли с "Данные" во время скачивания — не поллим впустую
    status.textContent = updateStatusText(res);
    if (res.status === "ready") {
      restartBtn.style.display = "";
    } else {
      restartBtn.style.display = "none";
    }
    if (res.status === "downloading") {
      pollTimer = setTimeout(pollDownload, 3000);
    } else {
      stopPolling();
      btn.disabled = false;
    }
  }

  async function pollDownload() {
    try {
      const s = await apiGet("/api/app/update-status");
      if (s.type === "ready") renderResult({ status: "ready", version: s.version });
      else if (s.type === "error") renderResult({ status: "error", version: s.version, message: s.message });
      else if (s.type === "downloading") renderResult({ status: "downloading", version: s.version });
      else pollTimer = setTimeout(pollDownload, 3000);
    } catch {
      pollTimer = setTimeout(pollDownload, 3000);
    }
  }

  const restartBtn = document.createElement("button");
  restartBtn.className = "btn accent";
  restartBtn.textContent = i18n("Перезапустить");
  restartBtn.style.display = "none";
  restartBtn.style.marginLeft = "8px";
  restartBtn.addEventListener("click", () => apiPost("/api/app/update-restart", {}));

  btn.addEventListener("click", async () => {
    stopPolling();
    btn.disabled = true;
    restartBtn.style.display = "none";
    status.textContent = i18n("Проверяю…");
    try {
      renderResult(await apiPost("/api/app/check-update", {}));
    } catch {
      status.textContent = i18n("Не удалось проверить обновления.");
      btn.disabled = false;
    }
  });

  section.append(btn, restartBtn, status);
  return section;
}

// ── О приложении ──────────────────────────────
function buildAboutSection(info) {
  const section = document.createElement("div");
  section.className = "data-section";
  const platform = info.mobile ? "Android" : info.platform === "darwin" ? "macOS" : info.platform === "win32" ? "Windows" : "Linux";
  section.innerHTML = `
    <h3>${i18n("О приложении")}</h3>
    <p>Fictaris ${info.version || ""} · ${platform}</p>
    <p>${i18n("Инструмент для писателей и мастеров миров: данные лежат обычной папкой на твоём диске, без своего сервера и без привязки к аккаунту.")}</p>
    <p><a href="https://github.com/DeQerrti/Fictaris-app" target="_blank" rel="noopener">${i18n("Репозиторий на GitHub")}</a> ·
       <a href="https://github.com/DeQerrti/Fictaris-app/issues" target="_blank" rel="noopener">${i18n("Сообщить о проблеме")}</a> ·
       <a href="https://github.com/DeQerrti/Fictaris-app/releases" target="_blank" rel="noopener">${i18n("Все версии")}</a></p>
  `;
  return section;
}
