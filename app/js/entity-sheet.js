import { iconSvg } from "./icons.js";
import { openGallery } from "./avatars.js";
import { parseRichSections } from "./templates.js";
import { i18n } from "./i18n.js";

// ══════════════════════════════════════════════
//  АНКЕТА (просмотр)
//
//  Первый уровень модалки карточки — просто просмотр красиво
//  оформленной информации, без полей ввода. Карандашик рядом
//  (или внутри, через onEdit) открывает уже настоящий редактор
//  (существующий drawer каждого модуля) — второй уровень.
// ══════════════════════════════════════════════

let backdropEl = null;

function close() {
  backdropEl?.remove();
  backdropEl = null;
  document.removeEventListener("keydown", onKey);
}

function onKey(e) {
  if (e.key === "Escape") close();
}

// fields: [{label, value}] — пустые (value falsy) пропускаются.
// extraSections: HTMLElement[] — произвольные доп.блоки (обратные связи,
// родители/дети и т.п.), вставляются после полей как есть.
// breadcrumb — необязательный готовый HTMLElement (цепочка кликабельных
// предков, для сейчас единственного случая — вложенных локаций, см.
// locations.js) — вставляется над заголовком, а не готовой строкой:
// у ссылок в цепочке свои обработчики клика (открыть анкету предка), и
// собрать их можно только вызывающей стороне, которая знает про entity.
export function openEntitySheet({ entity, avatarColor, avatarHtml, title, subtitle, fields, extraSections, breadcrumb, onEdit }) {
  close();
  backdropEl = document.createElement("div");
  backdropEl.className = "entity-modal-backdrop";
  backdropEl.addEventListener("click", (e) => {
    if (e.target === backdropEl) close();
  });

  const panel = document.createElement("div");
  panel.className = "entity-modal-panel sheet-panel";

  const closeBtn = document.createElement("button");
  closeBtn.className = "entity-modal-close";
  closeBtn.innerHTML = "×";
  closeBtn.title = i18n("Закрыть");
  closeBtn.addEventListener("click", close);
  panel.appendChild(closeBtn);

  if (onEdit) {
    const editBtn = document.createElement("button");
    editBtn.className = "btn icon-btn sheet-edit-btn";
    editBtn.innerHTML = iconSvg("pencil", 16);
    editBtn.title = i18n("Редактировать");
    editBtn.addEventListener("click", () => {
      close();
      onEdit();
    });
    panel.appendChild(editBtn);
  }

  const body = document.createElement("div");
  body.className = "entity-modal-body sheet-body";

  const header = document.createElement("div");
  header.className = "sheet-header";

  const avatar = document.createElement("div");
  avatar.className = "sheet-avatar";
  if (avatarColor) avatar.style.background = avatarColor;
  avatar.innerHTML = avatarHtml || "";
  if (Array.isArray(entity?.images) && entity.images.length) {
    avatar.style.cursor = "pointer";
    avatar.title = i18n("Открыть в полный размер");
    avatar.addEventListener("click", () => openGallery(entity.images, 0));
  }
  header.appendChild(avatar);

  const headerText = document.createElement("div");
  headerText.className = "sheet-header-text";
  if (breadcrumb) headerText.appendChild(breadcrumb);
  const titleEl = document.createElement("div");
  titleEl.className = "sheet-title";
  titleEl.textContent = title || "";
  headerText.appendChild(titleEl);
  if (subtitle) {
    const subEl = document.createElement("div");
    subEl.className = "sheet-subtitle";
    subEl.textContent = subtitle;
    headerText.appendChild(subEl);
  }
  header.appendChild(headerText);
  body.appendChild(header);

  const fieldsWrap = document.createElement("div");
  fieldsWrap.className = "sheet-fields";
  for (const f of fields || []) {
    if (!f.value) continue;
    if (f.type === "richtext") {
      fieldsWrap.appendChild(buildRichtextField(f.label, f.value));
      continue;
    }
    const row = document.createElement("div");
    row.className = "sheet-field";
    const lab = document.createElement("div");
    lab.className = "sheet-field-label";
    lab.textContent = f.label;
    const val = document.createElement("div");
    val.className = "sheet-field-value";
    val.textContent = f.value;
    row.append(lab, val);
    fieldsWrap.appendChild(row);
  }
  if (fieldsWrap.children.length) body.appendChild(fieldsWrap);

  for (const section of extraSections || []) {
    if (section) body.appendChild(section);
  }

  panel.appendChild(body);
  backdropEl.appendChild(panel);
  document.body.appendChild(backdropEl);
  document.addEventListener("keydown", onKey);
}

// Поле типа "richtext" — если в тексте нет ни одного "## "/"### ", это
// просто такое же поле, как textarea (совместимость с уже введённым
// текстом без разметки). Если заголовки есть — оглавление сверху
// (ссылки прокручивают саму панель, не всю страницу — модалка скроллится
// сама, см. .entity-modal-panel в style.css) и разделы с h4/h5 внутри.
function buildRichtextField(label, value) {
  const sections = parseRichSections(value);
  const wrap = document.createElement("div");
  wrap.className = "sheet-field sheet-richtext";

  const lab = document.createElement("div");
  lab.className = "sheet-field-label";
  lab.textContent = label;
  wrap.appendChild(lab);

  if (!sections.some((s) => s.level > 0)) {
    const val = document.createElement("div");
    val.className = "sheet-field-value";
    val.textContent = value;
    wrap.appendChild(val);
    return wrap;
  }

  const body = document.createElement("div");
  body.className = "sheet-richtext-body";

  const headings = sections.filter((s) => s.level > 0);
  if (headings.length > 1) {
    const toc = document.createElement("nav");
    toc.className = "sheet-richtext-toc";
    for (const s of headings) {
      const a = document.createElement("a");
      a.href = `#${s.id}`;
      a.textContent = s.title;
      if (s.level === 3) a.className = "sheet-toc-sub";
      a.addEventListener("click", (e) => {
        e.preventDefault();
        body.querySelector(`[data-anchor="${s.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      toc.appendChild(a);
    }
    wrap.appendChild(toc);
  }

  for (const s of sections) {
    if (s.level > 0) {
      const h = document.createElement(s.level === 2 ? "h4" : "h5");
      h.textContent = s.title;
      h.dataset.anchor = s.id;
      body.appendChild(h);
    }
    if (s.text) {
      const p = document.createElement("div");
      p.className = "sheet-field-value";
      p.textContent = s.text;
      body.appendChild(p);
    }
  }
  wrap.appendChild(body);
  return wrap;
}
