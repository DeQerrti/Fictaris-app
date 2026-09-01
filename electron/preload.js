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
// ══════════════════════════════════════════════

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("fictaris", {
  invoke: (method, path, body) => ipcRenderer.invoke("api", { method, path, body }),
});
