import { apiGet, apiPost } from "./api.js";
import { buildDataSections } from "./data-panel.js";
import { i18n, currentLang, setLang, i18nPlural } from "./i18n.js";
import { THEME_PRESETS, CUSTOM_COLOR_TOKENS, saveTheme } from "./theme.js";
import { escapeHtml } from "./chips.js";
import { iconSvg } from "./icons.js";
import { defaultLabels, saveLabels, resetLabels } from "./labels.js";
import { getHiddenTabs, setTabHidden, getTabOrder, setTabOrder, TAB_SECTIONS } from "./visibility.js";
import { captureKey, saveShortcut, clearShortcut, navOrder } from "./shortcuts.js";
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

// Раньше все разделы шли одной длинной лентой на скролл — по образцу
// Obsidian (категории слева, справа — только выбранная) читать и найти
// нужное проще, а «Данные» (data-panel.js) естественно встают ещё одной
// вкладкой вместо отдельного пункта в сайдбаре, которым они и были
// концептуально всё это время — операциями над содержимым проекта,
// такими же настройками, только над данными, а не над видом приложения.
let activeSettingsTab = "appearance";

// focusTab — тот же приём, что и focusId у остальных renderX(root, id)
// (характеры/локации/таймлайн и т.д.): необязательный второй аргумент,
// которым командная палитра (search.js) просит открыть конкретную
// вкладку Настроек, а не всегда ту, что была открыта в прошлый раз.
export async function renderSettings(root, focusTab) {
  root.innerHTML = "";
  const info = await apiGet("/api/app/info").catch(() => ({}));

  // Настройки — окно поверх экрана (main.js, openEntityModal), не
  // вкладка. Две группы: само приложение и этот мир. Теги, шаблоны анкет
  // и календарь — данные мира, они открываются там, где ими пользуются
  // (поле тегов, шапки Персонажей/Локаций/Фракций, Таймлайн), боковой
  // панелью (side-panel.js).
  const TABS = [
    ["appearance", () => i18n("Оформление"), () => buildAppearanceSection(), "eye", "app"],
    ["app", () => i18n("Приложение"), () => buildAppSection(info), "settings", "app"],
    ["sections", () => i18n("Разделы"), () => buildSectionsSection(), "columns", "app"],
    ["sync", () => i18n("Синхронизация"), () => buildSyncSection(), "upload", "world"],
    ["data", () => i18n("Данные"), () => [buildFolderSection(info), ...buildDataSections()], "download", "world"],
  ];
  const GROUP_TITLES = { app: () => i18n("Приложение"), world: () => i18n("Этот мир") };
  if (focusTab && TABS.some(([key]) => key === focusTab)) activeSettingsTab = focusTab;
  else if (!TABS.some(([key]) => key === activeSettingsTab)) activeSettingsTab = "appearance";

  const shell = document.createElement("div");
  shell.className = "settings-shell";

  const tabsNav = document.createElement("nav");
  tabsNav.className = "settings-tabs";
  const heading = document.createElement("div");
  heading.className = "settings-title";
  heading.textContent = i18n("Настройки");
  tabsNav.appendChild(heading);

  const content = document.createElement("div");
  content.className = "settings-content data-panel";

  async function selectTab(key, build) {
    activeSettingsTab = key;
    for (const btn of tabsNav.querySelectorAll("[data-tab]")) btn.classList.toggle("active", btn.dataset.tab === key);
    content.innerHTML = "";
    const result = await build();
    for (const el of Array.isArray(result) ? result : [result]) content.appendChild(el);
  }

  let lastGroup = null;
  for (const [key, label, build, icon, group] of TABS) {
    if (group !== lastGroup) {
      const g = document.createElement("div");
      g.className = "settings-group";
      g.textContent = GROUP_TITLES[group]();
      tabsNav.appendChild(g);
      lastGroup = group;
    }
    const btn = document.createElement("button");
    btn.className = "settings-tab" + (key === activeSettingsTab ? " active" : "");
    btn.dataset.tab = key;
    btn.innerHTML = `${iconSvg(icon, 15)}<span></span>`;
    btn.querySelector("span").textContent = label();
    btn.addEventListener("click", () => selectTab(key, build));
    tabsNav.appendChild(btn);
  }
  const ver = document.createElement("div");
  ver.className = "settings-version";
  ver.textContent = `Fictaris ${info.version || ""} · Ctrl+,`;
  tabsNav.appendChild(ver);

  shell.append(tabsNav, content);
  root.appendChild(shell);

  const initial = TABS.find(([key]) => key === activeSettingsTab);
  await selectTab(initial[0], initial[2]);
}

async function buildAppearanceSection() {
  const section = document.createElement("div");
  section.className = "data-section";
  section.innerHTML = `<h3>${i18n("Оформление")}</h3>`;

  const settings = await apiGet("/api/site-settings").catch(() => ({}));
  const currentSkin = THEME_PRESETS[settings.theme] ? settings.theme : "dark";

  const swatches = document.createElement("div");
  swatches.className = "theme-swatches";

  const paletteSection = buildPaletteSection(settings);

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
      // Свотчи палитры ниже читали цвета один раз при отрисовке вкладки
      // (getComputedStyle) — после переключения темы CSS-переменные уже
      // новые, а эти <input type="color"> так и оставались со старыми,
      // пока не открыть вкладку заново. saveTheme применяет тему сразу
      // (theme.js, applyTheme) — здесь просто перечитываем то, что она
      // уже поставила.
      paletteSection.refreshPalette();
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

  section.append(swatches, accentRow, resetBtn, paletteSection);
  return section;
}

// Полная палитра — каждый токен темы поверх готовых пресетов, для тех,
// кому мало выбора между двумя темами и акцентом. Живёт в той же
// вкладке «Оформление», отдельным блоком под пресетами. Начальные
// значения — то, что реально сейчас на экране (getComputedStyle), а не
// значения по умолчанию из style.css: так свои правки одной темы не
// сбрасываются при переключении на другую половину экрана.
// wrap.refreshPalette — переключатель темы выше зовёт её же после
// saveTheme(): без этого свотчи здесь держали цвета старой темы до
// следующего открытия вкладки (getComputedStyle читался только один
// раз, при первой отрисовке).
function buildPaletteSection(settings) {
  const wrap = document.createElement("div");
  wrap.style.marginTop = "20px";
  wrap.innerHTML = `<h4>${i18n("Палитра")}</h4>`;

  const custom = { ...(settings.customColors || {}) };
  const grid = document.createElement("div");
  grid.className = "palette-grid";
  const inputs = new Map();

  function refreshPaletteInputs() {
    const cs = getComputedStyle(document.documentElement);
    for (const [key, cssVar] of CUSTOM_COLOR_TOKENS) {
      const input = inputs.get(key);
      const current = /^#[0-9a-f]{6}$/i.test(custom[key] || "") ? custom[key] : cs.getPropertyValue(cssVar).trim();
      input.value = /^#[0-9a-f]{6}$/i.test(current) ? current : "#000000";
    }
  }

  for (const [key, , label, hint] of CUSTOM_COLOR_TOKENS) {
    const row = document.createElement("label");
    row.className = "palette-row";

    const input = document.createElement("input");
    input.type = "color";
    input.addEventListener("input", () => {
      custom[key] = input.value;
      saveTheme({ customColors: custom });
    });
    inputs.set(key, input);

    const text = document.createElement("span");
    text.innerHTML = `${escapeHtml(i18n(label))}<small>${escapeHtml(i18n(hint))}</small>`;

    row.append(input, text);
    grid.appendChild(row);
  }
  refreshPaletteInputs();

  const resetBtn = document.createElement("button");
  resetBtn.className = "btn";
  resetBtn.textContent = i18n("Сбросить палитру");
  resetBtn.addEventListener("click", async () => {
    await saveTheme({ customColors: null });
    location.reload();
  });

  wrap.append(grid, resetBtn);
  wrap.refreshPalette = refreshPaletteInputs;
  return wrap;
}

// ── Приложение ────────────────────────────────
// Язык, масштаб окна, обновления и «о приложении» были четырьмя
// отдельными вкладками, хотя в каждой — по одной небольшой секции.
// Слиты в одну «Приложение» по тому же принципу, что и «Данные»
// (data-panel.js): несколько секций внутри одной вкладки, а не пункт
// сайдбара на каждую мелочь. Масштаб раньше жил на вкладке «Редактор»
// вместе с размером шрифта; шрифт переехал в саму главу (manuscript.js,
// шапка редактора) — он про то, что читаешь прямо сейчас, а не про
// приложение целиком, — и вкладка «Редактор» с одним лишь масштабом
// внутри стала не нужна отдельным пунктом.
async function buildAppSection(info) {
  return [buildLanguageSection(), await buildZoomSection(), buildUpdateSection(info), buildAboutSection(info)];
}

// Переводится оболочка приложения (навигация, настройки, данные,
// поиск, первый запуск, уведомления об обновлении) — формы внутри
// модулей (Персонажи/Локации/Таймлайн и т.д.) пока остаются на
// русском, это следующий заход (см. i18n.js/i18n-en.js).
function buildLanguageSection() {
  const section = document.createElement("div");
  section.className = "data-section";
  section.innerHTML = `<h3>${i18n("Язык")}</h3>`;

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

// ── Масштаб ───────────────────────────────────
// Масштаб всего окна приложения — не про главу и не про рукопись,
// поэтому остался среди общих настроек приложения, а не уехал вместе
// с размером шрифта в manuscript.js.
async function buildZoomSection() {
  const section = document.createElement("div");
  section.className = "data-section";
  section.innerHTML = `<h3>${i18n("Масштаб")}</h3><p>${i18n("Масштаб окна приложения.")}</p>`;

  const zoom = await apiGet("/api/app/zoom").catch(() => null);
  if (zoom) {
    const zoomRow = document.createElement("div");
    zoomRow.className = "sync-actions";
    zoomRow.style.marginTop = "12px";

    const label = document.createElement("span");
    label.textContent = i18n("Масштаб окна: ");
    label.style.color = "var(--text-dim)";

    const percentLabel = document.createElement("span");
    percentLabel.className = "zoom-percent";
    percentLabel.textContent = `${zoom.percent}%`;

    // Баг: раньше текущий процент читали из percentLabel.textContent
    // ("100%") и парсили через Number() — но Number("100%") === NaN,
    // так что +/- всегда слали NaN на сервер, там NaN || 100 тихо
    // откатывало обратно на 100%, и кнопки казались нерабочими.
    // Держим текущее значение отдельной переменной вместо чтения из DOM.
    let currentPercent = zoom.percent;

    async function setZoom(percent) {
      const res = await apiPost("/api/app/zoom", { percent });
      currentPercent = res.percent;
      percentLabel.textContent = `${res.percent}%`;
    }

    const minusBtn = document.createElement("button");
    minusBtn.className = "btn";
    minusBtn.textContent = "−";
    minusBtn.addEventListener("click", () => setZoom(currentPercent - zoom.step));

    const plusBtn = document.createElement("button");
    plusBtn.className = "btn";
    plusBtn.textContent = "+";
    plusBtn.addEventListener("click", () => setZoom(currentPercent + zoom.step));

    zoomRow.append(label, minusBtn, percentLabel, plusBtn);
    section.appendChild(zoomRow);
  }

  return section;
}

// ── Разделы ───────────────────────────────────
// Раньше — две вкладки с одним и тем же списком: «Подписи интерфейса»
// (имя, видимость, порядок) и «Горячие клавиши». Теперь одна таблица:
// на строку раздела — перетаскивание (внутри секции сайдбара), глаз,
// название и клавиша. Ниже — окна (Проверка, Корзина, Статистика,
// Настройки): у них нет пункта в списке, но клавишу назначить можно.
// Название приложения и служебные окна не переименовываются (см.
// LOCKED_NAV_KEYS в labels.js и комментарий в visibility.js).
const WINDOW_KEYS = [
  ["continuity", () => i18n("Проверка мира")],
  ["trash", () => i18n("Корзина")],
  ["stats", () => i18n("Статистика")],
  ["settings", () => i18n("Настройки")],
];

async function buildSectionsSection() {
  const section = document.createElement("div");
  section.className = "data-section";
  section.innerHTML = `<h3>${i18n("Разделы")}</h3><p>${i18n("Название, видимость и клавиша. Строки перетаскиваются внутри своей секции, цифры 1–9 идут по порядку в сайдбаре.")}</p>`;

  const body = document.createElement("div");
  section.appendChild(body);
  await renderSectionsBody(body);

  const resetBtn = document.createElement("button");
  resetBtn.className = "btn";
  resetBtn.textContent = i18n("Сбросить все подписи");
  resetBtn.style.marginTop = "12px";
  resetBtn.addEventListener("click", async () => {
    await resetLabels();
    location.reload(); // проще перечитать раздел заново, чем гонять новые значения по всем полям формы
  });
  section.appendChild(resetBtn);
  return section;
}

async function renderSectionsBody(body) {
  body.innerHTML = "";
  const defaults = defaultLabels();
  const current = window.SITE_LABELS || defaults;
  const hidden = new Set(await getHiddenTabs());
  const order = await getTabOrder();
  const settings = await apiGet("/api/site-settings").catch(() => ({}));
  const custom = settings.keyBindings?.nav || {};
  // Цифры — по тому порядку, что сейчас в сайдбаре (без скрытых).
  const digits = () => new Map(navOrder().slice(0, 9).map((btn, i) => [btn.dataset.module, String(i + 1)]));

  const keyCells = new Map();
  const refreshDigits = () => {
    const d = digits();
    for (const [key, update] of keyCells) update(d.get(key));
  };

  let drag = null; // { key, sectionId }
  const collectFullOrder = () => [...body.querySelectorAll("[data-key]")].map((el) => el.dataset.key);

  for (const sec of TAB_SECTIONS) {
    const header = document.createElement("div");
    header.className = "labels-group-header";
    header.innerHTML = `<span class="labels-group-name"></span>`;
    header.firstChild.textContent = sec.label();
    body.appendChild(header);

    const container = document.createElement("div");
    container.className = "labels-grid";
    for (const key of order.filter((k) => sec.keys.includes(k))) {
      const row = buildLabelRow(key, defaults.nav[key], current.nav[key], hidden.has(key), (value) => saveLabels({ nav: { [key]: value } }), refreshDigits);
      row.appendChild(buildKeyCell(key, custom, keyCells));
      row.draggable = true;
      row.dataset.key = key;
      row.addEventListener("dragstart", () => { drag = { key, sectionId: sec.id }; });
      row.addEventListener("dragover", (e) => {
        if (drag?.sectionId === sec.id) e.preventDefault();
      });
      row.addEventListener("drop", async (e) => {
        e.preventDefault();
        if (!drag || drag.sectionId !== sec.id || drag.key === key) return;
        const dragRow = container.querySelector(`[data-key="${drag.key}"]`);
        if (!dragRow) return;
        container.insertBefore(dragRow, row);
        await setTabOrder(collectFullOrder());
        refreshDigits();
      });
      container.appendChild(row);
    }
    body.appendChild(container);
  }

  const header = document.createElement("div");
  header.className = "labels-group-header";
  header.innerHTML = `<span class="labels-group-name"></span>`;
  header.firstChild.textContent = i18n("Окна");
  body.appendChild(header);
  const windows = document.createElement("div");
  windows.className = "labels-grid";
  const searchRow = document.createElement("div");
  searchRow.className = "label-row label-row-static";
  searchRow.innerHTML = `<span class="label-row-drag"></span><span class="label-row-eye"></span><span class="label-row-text"></span><span class="btn shortcut-key shortcut-key-fixed">/</span><span class="shortcut-clear-gap"></span>`;
  searchRow.querySelector(".label-row-text").textContent = i18n("Поиск");
  windows.appendChild(searchRow);
  for (const [key, label] of WINDOW_KEYS) {
    const row = document.createElement("div");
    row.className = "label-row label-row-static";
    row.innerHTML = `<span class="label-row-drag"></span><span class="label-row-eye"></span><span class="label-row-text"></span>`;
    row.querySelector(".label-row-text").textContent = label();
    row.appendChild(buildKeyCell(key, custom, keyCells));
    windows.appendChild(row);
  }
  body.appendChild(windows);
  refreshDigits();
}

// Кнопка клавиши: своя привязка или цифра по порядку; × сбрасывает свою.
function buildKeyCell(key, custom, keyCells) {
  const cell = document.createElement("span");
  cell.className = "shortcut-cell";
  const keyBtn = document.createElement("button");
  keyBtn.className = "btn shortcut-key";
  const clearBtn = document.createElement("button");
  clearBtn.className = "btn shortcut-clear";
  clearBtn.textContent = "×";
  clearBtn.title = i18n("Сбросить на клавишу по умолчанию");
  let binding = custom[key] || null;
  let digit = null;
  const paint = () => {
    keyBtn.textContent = binding ? bindingLabel(binding) : digit || "–";
    clearBtn.style.visibility = binding ? "visible" : "hidden";
  };
  keyCells.set(key, (d) => { digit = d || null; paint(); });
  keyBtn.title = i18n("Нажми и затем нужную клавишу");
  keyBtn.addEventListener("click", () => {
    captureKey(keyBtn, async (result) => {
      await saveShortcut(key, result);
      binding = result;
      paint();
    });
  });
  clearBtn.addEventListener("click", async () => {
    await clearShortcut(key);
    binding = null;
    paint();
  });
  paint();
  cell.append(keyBtn, clearBtn);
  return cell;
}

function buildLabelRow(key, defaultValue, currentValue, isHidden, onSave, onVisibility) {
  const row = document.createElement("div");
  row.className = "label-row" + (isHidden ? " label-row-hidden" : "");

  const dragHandle = document.createElement("span");
  dragHandle.className = "label-row-drag";
  dragHandle.textContent = "⠿";
  dragHandle.title = i18n("Перетащи, чтобы изменить порядок");
  row.appendChild(dragHandle);

  const eyeBtn = document.createElement("button");
  eyeBtn.type = "button";
  eyeBtn.className = "label-row-eye";
  eyeBtn.innerHTML = iconSvg(isHidden ? "eyeOff" : "eye", 15);
  eyeBtn.title = isHidden ? i18n("Показать раздел") : i18n("Скрыть раздел");
  eyeBtn.addEventListener("click", async () => {
    isHidden = !isHidden;
    await setTabHidden(key, isHidden);
    row.classList.toggle("label-row-hidden", isHidden);
    eyeBtn.innerHTML = iconSvg(isHidden ? "eyeOff" : "eye", 15);
    eyeBtn.title = isHidden ? i18n("Показать раздел") : i18n("Скрыть раздел");
    onVisibility?.();
  });

  const input = document.createElement("input");
  input.type = "text";
  input.value = currentValue || defaultValue;
  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => onSave(input.value.trim() || defaultValue), 500);
  });

  row.append(eyeBtn, input);
  return row;
}

// ── Папка проекта ─────────────────────────────
// Где лежат файлы этого мира — и кнопка открыть её в проводнике
// (на телефоне своего проводника нет, только путь).
function buildFolderSection(info) {
  const section = document.createElement("div");
  section.className = "data-section";
  section.innerHTML = `<h3>${i18n("Папка проекта")}</h3><p>${i18n("Все данные мира – обычные файлы в этой папке. Их можно копировать, хранить в облаке и править снаружи.")}</p>`;
  const path = document.createElement("div");
  path.className = "settings-path";
  path.textContent = info.vaultPath || i18n("Папка не выбрана");
  section.appendChild(path);
  if (!info.mobile && info.vaultPath) {
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.innerHTML = `${iconSvg("folder", 14)}<span></span>`;
    btn.querySelector("span").textContent = i18n("Открыть в проводнике");
    btn.addEventListener("click", () => apiPost("/api/app/open-vault-folder", {}));
    section.appendChild(btn);
  }
  return section;
}

function bindingLabel(binding) {
  return (binding.shift ? "Shift+" : "") + binding.label;
}

// ── Календарь ─────────────────────────────────
// Выключен по умолчанию — таймлайн работает как раньше, свободный
// текст с числом внутри двигает событие по шкале (timeline.js,
// orderFromDate). Включив, получаешь три поля вместо текста: год/
// месяц/день по названиям месяцев отсюда, и точный порядок на шкале
// вместо эвристики.

export async function buildCalendarSection() {
  const section = document.createElement("div");
  section.className = "data-section";
  section.innerHTML = `<h3>${i18n("Календарь")}</h3><p>${i18n("Своё летоисчисление для таймлайна – свои месяцы вместо реальных, произвольная длина года.")}</p>`;

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
    "Свободно и без своего сервера: приватный репозиторий на GitHub как общее хранилище для всех твоих устройств – телефона, компьютера, ещё одного компьютера. Токен и служебные данные синхронизации остаются только на этом устройстве."
  );

  const steps = document.createElement("ol");
  steps.className = "sync-steps";
  steps.innerHTML =
    `<li>${i18n("Заведи аккаунт на github.com, если его ещё нет – бесплатно.")}</li>` +
    `<li>${i18n("Создай токен доступа –")} <a href="https://github.com/settings/tokens/new?scopes=repo&description=Fictaris" target="_blank" rel="noopener">${i18n("по этой ссылке")}</a>, ${i18n('галочка «repo» уже отмечена. Внизу страницы – «Generate token».')}</li>` +
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
    "Если такого репозитория ещё нет на твоём GitHub – создадим сами, приватным. Если уже есть (например, второе устройство его уже завело) – подключимся к нему."
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
        status.textContent = i18n("Репозитория ещё нет – создаём…");
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
      status.textContent = i18nPlural(result.conflicts.length, [
        "Готово, но {n} файл изменился и здесь, и в репозитории – выбери, что оставить.",
        "Готово, но {n} файла изменились и здесь, и в репозитории – выбери, что оставить.",
        "Готово, но {n} файлов изменились и здесь, и в репозитории – выбери, что оставить.",
      ]);
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
  if (res.status === "ready") return i18n("Обновление {version} скачано – перезапусти, чтобы установить.", res);
  if (res.status === "available") return i18n("Доступно обновление {version}.", res);
  if (res.status === "dev") return i18n("Проверка недоступна в режиме разработки (npm start).");
  if (res.status === "error" && res.message) return i18n("Не удалось скачать обновление: {message}", res);
  return i18n("Не удалось проверить обновления – нет сети или GitHub недоступен.");
}

function buildUpdateSection(info) {
  const section = document.createElement("div");
  section.className = "data-section";
  section.innerHTML = `<h3>${i18n("Обновления")}</h3><p>${i18n("Установленная версия: {version}", { version: info.version || "–" })}</p>`;

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
  restartBtn.textContent = i18n("Обновить");
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
    <p class="settings-links"><a href="https://github.com/DeQerrti/Fictaris-app" target="_blank" rel="noopener">${i18n("Репозиторий на GitHub")}</a>
       <a href="https://github.com/DeQerrti/Fictaris-app/issues" target="_blank" rel="noopener">${i18n("Сообщить о проблеме")}</a>
       <a href="https://github.com/DeQerrti/Fictaris-app/releases" target="_blank" rel="noopener">${i18n("Все версии")}</a></p>
  `;
  return section;
}
