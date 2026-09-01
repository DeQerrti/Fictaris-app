// ══════════════════════════════════════════════
//  PRELOAD
//
//  Единственная дверь из страницы (contextIsolation: true, sandbox:
//  true, nodeIntegration: false) наружу — один общий канал IPC вместо
//  отдельного метода на каждый роут: диспетчеризация ("какой роут, что
//  с vault") целиком остаётся в main-процессе (electron/main.js), а
//  сюда наружу не протекает ничего опаснее "вызови api с этими тремя
//  полями". Страница берёт это на входе через window.fictaris —
//  дальше её подхватывает app/js/electron-bridge.js.
//
//  Только CommonJS (require), несмотря на "type": "module" в
//  package.json и на .mjs-требование для обычных ES-модулей: сэндбокс
//  сам по себе ES-модули в preload не поддерживает — контекст, в
//  котором Electron исполняет сэндбоксовый preload, устроен как
//  синхронный CommonJS, и там нет ни import, ни module.exports с ESM-
//  семантикой. .cjs — чтобы Node точно не пытался разобрать файл как
//  ESM ни при какой конфигурации.
// ══════════════════════════════════════════════

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fictaris", {
  invoke: (method, path, body) => ipcRenderer.invoke("api", { method, path, body }),
});
