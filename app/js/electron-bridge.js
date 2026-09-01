// ══════════════════════════════════════════════
//  ЭЛЕКТРОННАЯ ОБВЯЗКА
//
//  Тот же приём, что у мобильной (mobile/src/main.js, installFetch): а
//  fetch("/api/characters") и т.д. остаются как есть во всём остальном
//  фронтенде (app/js/api.js, app/js/sync.js — ни строки изменений), а
//  здесь подменяется сам window.fetch — уходит не в сеть, а в
//  window.fictaris.invoke (contextBridge из electron/preload.js), то
//  есть в IPC до основного процесса. На телефоне и в браузере
//  window.fictaris нет — там этот файл ничего не делает.
//
//  Обычный скрипт, не модуль — грузится раньше mobile.bundle.js и
//  main.js (см. app/index.html), поэтому патчит window.fetch до того,
//  как что-либо успевает вызвать его в оригинале.
// ══════════════════════════════════════════════

(function installElectronBridge() {
  if (typeof window === "undefined" || !window.fictaris) return;

  const original = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url || "";
    if (!url.startsWith("/api/")) return original(input, init);

    const merged = typeof input === "object" && input ? { ...input, ...init } : init;
    const method = (merged?.method || "GET").toUpperCase();
    const body = merged?.body ? JSON.parse(merged.body) : {};

    const { status, data } = await window.fictaris.invoke(method, url, body);
    return new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  };
})();
