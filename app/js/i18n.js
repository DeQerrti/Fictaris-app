import { apiGet, apiPost } from "./api.js";
import { EN_DICT } from "./i18n-en.js";

// ══════════════════════════════════════════════
//  ПЕРЕВОД
//
//  По духу TasteID (app/js/i18n.js): ключ — сама русская строка
//  (gettext-стиль), а не выдуманный код вроде "settings.save". Проще
//  поддерживать — не нужно держать в голове вторую систему имён, и
//  видно прямо в вызове, что переводится. Отсутствующий перевод просто
//  возвращает русский текст — не хуже, чем без i18n вовсе, а не ошибка.
//
//  Язык хранится в site-settings.json (общий на проект — то же место,
//  что и тема), а не в localStorage: открыв проект с другого
//  устройства через синхронизацию, ожидаешь увидеть тот же язык, а не
//  выбирать заново.
// ══════════════════════════════════════════════

let lang = "ru";

export function currentLang() {
  return lang;
}

// vars — {ключ: значение} для подстановки "{ключ}" внутри строки, тем
// же приёмом, что и у TasteID — не шаблонные литералы, чтобы строка
// оставалась обычным текстом и годилась в качестве ключа словаря.
export function i18n(ru, vars) {
  let text = lang === "en" ? EN_DICT[ru] || ru : ru;
  if (vars) {
    for (const [key, value] of Object.entries(vars)) text = text.split(`{${key}}`).join(value);
  }
  return text;
}

// Строка с числом, которое требует согласования: «1 метка, 3 метки,
// 5 меток, 21 метка, 11 меток». forms — три русские формы [одна,
// несколько, много]; ключ словаря — форма «много» (как и раньше у этих
// строк), а английский перевод — «один|много»: "{n} pin|{n} pins".
// Число подставляется в vars под ключом countKey.
export function i18nPlural(n, forms, vars = {}, countKey = "n") {
  const all = { ...vars, [countKey]: n };
  if (lang === "en" && EN_DICT[forms[2]]) {
    const [one, other = one] = EN_DICT[forms[2]].split("|");
    return i18n(n === 1 ? one : other, all);
  }
  const mod10 = n % 10;
  const mod100 = n % 100;
  const form = mod10 === 1 && mod100 !== 11 ? 0 : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 1 : 2;
  let text = forms[form];
  for (const [key, value] of Object.entries(all)) text = text.split(`{${key}}`).join(value);
  return text;
}

export async function loadLang() {
  const settings = await apiGet("/api/site-settings").catch(() => ({}));
  lang = settings.lang === "en" ? "en" : "ru";
  document.documentElement.lang = lang;
  return lang;
}

export async function setLang(newLang) {
  const settings = (await apiGet("/api/site-settings").catch(() => ({}))) || {};
  await apiPost("/api/site-settings", { ...settings, lang: newLang === "en" ? "en" : "ru" });
  location.reload(); // проще перечитать весь интерфейс заново, чем гонять новый язык по всем модулям
}
