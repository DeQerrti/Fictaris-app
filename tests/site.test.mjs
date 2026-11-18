// Экспорт сайта: «для читателей» без тайных записей и полей.
import { test } from "node:test";
import assert from "node:assert/strict";

const data = {
  "/api/characters": [
    { id: "a", name: "Астра", templateId: "default", role: "Наследница", backstory: "Видела @Тейн у ворот" },
    { id: "t", name: "Тейн", secret: true, templateId: "default", role: "Предатель" },
  ],
  "/api/locations": [{ id: "l", name: "Ивняк", type: "settlement", templateId: "default" }],
  "/api/factions": [],
  "/api/timeline": [],
  "/api/relationships": [{ id: "r", charA: "a", charB: "t", label: "враг" }],
  "/api/site-settings": {
    templates: { characters: [{ id: "default", name: "Т", fields: [
      { key: "role", label: "Роль", type: "input" },
      { key: "backstory", label: "Прошлое", type: "textarea", secret: true },
    ] }] },
  },
  "/api/export-backup": { files: {}, images: {} },
};
globalThis.fetch = async (url) => ({ ok: true, status: 200, json: async () => structuredClone(data[url] ?? []) });
let lastBlob = null;
globalThis.URL.createObjectURL = (b) => { lastBlob = b; return "blob:x"; };
globalThis.URL.revokeObjectURL = () => {};
document.createElement = () => ({ click() {} });

const { exportSiteZip } = await import("../app/js/export-site.js");
const text = async () => Buffer.from(await lastBlob.arrayBuffer()).toString("utf8");

test("сайт: полный экспорт содержит тайны", async () => {
  await exportSiteZip();
  const t = await text();
  assert.ok(t.includes("characters/t.html"));
  assert.ok(t.includes("Видела"));
});

test("сайт для читателей: без тайной записи, тайного поля и ссылок на них", async () => {
  await exportSiteZip({ readers: true });
  const t = await text();
  assert.ok(!t.includes("characters/t.html"), "страницы тайного персонажа нет");
  assert.ok(!t.includes("Предатель"));
  assert.ok(!t.includes("Видела"), "тайного поля нет");
  assert.ok(!t.includes("t.html\">Тейн"), "ссылки на тайного нет");
  assert.ok(t.includes("Наследница"));
});
