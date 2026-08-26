// ══════════════════════════════════════════════
//  ГЕНЕРАТОР ИМЁН
//
//  Фича из ресерча по рынку (World Anvil, Fantasy Name Generators) —
//  ни у Fictaris, ни у TasteID её не было. Без внешних сервисов и без
//  ИИ: банки слогов на несколько «вибов» + правила сборки, тот же
//  уровень сложности, что у простых генераторов World Anvil (не
//  Марков, не нейросеть — комбинаторика, которой достаточно для
//  наброска персонажа за секунду).
// ══════════════════════════════════════════════

const STYLES = {
  human: {
    label: "Человеческое",
    lead: ["Ар", "Бер", "Вил", "Гар", "Дор", "Кар", "Мар", "Рол", "Стен", "Тор", "Эд", "Фаль", "Хель", "Освин"],
    mid: ["ан", "ин", "он", "ард", "берт", "мунд", "рик", "вин", "гар", ""],
    tail: ["", "д", "н", "с", "ль", "т", "рд"],
  },
  elven: {
    label: "Эльфийское",
    lead: ["Ael", "Cael", "Fael", "Ith", "Lor", "Syl", "Thal", "Val", "Ela", "Nym", "Eryn"],
    mid: ["a", "e", "i", "ae", "ie", "an", "el", "ith"],
    tail: ["riel", "wen", "dir", "las", "iel", "aan", "eth", ""],
  },
  dark: {
    label: "Тёмное / орочье",
    lead: ["Груб", "Мор", "Скар", "Гнар", "Кхаз", "Уруг", "Дрог", "Ваз", "Нар", "Круг"],
    mid: ["ок", "аш", "уз", "ог", "ар", ""],
    tail: ["наг", "дур", "гат", "ша", "к", "т", ""],
  },
  place: {
    label: "Топоним",
    lead: ["Черн", "Бел", "Красн", "Стар", "Нов", "Тих", "Дальн", "Светл", "Сум", "Глух"],
    mid: ["о", "а", "и", ""],
    tail: ["город", "поле", "лес", "брод", "холм", "дол", "гард", "мор"],
  },
};

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const NAME_STYLES = Object.entries(STYLES).map(([id, s]) => ({ id, label: s.label }));

export function generateName(styleId) {
  const style = STYLES[styleId] || STYLES.human;
  const raw = pick(style.lead) + pick(style.mid) + pick(style.tail);
  return capitalize(raw.toLowerCase());
}

// Кнопка со стрелкой обновления — сама выбирает случайный стиль на
// каждый клик, если явно не задан один: разнообразие интереснее, чем
// вкладывать в один компонент ещё и выбор стиля отдельным полем.
export function buildNameGeneratorButton(onGenerated, styleId) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn name-gen-btn";
  btn.textContent = "🎲";
  btn.title = "Сгенерировать имя";
  btn.addEventListener("click", () => {
    const style = styleId || pick(Object.keys(STYLES));
    onGenerated(generateName(style));
  });
  return btn;
}
