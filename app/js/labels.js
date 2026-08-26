import { apiGet, apiPost } from "./api.js";
import { i18n } from "./i18n.js";

// ══════════════════════════════════════════════
//  ПОДПИСИ ИНТЕРФЕЙСА
//
//  По духу TasteID (window.SITE_LABELS/siteLabel в app/js/theme.js), но
//  сильно уже: там подписей под сотню (фильтры, блоки статистики,
//  пустые состояния), здесь — только пункты меню и название приложения.
//  Терминология у жанров расходится сильнее, чем у отзывов: кто-то
//  хочет «Королевства» вместо «Локации», кто-то — «Расы» вместо
//  «Фракции», и упираться в чужие слова незачем.
// ══════════════════════════════════════════════

// Функция, а не готовый объект: значения идут через i18n(), а его язык
// известен только после loadLang() (main.js, boot()) — на момент
// импорта этого модуля он ещё не загружен, и застывший объект навсегда
// остался бы на языке по умолчанию.
export function defaultLabels() {
  return {
    brand: "Fictaris",
    nav: {
      manuscript: i18n("Рукопись"),
      characters: i18n("Персонажи"),
      locations: i18n("Локации"),
      relationships: i18n("Связи"),
      factions: i18n("Фракции"),
      timeline: i18n("Таймлайн"),
      board: i18n("Доска"),
      map: i18n("Карта"),
      graph: i18n("Граф"),
      familytree: i18n("Родословная"),
      stats: i18n("Статистика"),
      continuity: i18n("Проверка"),
      trash: i18n("Корзина"),
      settings: i18n("⚙ Настройки"),
      data: i18n("Данные"),
    },
  };
}

function mergeLabels(overrides) {
  const defaults = defaultLabels();
  const merged = { brand: defaults.brand, nav: { ...defaults.nav } };
  if (typeof overrides?.brand === "string" && overrides.brand.trim()) merged.brand = overrides.brand.trim();
  if (overrides?.nav) {
    for (const key of Object.keys(merged.nav)) {
      if (typeof overrides.nav[key] === "string" && overrides.nav[key].trim()) {
        merged.nav[key] = overrides.nav[key].trim();
      }
    }
  }
  return merged;
}

export async function applyLabels() {
  const settings = await apiGet("/api/site-settings").catch(() => ({}));
  const labels = mergeLabels(settings.labels);
  window.SITE_LABELS = labels;

  const brandEl = document.querySelector(".brand");
  if (brandEl) brandEl.textContent = labels.brand;

  document.querySelectorAll(".nav-item[data-module]").forEach((btn) => {
    const text = labels.nav[btn.dataset.module];
    if (!text) return;
    // У «Корзины» внутри лежит <span class="trash-badge"> со счётчиком —
    // трогаем только текстовый узел перед ним, не весь innerHTML.
    const firstNode = btn.childNodes[0];
    if (firstNode && firstNode.nodeType === Node.TEXT_NODE) firstNode.textContent = `${text} `;
    else btn.textContent = text;
  });

  return labels;
}

// patch — { brand } и/или { nav: { <ключ>: значение } }, точечно: не
// нужно передавать весь nav целиком, чтобы не потерять чужие
// переопределения при двух почти одновременных правках разных полей.
export async function saveLabels(patch) {
  const settings = (await apiGet("/api/site-settings").catch(() => ({}))) || {};
  const nextLabels = { ...settings.labels };
  if (patch.brand !== undefined) nextLabels.brand = patch.brand;
  if (patch.nav) nextLabels.nav = { ...settings.labels?.nav, ...patch.nav };
  await apiPost("/api/site-settings", { ...settings, labels: nextLabels });
  return applyLabels();
}

export async function resetLabels() {
  const settings = (await apiGet("/api/site-settings").catch(() => ({}))) || {};
  delete settings.labels;
  await apiPost("/api/site-settings", settings);
  return applyLabels();
}
