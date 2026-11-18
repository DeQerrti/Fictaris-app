// Ссылки на места и фракции в тексте главы ([[place:id|слово]]).
import { test } from "node:test";
import assert from "node:assert/strict";
import { toReaderText, linkedEntityIds, unlinkEntity } from "../app/js/text-format.js";
import { matchScore, rankTargets, linkTargets } from "../app/js/rich-editor.js";

const text = "До [[place:loc-1|Ивняка]] шли три ночи. [[faction:f-2|Орден]] молчал. @[Астра Вирен|Астра] ждала. [[note:n1]]";

test("ссылки: в экспорте и поиске – только слово", () => {
  assert.equal(toReaderText(text), "До Ивняка шли три ночи. Орден молчал. Астра ждала.");
});

test("ссылки: какие места и фракции упомянуты", () => {
  assert.deepEqual([...linkedEntityIds(text, "place")], ["loc-1"]);
  assert.deepEqual([...linkedEntityIds(text, "faction")], ["f-2"]);
});

test("ссылки: удалили место – в тексте осталось слово", () => {
  const r = unlinkEntity(text, "place", "loc-1");
  assert.equal(r.count, 1);
  assert.ok(r.text.startsWith("До Ивняка шли"));
  assert.ok(r.text.includes("[[faction:f-2|Орден]]"), "чужие ссылки на месте");
});

test("поиск цели: падеж выделенного слова находит название", () => {
  assert.ok(matchScore("Ивняк", "Ивняке") > 0);
  assert.ok(matchScore("Вельда", "Вельде") > 0);
  assert.ok(matchScore("Орден Раскола", "Раскола") > 0);
  assert.equal(matchScore("Сольвейн", "Ивняке"), 0);
  const targets = linkTargets({
    characters: [{ id: "c1", name: "Вельда", color: "#5a8a5f" }],
    locations: [{ id: "l1", name: "Ивняк", type: "settlement" }, { id: "l2", name: "Сольвейн", type: "settlement" }],
    factions: [{ id: "f1", name: "Вольные деревни", type: "other" }],
  });
  const ranked = rankTargets(targets, "Ивняке");
  assert.equal(ranked[0].id, "l1");
  assert.equal(ranked[0].kind, "place");
});
