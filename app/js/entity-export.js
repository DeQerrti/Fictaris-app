import { escapeHtml } from "./chips.js";
import { parseRichSections } from "./templates.js";
import { mentionsToLinkedHtml } from "./mentions.js";

// ══════════════════════════════════════════════
//  ОБЩЕЕ ДЛЯ ЭКСПОРТА МИРА (сайт + PDF)
//
//  export-site.js (архив HTML-страниц) и export-pdf.js (один PDF-
//  документ через Electron printToPDF) рисуют одни и те же поля анкеты
//  по одним и тем же правилам — оглавление у "richtext", ссылки по
//  @упоминаниям, картинки как data:-URI. Разница только в том, куда
//  ведут ссылки (отдельные файлы у сайта, #якоря внутри одного
//  документа у PDF) — это решает hrefForChar, который передаёт
//  вызывающая сторона, сама вёрстка полей — здесь, одна на двоих.
// ══════════════════════════════════════════════

const EXT_MIME = { png: "image/png", webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg" };

export function imageDataUri(images, relPath) {
  const base64 = relPath && images[relPath];
  if (!base64) return null;
  const ext = (relPath.split(".").pop() || "jpg").toLowerCase();
  return `data:${EXT_MIME[ext] || "image/jpeg"};base64,${base64}`;
}

export function safeName(id) {
  return String(id).replace(/[^\w-]/g, "_");
}

// template.fields → HTML: подпись + значение, с особым разбором для
// "richtext" (заголовки "## "/"### " → оглавление + <h3>/<h4>, см.
// templates.js/parseRichSections). idPrefix отличает #якоря одного
// поля от другого, когда несколько сущностей рисуются в одном
// документе (PDF) — без него секции с одинаковым заголовком у разных
// персонажей заняли бы один и тот же #id.
export function renderFieldsHtml(template, entity, characters, hrefForChar, idPrefix = "") {
  let html = "";
  for (const f of template?.fields || []) {
    const value = entity[f.key];
    if (!value) continue;
    if (f.type === "richtext") {
      const sections = parseRichSections(value);
      const heads = sections.filter((s) => s.level > 0);
      html += `<div class="field-block"><div class="field-label">${escapeHtml(f.label)}</div>`;
      if (heads.length > 1) {
        html += `<nav class="toc">`;
        for (const s of heads) html += `<a class="${s.level === 3 ? "sub" : ""}" href="#${idPrefix}${s.id}">${escapeHtml(s.title)}</a>`;
        html += `</nav>`;
      }
      for (const s of sections) {
        if (s.level === 2) html += `<h3 id="${idPrefix}${s.id}">${escapeHtml(s.title)}</h3>`;
        else if (s.level === 3) html += `<h4 id="${idPrefix}${s.id}">${escapeHtml(s.title)}</h4>`;
        if (s.text) html += `<p>${mentionsToLinkedHtml(s.text, characters, hrefForChar)}</p>`;
      }
      html += `</div>`;
    } else {
      html += `<div class="field-block"><div class="field-label">${escapeHtml(f.label)}</div><p>${mentionsToLinkedHtml(String(value), characters, hrefForChar)}</p></div>`;
    }
  }
  return html;
}
