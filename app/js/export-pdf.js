import { apiGet, apiPost } from "./api.js";
import { escapeHtml } from "./chips.js";
import { locationTypeInfo, factionTypeInfo } from "./icons.js";
import { loadTemplates, templateFor } from "./templates.js";
import { mentionsToLinkedHtml } from "./mentions.js";
import { imageDataUri, safeName, renderFieldsHtml, galleryHtml } from "./entity-export.js";
import { i18n } from "./i18n.js";
import { applyInlineMarkupHtml } from "./text-format.js";

// ══════════════════════════════════════════════
//  ЭКСПОРТ МИРА В PDF ("справочник мира")
//
//  Третий формат поверх уже готовых экспортов — .docx для текста книги
//  (docx.js) и .zip-сайт для мира (export-site.js). Тот же материал,
//  что и у сайта (те же поля, то же оглавление у "richtext", те же
//  ссылки по @упоминаниям — вся общая часть в entity-export.js), но
//  один документ вместо папки страниц: печатный/читаемый офлайн файл,
//  а не набор HTML, которые надо открывать по одному.
//
//  Сам PDF собирает не эта функция, а главный процесс Electron
//  (electron/main.js, POST /api/app/export-pdf → printToPDF) — здесь
//  только вёрстка одной большой HTML-страницы. Причина — в
//  electron/main.js: без движка вроде Chromium честно нарисовать
//  кириллицу в PDF с нуля не выйдет (базовые PDF-шрифты — латиница).
//  Поэтому кнопка работает только в десктопной версии — на телефоне/в
//  браузере POST /api/app/* не отвечает, exportWorldPdf сама
//  превращает это в понятную ошибку, а не зависает.
// ══════════════════════════════════════════════

const PDF_CSS = `
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Georgia", "Times New Roman", serif; color: #1a1a1a; font-size: 11pt; line-height: 1.5; }
.cover { min-height: 240mm; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; page-break-after: always; }
.cover h1 { font-size: 32pt; margin: 0 0 10px; }
.cover p { color: #555; }
h1 { font-size: 20pt; }
h2 { font-size: 15pt; margin: 0 0 2px; }
h3 { font-size: 12pt; margin: 14px 0 4px; }
h4 { font-size: 11pt; margin: 10px 0 3px; color: #444; }
section.kind { page-break-before: always; }
section.kind > h1 { border-bottom: 2px solid #999; padding-bottom: 6px; margin-bottom: 16px; }
.entity { page-break-inside: avoid; margin-bottom: 22px; padding-bottom: 14px; border-bottom: 1px solid #ddd; }
.entity-subtitle { color: #666; margin: 0 0 8px; font-style: italic; }
.avatar { width: 70px; height: 70px; object-fit: cover; border-radius: 6px; float: right; margin: 0 0 8px 12px; }
.gallery { display: flex; flex-wrap: wrap; gap: 5px; clear: both; margin: 0 0 10px; }
.gallery img { width: 50px; height: 50px; object-fit: cover; border-radius: 4px; }
.field-block { margin: 0 0 10px; clear: both; }
.field-label { font-size: 8.5pt; color: #777; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 2px; }
.field-block p { white-space: pre-wrap; margin: 0 0 6px; }
.toc { font-size: 9.5pt; color: #555; margin-bottom: 8px; }
.toc a { color: #555; margin-right: 10px; text-decoration: none; }
.toc a.sub { padding-left: 10px; }
a { color: #444; }
.card-list { margin: 0; padding-left: 18px; }
.timeline-entry { page-break-inside: avoid; margin-bottom: 14px; }
`;

function pageHtml(title, body) {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${PDF_CSS}</style>
</head>
<body>${body}</body>
</html>`;
}

export async function exportWorldPdf() {
  const [characters, locations, factions, timeline, relationships, charTemplates, locTemplates, factionTemplates, backupRes] =
    await Promise.all([
      apiGet("/api/characters"),
      apiGet("/api/locations"),
      apiGet("/api/factions"),
      apiGet("/api/timeline"),
      apiGet("/api/relationships"),
      loadTemplates("characters"),
      loadTemplates("locations"),
      loadTemplates("factions"),
      fetch("/api/export-backup"),
    ]);
  const backup = await backupRes.json();
  const images = backup.images || {};

  // В одном документе ссылки — не отдельные файлы (как у export-site.js),
  // а #якоря на тот же самый id, под которым сущность отрисована ниже.
  const anchor = (kind, id) => `#${kind}-${safeName(id)}`;
  const hrefForChar = (c) => (c ? anchor("char", c.id) : null);

  const siteTitle = i18n("Мир Fictaris");
  let body = `<div class="cover"><h1>${escapeHtml(siteTitle)}</h1><p>${escapeHtml(new Date().toLocaleDateString())}</p></div>`;

  if (characters.length) {
    body += `<section class="kind"><h1>${escapeHtml(i18n("Персонажи"))}</h1>`;
    for (const c of characters) {
      const idPrefix = `char-${safeName(c.id)}-`;
      const avatar = imageDataUri(images, c.images?.[0]);
      body += `<div class="entity" id="char-${safeName(c.id)}">`;
      body += `<h2>${escapeHtml(c.name || i18n("Без имени"))}</h2>`;
      if (c.role) body += `<p class="entity-subtitle">${escapeHtml(c.role)}</p>`;
      if (avatar) body += `<img class="avatar" src="${avatar}" alt="">`;
      body += galleryHtml(images, (c.images || []).slice(1));
      body += renderFieldsHtml(templateFor(charTemplates, c.templateId), c, characters, hrefForChar, idPrefix);

      const relRows = relationships.filter((r) => r.charA === c.id || r.charB === c.id);
      if (relRows.length) {
        body += `<div class="field-block"><div class="field-label">${escapeHtml(i18n("Связи"))}</div><ul class="card-list">`;
        for (const r of relRows) {
          const other = characters.find((ch) => ch.id === (r.charA === c.id ? r.charB : r.charA));
          if (!other) continue;
          body += `<li><a href="${anchor("char", other.id)}">${escapeHtml(other.name || i18n("Без имени"))}</a>${r.label ? ` – ${escapeHtml(r.label)}` : ""}</li>`;
        }
        body += `</ul></div>`;
      }
      body += `</div>`;
    }
    body += `</section>`;
  }

  if (locations.length) {
    body += `<section class="kind"><h1>${escapeHtml(i18n("Локации"))}</h1>`;
    for (const loc of locations) {
      const [, typeLabel] = locationTypeInfo(loc.type);
      const idPrefix = `loc-${safeName(loc.id)}-`;
      const avatar = imageDataUri(images, loc.images?.[0]);
      const parent = loc.parentId && locations.find((l) => l.id === loc.parentId);
      const kids = locations.filter((l) => l.parentId === loc.id);

      body += `<div class="entity" id="loc-${safeName(loc.id)}">`;
      body += `<h2>${escapeHtml(loc.name || i18n("Без имени"))}</h2><p class="entity-subtitle">${escapeHtml(i18n(typeLabel))}</p>`;
      if (avatar) body += `<img class="avatar" src="${avatar}" alt="">`;
      body += galleryHtml(images, (loc.images || []).slice(1));
      if (parent) {
        body += `<div class="field-block"><div class="field-label">${escapeHtml(i18n("Родительская локация"))}</div><p><a href="${anchor("loc", parent.id)}">${escapeHtml(parent.name || i18n("Без имени"))}</a></p></div>`;
      }
      body += renderFieldsHtml(templateFor(locTemplates, loc.templateId), loc, characters, hrefForChar, idPrefix);
      if (kids.length) {
        body += `<div class="field-block"><div class="field-label">${escapeHtml(i18n("Локации внутри"))}</div><ul class="card-list">`;
        for (const k of kids) body += `<li><a href="${anchor("loc", k.id)}">${escapeHtml(k.name || i18n("Без имени"))}</a></li>`;
        body += `</ul></div>`;
      }
      body += `</div>`;
    }
    body += `</section>`;
  }

  if (factions.length) {
    body += `<section class="kind"><h1>${escapeHtml(i18n("Фракции"))}</h1>`;
    for (const f of factions) {
      const [, typeLabel] = factionTypeInfo(f.type);
      const idPrefix = `faction-${safeName(f.id)}-`;
      const avatar = imageDataUri(images, f.images?.[0]);
      const leader = characters.find((c) => c.id === f.leaderId);
      const hq = locations.find((l) => l.id === f.headquartersId);

      body += `<div class="entity" id="faction-${safeName(f.id)}">`;
      body += `<h2>${escapeHtml(f.name || i18n("Без имени"))}</h2><p class="entity-subtitle">${escapeHtml(i18n(typeLabel))}</p>`;
      if (avatar) body += `<img class="avatar" src="${avatar}" alt="">`;
      body += galleryHtml(images, (f.images || []).slice(1));
      if (leader) body += `<div class="field-block"><div class="field-label">${escapeHtml(i18n("Глава фракции"))}</div><p><a href="${anchor("char", leader.id)}">${escapeHtml(leader.name || i18n("Без имени"))}</a></p></div>`;
      if (hq) body += `<div class="field-block"><div class="field-label">${escapeHtml(i18n("Штаб-квартира"))}</div><p><a href="${anchor("loc", hq.id)}">${escapeHtml(hq.name || i18n("Без имени"))}</a></p></div>`;
      body += renderFieldsHtml(templateFor(factionTemplates, f.templateId), f, characters, hrefForChar, idPrefix);
      body += `</div>`;
    }
    body += `</section>`;
  }

  if (timeline.length) {
    const rows = [...timeline].sort((a, b) => a.order - b.order);
    body += `<section class="kind"><h1>${escapeHtml(i18n("Таймлайн"))}</h1>`;
    for (const e of rows) {
      body += `<div class="timeline-entry"><h3>${escapeHtml(e.title || i18n("Без названия"))}${e.date ? ` <small>(${escapeHtml(e.date)})</small>` : ""}</h3>`;
      if (e.description) body += `<p>${mentionsToLinkedHtml(e.description, characters, hrefForChar)}</p>`;
      const tags = [];
      for (const id of e.characterIds || []) {
        const c = characters.find((ch) => ch.id === id);
        if (c) tags.push(`<a href="${anchor("char", c.id)}">${escapeHtml(c.name || i18n("Без имени"))}</a>`);
      }
      for (const id of e.locationIds || []) {
        const l = locations.find((loc) => loc.id === id);
        if (l) tags.push(`<a href="${anchor("loc", l.id)}">${escapeHtml(l.name || i18n("Без имени"))}</a>`);
      }
      if (tags.length) body += `<p>${tags.join(", ")}</p>`;
      body += `</div>`;
    }
    body += `</section>`;
  }

  const html = pageHtml(siteTitle, body);
  const res = await apiPost("/api/app/export-pdf", { html });
  if (res?.error) throw new Error(res.error);
  // На телефоне/в браузере этого маршрута не существует — мобильный
  // мост (mobile/src/main.js) отвечает на любой нераспознанный
  // /api/app/* просто {ok:true}, без ошибки и без пути к файлу. Не
  // отличить такой ответ от настоящего успеха — значит показать, что
  // PDF сохранён, хотя ничего не произошло. Настоящий успех и настоящая
  // отмена диалога сохранения (electron/main.js) всегда несут path
  // либо ok:false — только "ok:true без path" бывает исключительно от
  // такой подмены.
  if (res?.ok === true && !res.path) {
    throw new Error(i18n("Экспорт в PDF доступен только в десктопной версии Fictaris."));
  }
  return res;
}

// ══════════════════════════════════════════════
//  ЭКСПОРТ ГЛАВ РУКОПИСИ В PDF
//
//  Третий формат рядом с уже существующими .md/.docx (manuscript.js) —
//  та же пара "готовим HTML тут, печатаем в электроне" и та же проверка
//  мобильного ok:true-без-path, что и у exportWorldPdf выше, просто
//  вёрстка попроще: без справочных полей/оглавлений, только заголовок
//  и текст главы. **жирный**/*курсив* и прочие маркеры, которые
//  расставляет ПКМ в редакторе (wrapSelection), разбираются тем же
//  applyInlineMarkupHtml, что и режим "Просмотр" в самом приложении
//  (text-format.js) — иначе здесь были бы видны сырые звёздочки, хотя
//  в самом Fictaris текст уже жирный/курсивный.
// ══════════════════════════════════════════════

function chapterPdfHtml(chapters, title) {
  let body = `<div class="cover"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(new Date().toLocaleDateString())}</p></div>`;
  for (const ch of chapters) {
    body += `<section class="kind"><h1>${escapeHtml(ch.title || i18n("Без названия"))}</h1>`;
    const paragraphs = (ch.content || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    for (const p of paragraphs) body += `<p>${applyInlineMarkupHtml(escapeHtml(p).replace(/\n/g, "<br>"))}</p>`;
    body += `</section>`;
  }
  return pageHtml(title, body);
}

// title — и заголовок на обложке, и (через filename) предложенное имя
// файла в диалоге сохранения — тем же именем, что показывает "Сохранить
// в .md/.docx" рядом (см. safeFileName в manuscript.js, откуда сюда и
// приходит уже готовое безопасное имя).
export async function exportChaptersPdf(chapters, title, filename) {
  const html = chapterPdfHtml(chapters, title);
  const res = await apiPost("/api/app/export-pdf", { html, filename });
  if (res?.error) throw new Error(res.error);
  if (res?.ok === true && !res.path) {
    throw new Error(i18n("Экспорт в PDF доступен только в десктопной версии Fictaris."));
  }
  return res;
}
