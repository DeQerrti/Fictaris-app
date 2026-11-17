// Открыто ли окно поверх раздела: карточка (entity-modal.js), Настройки,
// боковая панель (side-panel.js). Пока оно открыто, горячие клавиши
// разделов (Холст, Мастерская карты, цифры 1–9) не должны срабатывать
// под ним — фокус может стоять на кнопке или флажке в окне.
export function overlayOpen() {
  return !!document.querySelector(".entity-modal-backdrop, .side-panel-backdrop");
}
