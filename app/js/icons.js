// Маленький набор inline-SVG-иконок для типов локаций — по духу
// lucide-react из брифа (Landmark/DoorOpen/AlertTriangle/Gem/MapPin),
// но без внешней зависимости: тут нет сборки, а тащить целый пакет
// иконок ради пяти штук незачем.

const PATHS = {
  landmark: '<path d="M4 21h16M6 21V10M10 21V10M14 21V10M18 21V10M4 10l8-6 8 6"/>',
  door: '<rect x="6" y="3" width="12" height="18" rx="1"/><circle cx="14" cy="12" r="1"/>',
  alert: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/>',
  gem: '<path d="M6 3h12l3 6-9 12L3 9z"/><path d="M3 9h18M9 3l3 6 3-6M9 15l3-6 3 6"/>',
  pin: '<path d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  crown: '<path d="M3 18h18M4 18l-1-9 5 4 4-7 4 7 5-4-1 9"/>',
  shield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>',
  flame: '<path d="M12 2c1 4-3 4-3 8a3 3 0 0 0 6 0c0-1-1-2-1-3 2 1 3 4 3 6a5 5 0 0 1-10 0c0-4 3-6 5-11z"/>',
  sword: '<path d="M14 2 4 12l-1 5 5-1L18 6z"/><path d="M17 5l2 2M3 21l4-4"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9 9.5c0-1.5 1.5-2.5 3-2.5s3 1 3 2.5-1.5 2-3 2.5-3 1-3 2.5 1.5 2.5 3 2.5 3-1 3-2.5"/>',
  note: '<path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/><path d="M8 12h7M8 16h5"/>',
  folder: '<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6z"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  pencil: '<path d="M4 20l1-4L16 5l3 3L8 19l-4 1z"/><path d="M14 7l3 3"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="14" r="3.5"/>',
  more: '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  focus: '<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>',
  close: '<path d="M5 5l14 14M19 5L5 19"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
  shuffle: '<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>',
  chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
  chevronRight: '<path d="M9 6l6 6-6 6"/>',

  // "Новая глава"/"Новая папка" в шапке списка глав (manuscript.js) —
  // тот же note/folder выше, плюс крестик поверх, как в Obsidian
  // (значки создания сразу в шапке проводника, а не отдельными
  // кнопками-плашками внизу списка).
  notePlus: '<path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/><path d="M9 14h6M12 11v6"/>',
  folderPlus: '<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6z"/><path d="M9 13h6M12 10v6"/>',

  // Значок настроек (settingsBtn, index.html) — раньше был голым
  // символом "⚙" прямо в разметке, единственное место в сайдбаре, не
  // нарисованное этим набором. "Ползунки" вместо шестерёнки — тот же
  // смысл (настройки), но геометрически надёжнее нарисовать вручную,
  // чем зубчатый круг: три прямые линии и три кружка вместо дюжины
  // сегментов дуг, риск получить кривую форму заметно ниже.
  settings: '<line x1="4" y1="6" x2="20" y2="6"/><circle cx="9" cy="6" r="2"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="15" cy="12" r="2"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="9" cy="18" r="2"/>',

  // Иконки пунктов сайдбара (applyNavIcons ниже) — с полутора десятками
  // разделов один текст без единой опорной точки сканируется взглядом
  // хуже, чем текст + иконка; тот же набор из брифа (lucide-style
  // simple line icons), просто под конкретные разделы меню, а не типы
  // сущностей. Нарочно геометрически простые — при 16px в сайдбаре
  // детализация всё равно не читается, а простая форма ещё узнаётся.
  book: '<path d="M4 5a2 2 0 0 1 2-2h11v16H6a2 2 0 0 0-2 2z"/><path d="M17 3v16"/>',
  columns: '<rect x="3" y="4" width="6" height="16" rx="1"/><rect x="10" y="4" width="6" height="10" rx="1"/><rect x="17" y="4" width="4" height="7" rx="1"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/>',
  link: '<path d="M9 15l6-6"/><path d="M13 5l1-1a4 4 0 0 1 6 6l-1 1"/><path d="M11 19l-1 1a4 4 0 0 1-6-6l1-1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  map: '<path d="M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
  network: '<circle cx="6" cy="6" r="2.2"/><circle cx="18" cy="6" r="2.2"/><circle cx="12" cy="18" r="2.2"/><path d="M7.8 7.2L11 16M16.2 7.2L13 16M8.2 6h7.6"/>',
  tree: '<circle cx="12" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/><path d="M12 7v4M12 11L6 17M12 11l6 6"/>',
  frame: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  route: '<circle cx="6" cy="4" r="2"/><circle cx="6" cy="20" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 6v12"/><path d="M6 12h6a4 4 0 0 0 4-4"/>',
  lightbulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  barChart: '<path d="M4 20V10M12 20V4M20 20v-7"/>',
  checkShield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M10 11v6M14 11v6"/>',

  // Для командной палитры (search.js) — экспорт сайта и горячие клавиши,
  // остальные её действия переиспользуют иконки выше (book — PDF, eye —
  // оформление, note — шаблоны анкет).
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12"/>',
};

// Пункт сайдбара → ключ иконки выше. locations/factions переиспользуют
// pin/shield — те же геометрические формы уже значат "место"/"защита"
// в самих карточках локаций/фракций (LOCATION_TYPES/FACTION_TYPES),
// смысл не расходится.
const NAV_ICONS = {
  manuscript: "book",
  board: "columns",
  characters: "user",
  locations: "pin",
  factions: "shield",
  relationships: "link",
  timeline: "clock",
  map: "map",
  graph: "network",
  familytree: "tree",
  canvas: "frame",
  plotgraph: "route",
  knowledge: "lightbulb",
  stats: "barChart",
  continuity: "checkShield",
  trash: "trash",
};

// Вызывается один раз при загрузке (main.js, boot()), до applyLabels() —
// та работает через первый текстовый узел кнопки и не трогает то, что
// перед ним, так что порядок здесь не принципиален, но так нагляднее:
// сперва иконка появляется, потом подпись подстраивается под язык.
export function applyNavIcons() {
  // Кнопка настроек — не .nav-item (см. комментарий в main.js про
  // нумерацию горячих клавиш), поэтому мимо цикла ниже; тот же приём.
  const settingsBtn = document.getElementById("settingsBtn");
  if (settingsBtn && !settingsBtn.innerHTML) settingsBtn.innerHTML = iconSvg("settings", 16);

  document.querySelectorAll(".nav-item[data-module]").forEach((btn) => {
    const key = NAV_ICONS[btn.dataset.module];
    if (key && !btn.querySelector(".nav-icon")) {
      const icon = document.createElement("span");
      icon.className = "nav-icon";
      icon.innerHTML = iconSvg(key, 16);
      btn.prepend(icon);
    }
    // Оборачиваем текстовый узел подписи в свой <span> — нужно режиму
    // сайдбара "только иконки" (sidebar.js, style.css): спрятать нужно
    // именно подпись, отдельно от иконки и .trash-badge у «Корзины»,
    // а у голого текстового узла такой избирательности нет.
    if (!btn.querySelector(".nav-label")) {
      const textNode = Array.from(btn.childNodes).find((n) => n.nodeType === Node.TEXT_NODE);
      if (textNode) {
        const label = document.createElement("span");
        label.className = "nav-label";
        label.textContent = textNode.textContent;
        textNode.replaceWith(label);
      }
    }
  });
}

export const LOCATION_TYPES = [
  ["settlement", "Город / поселение", "landmark", "#c9944a"],
  ["dungeon", "Подземелье / руины", "door", "#7d6a9e"],
  ["danger", "Опасность", "alert", "#a4483c"],
  ["treasure", "Сокровище / находка", "gem", "#9a9250"],
  ["other", "Другое", "pin", "#7c7157"],
];

export function locationTypeInfo(type) {
  return LOCATION_TYPES.find((t) => t[0] === type) || LOCATION_TYPES[LOCATION_TYPES.length - 1];
}

export const FACTION_TYPES = [
  ["order", "Орден / гильдия", "shield", "#6a8fae"],
  ["monarchy", "Монархия", "crown", "#c9944a"],
  ["cult", "Культ", "flame", "#a4483c"],
  ["military", "Военная организация", "sword", "#7d6a9e"],
  ["syndicate", "Синдикат", "coin", "#9a9250"],
  ["other", "Другое", "pin", "#7c7157"],
];

export function factionTypeInfo(type) {
  return FACTION_TYPES.find((t) => t[0] === type) || FACTION_TYPES[FACTION_TYPES.length - 1];
}

export function iconSvg(name, size = 20) {
  const path = PATHS[name] || PATHS.pin;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}
