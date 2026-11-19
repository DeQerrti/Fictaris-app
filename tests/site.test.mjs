// Экспорт сайта: «для читателей» без тайных записей и полей.
import { test } from "node:test";
import assert from "node:assert/strict";

const data = {
  "/api/characters": [
    { id: "a", name: "Астра", templateId: "default", role: "Наследница, ||дочь Варна||, изгнанница", backstory: "Видела @Тейн у ворот" },
    { id: "t", name: "Тейн", secret: true, templateId: "default", role: "Предатель" },
  ],
  "/api/locations": [{ id: "l", name: "Ивняк", type: "settlement", templateId: "default" }],
  "/api/factions": [],
  "/api/timeline": [
    { id: "e1", order: 1, title: "Коронация", description: "Пир. ||Отравили вино.||", characterIds: ["a"] },
    { id: "e2", order: 2, title: "Тайный сговор", secret: true },
    { id: "e3", order: 3, title: "Встреча у ворот", characterIds: ["t"] },
  ],
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

test("сайт для читателей: без ||тайных слов||, тайных событий и событий с тайными участниками", async () => {
  await exportSiteZip({ readers: true });
  const t = await text();
  assert.ok(t.includes("Наследница, изгнанница"), "тайные слова выпали, запятые на месте");
  assert.ok(!t.includes("дочь Варна"));
  assert.ok(t.includes("Коронация") && t.includes("Пир."));
  assert.ok(!t.includes("Отравили"));
  assert.ok(!t.includes("Тайный сговор"));
  assert.ok(!t.includes("Встреча у ворот"));
});

test("полный сайт: тайные слова остаются, без чёрточек", async () => {
  await exportSiteZip();
  const t = await text();
  assert.ok(t.includes("Наследница, дочь Варна, изгнанница"));
  assert.ok(t.includes("Тайный сговор") && t.includes("Отравили вино."));
  assert.ok(!t.includes("||"));
});
