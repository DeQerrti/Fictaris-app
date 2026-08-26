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

export function iconSvg(name, size = 20) {
  const path = PATHS[name] || PATHS.pin;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}
