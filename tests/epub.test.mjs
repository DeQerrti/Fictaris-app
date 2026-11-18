// Экспорт в EPUB: устройство архива и содержимое.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEpub, paragraphXhtml } from "../app/js/epub.js";

// Имена и содержимое файлов из ZIP без сжатия (store) — как пишет zip-writer.js.
function readZip(bytes) {
  const out = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 0;
  while (i + 30 < bytes.length && dv.getUint32(i, true) === 0x04034b50) {
    const method = dv.getUint16(i + 8, true);
    const size = dv.getUint32(i + 18, true);
    const nameLen = dv.getUint16(i + 26, true);
    const extraLen = dv.getUint16(i + 28, true);
    const name = new TextDecoder().decode(bytes.slice(i + 30, i + 30 + nameLen));
    const start = i + 30 + nameLen + extraLen;
    out.push({ name, method, text: new TextDecoder().decode(bytes.slice(start, start + size)) });
    i = start + size;
  }
  return out;
}

const book = {
  title: "Раскольный клинок",
  author: "Автор & Ко",
  lang: "ru",
  parts: [
    { title: "Часть I. Пепел", chapters: [{ title: "Глава 1", content: "Ход пах камнем. @[Астра Вирен|Астра] шла. [[note:n1]]\n\n**Жирно** и *курсив*." }] },
    { title: null, chapters: [{ title: "Пролог", content: "До [[place:l1|Ивняка]] шли <три> ночи." }] },
  ],
};

test("EPUB: mimetype первым и без сжатия, есть всё нужное", () => {
  const files = readZip(buildEpub(book));
  assert.equal(files[0].name, "mimetype");
  assert.equal(files[0].method, 0);
  assert.equal(files[0].text, "application/epub+zip");
  const names = files.map((f) => f.name);
  for (const n of ["META-INF/container.xml", "OEBPS/content.opf", "OEBPS/nav.xhtml", "OEBPS/toc.ncx", "OEBPS/title.xhtml", "OEBPS/style.css"]) assert.ok(names.includes(n), n);
  const opf = files.find((f) => f.name === "OEBPS/content.opf").text;
  assert.match(opf, /<dc:title>Раскольный клинок<\/dc:title>/);
  assert.match(opf, /<dc:creator>Автор &amp; Ко<\/dc:creator>/);
  assert.match(opf, /dcterms:modified/);
});

test("EPUB: текст главы без служебной разметки, оформление и экранирование", () => {
  const files = readZip(buildEpub(book));
  const ch1 = files.find((f) => f.name.endsWith("chapter-2.xhtml")).text;
  assert.ok(ch1.includes("Астра шла."));
  assert.ok(!ch1.includes("@[") && !ch1.includes("[[note"));
  assert.ok(ch1.includes("<strong>Жирно</strong>") && ch1.includes("<em>курсив</em>"));
  const prologue = files.find((f) => f.name.endsWith("chapter-3.xhtml")).text;
  assert.ok(prologue.includes("До Ивняка шли &lt;три&gt; ночи."));
  const nav = files.find((f) => f.name === "OEBPS/nav.xhtml").text;
  assert.ok(nav.includes("Часть I. Пепел") && nav.includes("Пролог"));
});

test("EPUB: абзац с оформлением", () => {
  assert.equal(paragraphXhtml("а **б** в"), "а <strong>б</strong> в");
});
