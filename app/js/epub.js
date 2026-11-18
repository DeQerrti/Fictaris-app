// ══════════════════════════════════════════════
//  ЭКСПОРТ КНИГИ В EPUB
//
//  EPUB 3 (+ toc.ncx для старых читалок) — для самиздата и чтения на
//  телефоне/читалке: Apple Books, Google Play Книги, Kindle (через «Отправить
//  на Kindle»), Литрес, Ridero принимают EPUB. Внутри: титульная страница,
//  оглавление по частям (папки верхнего уровня) и главам, текст главы с
//  оформлением (**жирный**, *курсив* и т.д.) без служебной разметки
//  (упоминания → слово, стикеры убраны — toReaderText).
//
//  Архив собирает zip-writer.js без сжатия: первым — mimetype, как требует
//  стандарт. Каждый абзац проверяется на корректный XHTML: неудачная
//  разметка вроде «***так***» даёт перепутанные теги, а строгие читалки
//  (Apple Books) на таком не открывают книгу — такой абзац уходит
//  простым текстом.
// ══════════════════════════════════════════════

import { buildZip } from "./zip-writer.js";
import { applyInlineMarkupHtml, toReaderText } from "./text-format.js";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Корректен ли кусок XHTML (там, где есть DOMParser — в приложении).
function validXhtml(fragment) {
  if (typeof DOMParser === "undefined") return true;
  const doc = new DOMParser().parseFromString(`<div xmlns="http://www.w3.org/1999/xhtml">${fragment}</div>`, "application/xhtml+xml");
  return !doc.getElementsByTagName("parsererror").length;
}

export function paragraphXhtml(line) {
  const formatted = applyInlineMarkupHtml(esc(line));
  return validXhtml(formatted) ? formatted : esc(line.replace(/\*\*|~~|==|<\/?u>|\*/g, ""));
}

function page(title, body, lang) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head>
<meta charset="utf-8"/>
<title>${esc(title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${body}
</body>
</html>
`;
}

const CSS = `body { font-family: serif; line-height: 1.5; margin: 0 5%; }
h1 { font-size: 1.6em; text-align: center; margin: 2em 0 1.2em; font-weight: bold; }
h1.part { font-size: 2em; margin-top: 35%; }
p { margin: 0; text-indent: 1.5em; text-align: justify; }
p.first, p.empty + p { text-indent: 0; }
p.empty { height: 1em; }
.title-page { text-align: center; margin-top: 30%; }
.title-page .book { font-size: 2.2em; font-weight: bold; margin-bottom: 1em; }
.title-page .author { font-size: 1.3em; }
mark { background: #fff2a8; color: inherit; }
`;

function chapterBody(ch, untitled) {
  const lines = toReaderText(ch.content).split("\n");
  let html = `<h1>${esc(ch.title || untitled)}</h1>\n`;
  let first = true;
  for (const line of lines) {
    if (!line.trim()) {
      html += `<p class="empty"></p>\n`;
      continue;
    }
    html += `<p${first ? ' class="first"' : ""}>${paragraphXhtml(line)}</p>\n`;
    first = false;
  }
  return html;
}

// book: { title, author, lang, parts: [{ title | null, chapters: [{ title, content }] }], labels: { contents, untitled } }
export function buildEpub(book) {
  const lang = book.lang === "en" ? "en" : "ru";
  const L = { contents: "Содержание", untitled: "Без названия", ...(book.labels || {}) };
  const title = book.title || L.untitled;
  const id = `urn:uuid:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const files = [];
  const manifest = [];
  const spine = [];
  const navItems = [];
  const ncxPoints = [];
  let order = 0;
  const add = (name, text, mediaType, props = "") => {
    files.push({ name: `OEBPS/${name}`, text });
    const itemId = `i${files.length}`;
    manifest.push(`<item id="${itemId}" href="${name}" media-type="${mediaType}"${props ? ` properties="${props}"` : ""}/>`);
    return itemId;
  };
  const ncxPoint = (label, href, children = "") => `<navPoint id="n${++order}" playOrder="${order}"><navLabel><text>${esc(label)}</text></navLabel><content src="${href}"/>${children}</navPoint>`;

  add("style.css", CSS, "text/css");
  const titleId = add(
    "title.xhtml",
    page(title, `<div class="title-page"><div class="book">${esc(title)}</div>${book.author ? `<div class="author">${esc(book.author)}</div>` : ""}</div>`, lang),
    "application/xhtml+xml"
  );
  spine.push(titleId);
  ncxPoints.push(ncxPoint(title, "title.xhtml"));

  let n = 0;
  for (const part of book.parts) {
    let partHref = null;
    if (part.title) {
      partHref = `part-${++n}.xhtml`;
      spine.push(add(partHref, page(part.title, `<h1 class="part">${esc(part.title)}</h1>`, lang), "application/xhtml+xml"));
    }
    const chapterLinks = [];
    const chapterPoints = [];
    for (const ch of part.chapters) {
      const href = `chapter-${++n}.xhtml`;
      const chTitle = ch.title || L.untitled;
      spine.push(add(href, page(chTitle, chapterBody(ch, L.untitled), lang), "application/xhtml+xml"));
      chapterLinks.push(`<li><a href="${href}">${esc(chTitle)}</a></li>`);
      chapterPoints.push(ncxPoint(chTitle, href));
    }
    if (part.title) {
      navItems.push(`<li><a href="${partHref}">${esc(part.title)}</a>${chapterLinks.length ? `<ol>${chapterLinks.join("")}</ol>` : ""}</li>`);
      ncxPoints.push(ncxPoint(part.title, partHref, chapterPoints.join("")));
    } else {
      navItems.push(...chapterLinks);
      ncxPoints.push(...chapterPoints);
    }
  }

  add(
    "nav.xhtml",
    page(L.contents, `<nav epub:type="toc" id="toc"><h1>${esc(L.contents)}</h1><ol>${navItems.join("")}</ol></nav>`, lang),
    "application/xhtml+xml",
    "nav"
  );
  const ncxId = add(
    "toc.ncx",
    `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${id}"/></head>
<docTitle><text>${esc(title)}</text></docTitle>
<navMap>${ncxPoints.join("")}</navMap>
</ncx>
`,
    "application/x-dtbncx+xml"
  );

  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${lang}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${id}</dc:identifier>
<dc:title>${esc(title)}</dc:title>
<dc:language>${lang}</dc:language>
${book.author ? `<dc:creator>${esc(book.author)}</dc:creator>\n` : ""}<meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest>
${manifest.join("\n")}
</manifest>
<spine toc="${ncxId}">
${spine.map((s) => `<itemref idref="${s}"/>`).join("\n")}
</spine>
</package>
`;

  return buildZip([
    { name: "mimetype", text: "application/epub+zip" },
    {
      name: "META-INF/container.xml",
      text: `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`,
    },
    { name: "OEBPS/content.opf", text: opf },
    ...files,
  ]);
}
