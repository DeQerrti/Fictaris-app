import { blankField } from "./templates.js";
import { iconSvg } from "./icons.js";
import { i18n } from "./i18n.js";

// ══════════════════════════════════════════════
//  НОВЫЙ ШАБЛОН "НА ЛЕТУ"
//
//  Настройки → Шаблоны анкет (settings-panel.js) остаются основным
//  местом, где шаблоны заводят и правят надолго — но раньше единственным:
//  чтобы завести шаблон под новую расу, нужно было прерваться, уйти в
//  Настройки, создать его там, вернуться и только тогда заводить
//  карточку. Этот модальный редактор — сокращённый путь прямо из меню
//  выбора шаблона (template-choice.js, пункт "+ Новый шаблон…"): та же
//  идея (имя + список полей: подпись и тип), но без вкладок и выбора
//  кинда — кинд и так известен из контекста, откуда открыли создание
//  карточки.
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

// initialFields — с чего начать список (обычно поля первого имеющегося
// шаблона того же кинда, склонированные, как и "+ Шаблон" в Настройках);
// onSave({ name, fields }) — вызывается один раз при подтверждении.
export function openTemplateEditorModal({ initialFields, onSave }) {
  close();
  backdropEl = document.createElement("div");
  backdropEl.className = "entity-modal-backdrop";
  backdropEl.addEventListener("click", (e) => {
    if (e.target === backdropEl) close();
  });

  const panel = document.createElement("div");
  panel.className = "entity-modal-panel sheet-panel compact";

  const closeBtn = document.createElement("button");
  closeBtn.className = "entity-modal-close";
  closeBtn.innerHTML = "×";
  closeBtn.title = i18n("Закрыть");
  closeBtn.addEventListener("click", close);
  panel.appendChild(closeBtn);

  const body = document.createElement("div");
  body.className = "entity-modal-body sheet-body";

  const title = document.createElement("h3");
  title.textContent = i18n("Новый шаблон анкеты");
  title.style.marginTop = "0";
  body.appendChild(title);

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "tags-manage-rename-input";
  nameInput.placeholder = i18n("Название шаблона");
  nameInput.value = i18n("Новый шаблон");
  nameInput.style.marginBottom = "14px";
  body.appendChild(nameInput);

  let fields = (initialFields || []).map((f) => ({ ...f }));

  const fieldsList = document.createElement("div");
  fieldsList.className = "tags-manage-list template-fields-list";
  body.appendChild(fieldsList);

  function renderFieldRow(field) {
    const row = document.createElement("div");
    row.className = "tags-manage-row";

    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.className = "tags-manage-rename-input";
    labelInput.value = field.label;
    labelInput.addEventListener("input", () => {
      field.label = labelInput.value;
    });
    row.appendChild(labelInput);

    const typeSelect = document.createElement("select");
    typeSelect.className = "field-inline-control";
    for (const [value, label] of [
      ["input", i18n("Строка")],
      ["textarea", i18n("Текст в несколько строк")],
      ["richtext", i18n("Текст с разделами (оглавление)")],
    ]) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      if (field.type === value) opt.selected = true;
      typeSelect.appendChild(opt);
    }
    typeSelect.addEventListener("change", () => {
      field.type = typeSelect.value;
    });
    row.appendChild(typeSelect);

    const delBtn = document.createElement("button");
    delBtn.className = "btn danger shortcut-clear";
    delBtn.innerHTML = iconSvg("trash", 14);
    delBtn.addEventListener("click", () => {
      fields = fields.filter((f) => f !== field);
      row.remove();
    });
    row.appendChild(delBtn);

    fieldsList.appendChild(row);
  }

  for (const f of fields) renderFieldRow(f);

  const addFieldBtn = document.createElement("button");
  addFieldBtn.className = "btn";
  addFieldBtn.textContent = i18n("+ Поле");
  addFieldBtn.addEventListener("click", () => {
    const f = blankField();
    fields.push(f);
    renderFieldRow(f);
  });
  body.appendChild(addFieldBtn);

  const actions = document.createElement("div");
  actions.className = "drawer-actions";
  actions.style.marginTop = "18px";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn";
  cancelBtn.textContent = i18n("Отмена");
  cancelBtn.addEventListener("click", close);

  const saveBtn = document.createElement("button");
  saveBtn.className = "btn accent";
  saveBtn.textContent = i18n("Создать и завести карточку");
  saveBtn.addEventListener("click", () => {
    const name = nameInput.value.trim() || i18n("Новый шаблон");
    close();
    onSave({ name, fields });
  });

  actions.append(cancelBtn, saveBtn);
  body.appendChild(actions);

  panel.appendChild(body);
  backdropEl.appendChild(panel);
  document.body.appendChild(backdropEl);
  document.addEventListener("keydown", onKey);
  nameInput.focus();
  nameInput.select();
}
