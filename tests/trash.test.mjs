// Удаление в корзину и «Вернуть»: ссылки на запись возвращаются на место.
// Хранилище — в памяти, вместо /api/* (app/js/api.js ходит через fetch).
import { test } from "node:test";
import assert from "node:assert/strict";

const store = new Map();
globalThis.fetch = async (url, init = {}) => {
  const path = typeof url === "string" ? url : url.url;
  const json = (data) => ({ ok: true, status: 200, json: async () => structuredClone(data) });
  if ((init.method || "GET").toUpperCase() === "POST") {
    store.set(path, JSON.parse(init.body));
    return json({ ok: true });
  }
  return json(store.get(path) ?? []);
};

const { detachCharacter, reattachCharacter, reattachKin, detachFaction, reattachFaction } = await import("../app/js/cascade.js");
const { pushTrash, addTrashLinks, restoreEntry } = await import("../app/js/trash.js");

function seed() {
  store.clear();
  store.set("/api/characters", [
    { id: "a", name: "Аня", partnerIds: ["b"], partnerKinds: { b: "betrothed" } },
    { id: "b", name: "Борис", partnerIds: ["a"], partnerKinds: { a: "betrothed" } },
    { id: "c", name: "Вера", parentIds: ["a", "b"], uncertainParentIds: ["b"] },
  ]);
  store.set("/api/relationships", [{ id: "r1", charA: "a", charB: "c", label: "мать", score: 80 }]);
  store.set("/api/factions", [
    { id: "f1", name: "Орден", leaderId: "b", memberIds: ["b", "c"], relations: { f2: "enemies" } },
    { id: "f2", name: "Гильдия", memberIds: [], relations: { f1: "enemies" } },
  ]);
  store.set("/api/timeline", [{ id: "e1", characterIds: ["b", "c"] }]);
  store.set("/api/manuscript", { chapters: [{ id: "ch1", characterIds: ["b"], content: "@Борис пришёл. [[faction:f2|Гильдия]]" }] });
  store.set("/api/board", { boards: [{ id: "bd", columns: [], cards: { k1: { id: "k1", characterIds: ["b"], factionId: "f2" } }, cardOrder: {} }] });
  store.set("/api/map", { rootIds: ["m"], maps: { m: { id: "m", pins: [{ id: "p1", x: 0, y: 0, characterId: "b" }], drawing: { shapes: [{ id: "s1", kind: "border", factionId: "f2" }] } } } });
  store.set("/api/knowledge", { facts: [{ id: "k", label: "тайна", entries: { b: "ch1", c: "__start__" } }] });
  store.set("/api/trash", []);
}

const snapshot = () => structuredClone(Object.fromEntries(store));

test("корзина: персонаж возвращается с роднёй, связями и ссылками", async () => {
  seed();
  // Удаление — как в characters.js: родня, корзина, чистка, ссылки в запись корзины.
  const before = snapshot();
  const chars = store.get("/api/characters");
  const b = chars.find((x) => x.id === "b");
  const kin = [];
  for (const x of chars) {
    if (x.id === "b") continue;
    for (const k of ["parentIds", "adoptiveParentIds", "uncertainParentIds", "partnerIds"]) if (x[k]?.includes("b")) kin.push({ id: x.id, key: k, at: x[k].indexOf("b") });
    if (x.partnerKinds?.b) kin.push({ id: x.id, key: "partnerKind", value: x.partnerKinds.b });
  }
  const trashId = await pushTrash("character", b, { kin });
  const rest = chars.filter((x) => x.id !== "b").map((x) => {
    const y = structuredClone(x);
    for (const k of ["parentIds", "uncertainParentIds", "partnerIds"]) if (y[k]) y[k] = y[k].filter((i) => i !== "b");
    if (y.partnerKinds) delete y.partnerKinds.b;
    return y;
  });
  store.set("/api/characters", rest);
  await addTrashLinks(trashId, await detachCharacter(b, rest.map((x) => x.name)));

  assert.equal(store.get("/api/factions")[0].leaderId, null);
  assert.deepEqual(store.get("/api/map").maps.m.pins[0].characterId, null);

  const entry = store.get("/api/trash").find((e) => e.id === trashId);
  await restoreEntry(entry, store.get("/api/trash"));

  const after = snapshot();
  const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));
  assert.deepEqual(byId(after["/api/characters"]), byId(before["/api/characters"]), "родство и пары на месте");
  assert.deepEqual(after["/api/factions"], before["/api/factions"]);
  assert.deepEqual(after["/api/timeline"], before["/api/timeline"]);
  assert.deepEqual(after["/api/board"], before["/api/board"]);
  assert.deepEqual(after["/api/map"], before["/api/map"]);
  assert.deepEqual(after["/api/knowledge"], before["/api/knowledge"]);
  assert.deepEqual(after["/api/manuscript"].chapters[0].characterIds, ["b"]);
});

test("корзина: персонаж со связью из relationships — связь возвращается вместе с ним", async () => {
  seed();
  const chars = store.get("/api/characters");
  const a = chars.find((x) => x.id === "a");
  const trashId = await pushTrash("character", a, { kin: [] });
  store.set("/api/characters", chars.filter((x) => x.id !== "a"));
  await addTrashLinks(trashId, await detachCharacter(a, ["Борис", "Вера"]));
  assert.equal(store.get("/api/relationships").length, 0);
  const trash = store.get("/api/trash");
  const extra = await restoreEntry(trash.find((e) => e.id === trashId), trash);
  assert.deepEqual(store.get("/api/relationships").map((r) => r.id), ["r1"]);
  assert.deepEqual(extra.map((e) => e.type), ["relationship"], "запись связи уходит из корзины заодно");
});

test("корзина: фракция возвращает отношения, карточки и границы", async () => {
  seed();
  const before = snapshot();
  const factions = store.get("/api/factions");
  const f2 = factions.find((f) => f.id === "f2");
  const trashId = await pushTrash("faction", f2, { relations: { f1: "enemies" } });
  const links = await detachFaction("f2");
  const left = factions.filter((f) => f.id !== "f2");
  delete left[0].relations;
  store.set("/api/factions", left);
  const map = store.get("/api/map");
  delete map.maps.m.drawing.shapes[0].factionId;
  map.maps.m.drawing.shapes[0].name = "Гильдия";
  store.set("/api/map", map);
  await addTrashLinks(trashId, { ...links, borders: [{ map: "m", shape: "s1", named: true }] });

  assert.equal(store.get("/api/board").boards[0].cards.k1.factionId, null);
  const trash = store.get("/api/trash");
  await restoreEntry(trash.find((e) => e.id === trashId), trash);
  const after = snapshot();
  const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));
  assert.deepEqual(byId(after["/api/factions"]), byId(before["/api/factions"]));
  assert.deepEqual(after["/api/board"], before["/api/board"]);
  assert.deepEqual(after["/api/map"], before["/api/map"]);
});

test("корзина: ничего не вытесняется само", async () => {
  seed();
  store.set("/api/trash", Array.from({ length: 500 }, (_, i) => ({ id: "t" + i, type: "timeline", item: { id: "e" + i }, deletedAt: new Date(0).toISOString() })));
  await pushTrash("timeline", { id: "new" });
  assert.equal(store.get("/api/trash").length, 501);
});

test("reattachKin не дублирует уже стоящие ссылки", () => {
  const list = [{ id: "x", parentIds: ["p"] }];
  reattachKin(list, "p", [{ id: "x", key: "parentIds" }]);
  assert.deepEqual(list[0].parentIds, ["p"]);
  void reattachCharacter;
  void reattachFaction;
});
