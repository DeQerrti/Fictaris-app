// Логика без отрисовки: история версий, разметка, упоминания, календарь,
// счёт слов, проверка данных. Запуск: npm test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { historyToPrune, newestHistoryTime } from "../core/files.js";
import { toReaderText, parseInlineSegments } from "../app/js/text-format.js";
import { replaceMentionName, findMentionedIds } from "../app/js/mentions.js";
import { unlinkMentions } from "../app/js/cascade.js";
import { weekdayOf, calendarOrder, yearLength } from "../app/js/calendar.js";
import { wordCount } from "../app/js/stats.js";
import { sanitizeVaultData, safeColor, safeImagePath } from "../app/js/sanitize.js";
import { isDead } from "../app/js/kinship.js";

const histName = (t) => new Date(t).toISOString().replace(/[:.]/g, "-") + ".json";

test("история: прореживание по времени", () => {
  const now = Date.parse("2026-11-17T12:00:00.000Z");
  const files = [];
  for (let t = now - 40 * 864e5; t <= now; t += 2 * 60e3) files.push(histName(t));
  const drop = new Set(historyToPrune(files, now));
  const kept = files.filter((f) => !drop.has(f));
  assert.ok(kept.length < 100, `осталось ${kept.length}`);
  assert.ok(kept.includes(histName(now)), "самая свежая остаётся");
  assert.equal(newestHistoryTime(files), now);
});

test("экспорт: текст для читателя без служебной разметки", () => {
  const t = "Ход. @[Астра Вирен|Астра] шла. [[note:n1]]\n@Вельда, почта a@b.ru, \"@Ян\".";
  assert.equal(toReaderText(t), "Ход. Астра шла.\nВельда, почта a@b.ru, \"Ян\".");
});

test("форматирование для .docx", () => {
  const segs = parseInlineSegments("а **жир** и *кур*");
  assert.deepEqual(segs.map((s) => [s.text, !!s.bold, !!s.italic]), [["а ", false, false], ["жир", true, false], [" и ", false, false], ["кур", false, true]]);
});

test("упоминания: переименование не трогает похожие имена", () => {
  const t = "@Ян пришёл. @[Ян|Яну] сказали. @Ян Вирен молчал. @Яна смеялась. @Ян, и всё.";
  const r = replaceMentionName(t, "Ян", "Иван", ["Ян", "Ян Вирен", "Яна"]);
  assert.equal(r.text, "@Иван пришёл. @[Иван|Яну] сказали. @Ян Вирен молчал. @Яна смеялась. @Иван, и всё.");
  assert.equal(r.count, 3);
});

test("упоминания: буквы вне кириллицы и латиницы", () => {
  const chars = [{ id: "1", name: "Anaé" }, { id: "2", name: "Ana" }, { id: "3", name: "Анна-Мария" }];
  assert.deepEqual([...findMentionedIds("@Anaé и @Анна-Мария", chars)].sort(), ["1", "3"]);
});

test("удаление персонажа: упоминания становятся обычным текстом", () => {
  const r = unlinkMentions("@[Вельда|Вельде] дали, @Вельда ушла, @Вельдана тут", "Вельда", ["Вельдана"]);
  assert.equal(r.text, "Вельде дали, Вельда ушла, @Вельдана тут");
});

test("календарь: день недели от 1-го дня 1-го года, порядок на шкале", () => {
  const cal = { months: Array.from({ length: 12 }, () => ({ days: 30 })), weekdays: ["1", "2", "3", "4", "5", "6", "7"], weekOffset: 2 };
  assert.equal(weekdayOf(cal, 1, 0, 1), 2);
  assert.equal(weekdayOf(cal, 1, 0, 2), 3);
  assert.equal(weekdayOf(cal, 2, 0, 1), (2 + 360) % 7);
  assert.equal(yearLength({ months: [{ days: "30" }, { days: 30 }] }), 60);
  assert.ok(calendarOrder(cal, 1, 0, 1) < 2 && calendarOrder(cal, 300, 0, 1) >= 300);
});

test("счёт слов: тире не слово", () => {
  assert.equal(wordCount("– Не кричи, – сказал он. — Да! 2024 год"), 7);
});

test("родство: «умеренно» не значит «умер»", () => {
  assert.equal(isDead({ age: "умеренно стар" }), false);
  assert.equal(isDead({ age: "умерла в 214" }), true);
  assert.equal(isDead({ age: "погибель" }), false);
});

test("проверка данных: цвета, картинки, координаты", () => {
  assert.equal(safeColor("red\"><img>"), null);
  assert.equal(safeColor("#c9944a"), "#c9944a");
  assert.equal(safeImagePath("maps/x.png"), "maps/x.png");
  assert.equal(safeImagePath("x\" onerror=\"1"), null);
  const chars = sanitizeVaultData("characters", [{ id: "a", color: "red;x", images: ["maps/a.jpg", "../b.exe"], height: "180 см" }]);
  assert.equal(chars[0].color, null);
  assert.deepEqual(chars[0].images, ["maps/a.jpg"]);
  assert.equal(chars[0].height, "180 см", "свои поля анкеты не трогаем");
  const map = sanitizeVaultData("map", { maps: { m: { imageRelPath: "maps/a.png", drawing: { shapes: [{ kind: "stamp", icon: "x\"y", x: "1\"/>", y: 5, points: [["1", 2]] }] }, pins: [{ x: "10", y: 20 }] } } });
  const s = map.maps.m.drawing.shapes[0];
  assert.equal(s.icon, "city");
  assert.equal(s.x, 0);
  assert.deepEqual(s.points, [[1, 2]]);
  assert.equal(map.maps.m.pins[0].x, 10);
});
