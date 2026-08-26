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
};

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
