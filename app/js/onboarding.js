// ══════════════════════════════════════════════
//  ПЕРВЫЙ ЗАПУСК
//
//  После выбора папки человек попадал сразу в пустую рукопись — ни
//  намёка, что есть демо-данные, поиск по "/", темы и настройки под
//  шестерёнкой. Obsidian и World Anvil в первую секунду показывают
//  что-то подобное — короткую подсказку, а не оставляют разбираться
//  самостоятельно. Показывается один раз на устройство (localStorage);
//  не привязано к проекту — если заведут второй, подсказка не всплывёт
//  заново, это не про конкретные данные, а про то, что вообще умеет
//  приложение.
// ══════════════════════════════════════════════

import { i18n } from "./i18n.js";

const SEEN_KEY = "fictaris_onboarding_seen";

export function maybeShowOnboarding({ onFillDemo }) {
  if (localStorage.getItem(SEEN_KEY)) return;

  const overlay = document.createElement("div");
  overlay.className = "search-overlay"; // тот же фон-подложка, что у поиска
  const card = document.createElement("div");
  card.className = "onboarding-card";
  card.innerHTML = `
    <h2>${i18n("Добро пожаловать в Fictaris")}</h2>
    <ul>
      <li>${i18n("<b>Поиск</b> — клавиша <kbd>/</kbd> или кнопка в сайдбаре ищет сразу по всем модулям.")}</li>
      <li>${i18n("<b>⚙ Настройки</b> — тема, акцент, подписи меню, горячие клавиши, синхронизация между устройствами.")}</li>
      <li>${i18n("<b>«⚙ Настройки» → «Данные» → «Заполнить примером»</b> — связный тестовый сюжет, чтобы сразу увидеть, как модули работают вместе.")}</li>
    </ul>
  `;

  const actions = document.createElement("div");
  actions.className = "onboarding-actions";

  const demoBtn = document.createElement("button");
  demoBtn.className = "btn accent";
  demoBtn.textContent = i18n("Заполнить примером");
  demoBtn.addEventListener("click", () => {
    dismiss();
    onFillDemo();
  });

  const skipBtn = document.createElement("button");
  skipBtn.className = "btn";
  skipBtn.textContent = i18n("Понятно, дальше сам");
  skipBtn.addEventListener("click", dismiss);

  actions.append(demoBtn, skipBtn);
  card.appendChild(actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  function dismiss() {
    localStorage.setItem(SEEN_KEY, "1");
    overlay.remove();
  }
}
