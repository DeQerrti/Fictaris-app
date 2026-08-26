import { buildZip } from "./zip-writer.js";
import { i18n } from "./i18n.js";

function escapeXml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function paragraph(text, { heading = false } = {}) {
  if (!text) return "<w:p/>";
  const pPr = heading ? '<w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>' : "";
  const rPr = heading ? '<w:rPr><w:b/><w:sz w:val="32"/></w:rPr>' : "";
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

// Заметки автора не входят — та же логика, что и у экспорта в .md
// (exportMarkdown в manuscript.js): это пометки для самого пишущего.
export function buildManuscriptDocx(chapters) {
  const body = chapters
    .map((ch) => {
      const heading = paragraph(ch.title || i18n("Без названия"), { heading: true });
      const lines = (ch.content || "").split("\n").map((line) => paragraph(line));
      return heading + lines.join("");
    })
    .join('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');

  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${body}<w:sectPr/></w:body>` +
    "</w:document>";

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    "</Types>";

  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    "</Relationships>";

  const core =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${escapeXml("Fictaris — рукопись")}</dc:title>` +
    "<dc:creator>Fictaris</dc:creator>" +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>` +
    "</cp:coreProperties>";

  return buildZip([
    { name: "[Content_Types].xml", text: contentTypes },
    { name: "_rels/.rels", text: rels },
    { name: "word/document.xml", text: documentXml },
    { name: "docProps/core.xml", text: core },
  ]);
}
