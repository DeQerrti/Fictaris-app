import { iconSvg } from "./icons.js";
import { openGallery } from "./avatars.js";
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
export function openEntitySheet({ entity, avatarColor, avatarHtml, title, subtitle, fields, extraSections, onEdit }) {
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
