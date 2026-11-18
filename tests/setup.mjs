// Минимальное окружение страницы для модулей app/js, которые при загрузке
// трогают document/window/localStorage. Сами тесты — только про логику
// без отрисовки: DOM здесь нет.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
globalThis.document = {
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
  getElementById: () => null,
  querySelector: () => null,
  documentElement: { lang: "ru", style: { setProperty() {} } },
};
globalThis.window = globalThis;
if (!globalThis.CustomEvent) {
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  };
}
