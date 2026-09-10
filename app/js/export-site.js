import { apiGet } from "./api.js";
import { escapeHtml } from "./chips.js";
import { locationTypeInfo, factionTypeInfo } from "./icons.js";
import { loadTemplates, templateFor } from "./templates.js";
import { mentionsToLinkedHtml } from "./mentions.js";
import { imageDataUri, safeName, renderFieldsHtml, galleryHtml } from "./entity-export.js";
import { i18n } from "./i18n.js";
import { buildZip } from "./zip-writer.js";

// ══════════════════════════════════════════════
//  ЭКСПОРТ МИРА КАК САЙТА
//
//  В отличие от экспорта рукописи (docx.js) — это не текст книги, а
//  сама база мира: персонажи, локации, фракции, таймлайн — со связями
//  между ними, как в вики. Результат — .zip с обычными HTML-файлами,
//  без единого байта JS: открывается двойным щелчком в любом браузере,
//  офлайн, без самого Fictaris. Ссылки между страницами — обычные
//  относительные href, оглавление внутри длинных полей ("richtext",
//  см. templates.js) — обычные #якоря, работающие без скриптов.
//
//  Картинки берём из того же /api/export-backup, которым уже
//  пользуется синхронизация (sync.js) — там уже лежит base64 каждой
//  картинки хранилища, не нужно заводить отдельный маршрут на чтение
//  файла. Встраиваем как data:-URI прямо в HTML, а не отдельными
//  файлами в архиве — buildZip (zip-writer.js) писался для .docx и умеет
//  только текстовые части, а тащить картинки бинарными файлами в этот
//  же архив значило бы его переделывать ради фичи, где можно обойтись
//  и так: base64 внутри HTML ничем не хуже отдельного файла, просто
//  сама HTML-страница весит больше.
// ══════════════════════════════════════════════

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── HTML-обвязка страницы ────────────────────────
// base — "" для index.html/timeline.html (корень архива), "../" для
// страниц внутри characters//locations//factions/ — единственное, чем
// отличаются пути до стилей и до других разделов.
function pageShell(base, siteTitle, pageTitle, bodyHtml) {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(pageTitle)} – ${escapeHtml(siteTitle)}</title>
<link rel="stylesheet" href="${base}site.css">
</head>
<body>
<header class="site-header"><a href="${base}index.html">${escapeHtml(siteTitle)}</a></header>
<main>${bodyHtml}</main>
<footer class="site-footer">${escapeHtml(i18n("Экспортировано из Fictaris"))}</footer>
</body>
</html>
`;
}

const SITE_CSS = `
:root { color-scheme: light dark; }
body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #14110d; color: #ece0c3; }
a { color: #c9944a; }
.site-header { padding: 16px 24px; border-bottom: 1px solid #3a3020; font-weight: 700; font-size: 1.1rem; }
.site-header a { color: #ece0c3; text-decoration: none; }
main { max-width: 760px; margin: 0 auto; padding: 24px; }
.site-footer { text-align: center; padding: 24px; color: #7c7157; font-size: 0.8rem; }
h1 { margin-top: 0; }
.subtitle { color: #a99977; margin: -8px 0 20px; }
.avatar { width: 96px; height: 96px; border-radius: 12px; object-fit: cover; margin-bottom: 16px; }
.gallery { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 20px; }
.gallery img { width: 96px; height: 96px; object-fit: cover; border-radius: 8px; }
.card-list { display: flex; flex-wrap: wrap; gap: 10px; list-style: none; padding: 0; margin: 0 0 24px; }
.card-list li { border: 1px solid #3a3020; border-radius: 8px; }
.card-list a { display: block; padding: 8px 14px; text-decoration: none; }
.field-block { margin: 0 0 18px; }
.field-label { font-size: 0.78rem; color: #7c7157; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 4px; }
.field-block p { white-space: pre-wrap; line-height: 1.5; margin: 0 0 8px; }
.toc { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; margin-bottom: 10px; background: #1e1912; border: 1px solid #3a3020; border-radius: 8px; }
.toc a.sub { padding-left: 16px; font-size: 0.85rem; }
section.section { margin-bottom: 32px; }
section.section h2 { border-bottom: 1px solid #3a3020; padding-bottom: 6px; }
`;

export async function exportSiteZip() {
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

  // Все три подпапки (characters/, locations/, factions/) лежат на одной
  // глубине под корнем архива — с любой из них до любой другой ведёт
  // один и тот же относительный путь "../<папка>/<id>.html".
  const charHref = (id) => (id ? `../characters/${safeName(id)}.html` : null);
  const locHref = (id) => (id ? `../locations/${safeName(id)}.html` : null);
  const hrefForChar = (c) => (c ? charHref(c.id) : null);

  const files = [];
  const siteTitle = i18n("Мир Fictaris");

  // ── Персонажи ──
  for (const c of characters) {
    const avatar = imageDataUri(images, c.images?.[0]);
    let body = `<h1>${escapeHtml(c.name || i18n("Без имени"))}</h1>`;
    if (c.role) body += `<p class="subtitle">${escapeHtml(c.role)}</p>`;
    if (avatar) body += `<img class="avatar" src="${avatar}" alt="">`;
    body += galleryHtml(images, (c.images || []).slice(1));
    body += renderFieldsHtml(templateFor(charTemplates, c.templateId), c, characters, hrefForChar);

    const relRows = relationships.filter((r) => r.charA === c.id || r.charB === c.id);
    if (relRows.length) {
      body += `<div class="field-block"><div class="field-label">${escapeHtml(i18n("Связи"))}</div><ul class="card-list">`;
      for (const r of relRows) {
        const other = characters.find((ch) => ch.id === (r.charA === c.id ? r.charB : r.charA));
        if (!other) continue;
        body += `<li><a href="${safeName(other.id)}.html">${escapeHtml(other.name || i18n("Без имени"))}${r.label ? ` – ${escapeHtml(r.label)}` : ""}</a></li>`;
      }
      body += `</ul></div>`;
    }

    files.push({ name: `characters/${safeName(c.id)}.html`, text: pageShell("../", siteTitle, c.name || i18n("Без имени"), body) });
  }

  // ── Локации ──
  for (const loc of locations) {
    const [, typeLabel] = locationTypeInfo(loc.type);
    const avatar = imageDataUri(images, loc.images?.[0]);
    let body = `<h1>${escapeHtml(loc.name || i18n("Без имени"))}</h1><p class="subtitle">${escapeHtml(i18n(typeLabel))}</p>`;
    if (avatar) body += `<img class="avatar" src="${avatar}" alt="">`;
    body += galleryHtml(images, (loc.images || []).slice(1));

    const parent = loc.parentId && locations.find((l) => l.id === loc.parentId);
    if (parent) {
      body += `<div class="field-block"><div class="field-label">${escapeHtml(i18n("Родительская локация"))}</div><p><a href="${safeName(parent.id)}.html">${escapeHtml(parent.name || i18n("Без имени"))}</a></p></div>`;
    }

    body += renderFieldsHtml(templateFor(locTemplates, loc.templateId), loc, characters, hrefForChar);

    const kids = locations.filter((l) => l.parentId === loc.id);
    if (kids.length) {
      body += `<div class="field-block"><div class="field-label">${escapeHtml(i18n("Локации внутри"))}</div><ul class="card-list">`;
      for (const k of kids) body += `<li><a href="${safeName(k.id)}.html">${escapeHtml(k.name || i18n("Без имени"))}</a></li>`;
      body += `</ul></div>`;
    }

    files.push({ name: `locations/${safeName(loc.id)}.html`, text: pageShell("../", siteTitle, loc.name || i18n("Без имени"), body) });
  }

  // ── Фракции ──
  for (const f of factions) {
    const [, typeLabel] = factionTypeInfo(f.type);
    const avatar = imageDataUri(images, f.images?.[0]);
    const leader = characters.find((c) => c.id === f.leaderId);
    const hq = locations.find((l) => l.id === f.headquartersId);
    let body = `<h1>${escapeHtml(f.name || i18n("Без имени"))}</h1><p class="subtitle">${escapeHtml(i18n(typeLabel))}</p>`;
    if (avatar) body += `<img class="avatar" src="${avatar}" alt="">`;
    body += galleryHtml(images, (f.images || []).slice(1));
    if (leader) body += `<div class="field-block"><div class="field-label">${escapeHtml(i18n("Глава фракции"))}</div><p><a href="${charHref(leader.id)}">${escapeHtml(leader.name || i18n("Без имени"))}</a></p></div>`;
    if (hq) body += `<div class="field-block"><div class="field-label">${escapeHtml(i18n("Штаб-квартира"))}</div><p><a href="${locHref(hq.id)}">${escapeHtml(hq.name || i18n("Без имени"))}</a></p></div>`;
    body += renderFieldsHtml(templateFor(factionTemplates, f.templateId), f, characters, hrefForChar);

    files.push({ name: `factions/${safeName(f.id)}.html`, text: pageShell("../", siteTitle, f.name || i18n("Без имени"), body) });
  }

  // ── Таймлайн ──
  {
    const rows = [...timeline].sort((a, b) => a.order - b.order);
    let body = `<h1>${escapeHtml(i18n("Таймлайн"))}</h1>`;
    for (const e of rows) {
      body += `<section class="section"><h2>${escapeHtml(e.title || i18n("Без названия"))}${e.date ? ` <small>(${escapeHtml(e.date)})</small>` : ""}</h2>`;
      if (e.description) body += `<p>${mentionsToLinkedHtml(e.description, characters, (c) => (c ? `characters/${safeName(c.id)}.html` : null))}</p>`;
      const tags = [];
      for (const id of e.characterIds || []) {
        const c = characters.find((ch) => ch.id === id);
        if (c) tags.push(`<a href="characters/${safeName(c.id)}.html">${escapeHtml(c.name || i18n("Без имени"))}</a>`);
      }
      for (const id of e.locationIds || []) {
        const l = locations.find((loc) => loc.id === id);
        if (l) tags.push(`<a href="locations/${safeName(l.id)}.html">${escapeHtml(l.name || i18n("Без имени"))}</a>`);
      }
      if (tags.length) body += `<p>${tags.join(", ")}</p>`;
      body += `</section>`;
    }
    files.push({ name: `timeline.html`, text: pageShell("", siteTitle, i18n("Таймлайн"), body) });
  }

  // ── Индекс ──
  {
    function list(entities, kind) {
      if (!entities.length) return "";
      let html = `<ul class="card-list">`;
      for (const e of entities) html += `<li><a href="${kind}/${safeName(e.id)}.html">${escapeHtml(e.name || i18n("Без имени"))}</a></li>`;
      return html + `</ul>`;
    }
    let body = `<h1>${escapeHtml(i18n("Мир Fictaris"))}</h1>`;
    body += `<section class="section"><h2>${escapeHtml(i18n("Персонажи"))}</h2>${list(characters, "characters")}</section>`;
    body += `<section class="section"><h2>${escapeHtml(i18n("Локации"))}</h2>${list(locations.filter((l) => !l.parentId), "locations")}</section>`;
    body += `<section class="section"><h2>${escapeHtml(i18n("Фракции"))}</h2>${list(factions, "factions")}</section>`;
    body += `<p><a href="timeline.html">${escapeHtml(i18n("Таймлайн"))} →</a></p>`;
    files.push({ name: `index.html`, text: pageShell("", siteTitle, i18n("Обзор"), body) });
  }

  files.push({ name: "site.css", text: SITE_CSS });

  const zipBytes = buildZip(files);
  downloadBlob(new Blob([zipBytes], { type: "application/zip" }), `fictaris-site-${new Date().toISOString().slice(0, 10)}.zip`);
}
