// Комментарии к тексту: метки, привязка цитаты, импорт отзыва.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findQuote, addAnchoredComment, importFeedback, removeCommentMarks, commentIdsIn } from "../app/js/comments.js";
import { toReaderText } from "../app/js/text-format.js";
import { wordCount } from "../app/js/stats.js";

test("метки комментария не видны читателю и не считаются словами", () => {
  const t = "Она [[c:a1]]шла **молча**[[/c]] дальше.";
  assert.equal(toReaderText(t), "Она шла **молча** дальше.");
  assert.equal(wordCount(t), 4);
  assert.deepEqual([...commentIdsIn(t)], ["a1"]);
  assert.equal(removeCommentMarks(t, "a1"), "Она шла **молча** дальше.");
});

test("цитата находится сквозь разметку, упоминания и ссылки", () => {
  const line = "Утром @Астра **ушла** в [[place:l1|Ивняк]], не оглядываясь.";
  const pos = findQuote(line, "Астра ушла в Ивняк");
  assert.ok(pos);
  assert.equal(line.slice(pos.start, pos.end), "@Астра **ушла** в [[place:l1|Ивняк]]".slice(1));
});

test("импорт отзыва раскладывает замечания по абзацам", () => {
  const ms = { chapters: [{ id: "c1", content: "Первый абзац.\nВторой абзац, где «шла Астра» молча." }] };
  const res = importFeedback({ format: "fictaris-feedback", reader: "Маша", comments: [
    { chapterId: "c1", para: 1, quote: "«шла Астра»", text: "Почему молча?" },
    { chapterId: "c1", para: 0, quote: "этого нет в тексте", text: "?" },
    { chapterId: "nope", para: 0, quote: "x", text: "y" },
  ] }, ms);
  assert.deepEqual(res, { anchored: 1, loose: 1, missing: 1 });
  const ch = ms.chapters[0];
  assert.match(ch.content, /\[\[c:[\w-]+\]\]«шла Астра»\[\[\/c\]\]/);
  assert.equal(ch.comments.length, 2);
  assert.equal(ch.comments[0].author, "Маша");
  assert.equal(toReaderText(ch.content), "Первый абзац.\nВторой абзац, где «шла Астра» молча.");
});

test("addAnchoredComment ищет по всей главе, если абзац сдвинулся", () => {
  const ch = { content: "Новый абзац сверху.\nСтарый текст тут." };
  assert.equal(addAnchoredComment(ch, 0, "Старый текст", { id: "z" }), true);
  assert.ok(ch.content.includes("[[c:z]]Старый текст[[/c]]"));
});
