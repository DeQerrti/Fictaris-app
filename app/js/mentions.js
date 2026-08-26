import { escapeHtml } from "./chips.js";

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// \b в JS-регулярках — чисто ASCII-концепция и не считает кириллицу
// словообразующей, поэтому границы совпадений ломались на «Астрариум»
// внутри имени «Астра». Вместо \b — negative lookahead: совпадение не
// продолжается словообразующим символом (латиница, кириллица, цифра,
// подчёркивание) сразу после имени.
function buildMentionRegex(characters) {
  const names = characters
    .map((c) => c.name)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length) // длинные имена раньше коротких — иначе «Аста» перехватит начало «Астра»
    .map(escapeRegex);
  if (!names.length) return null;
  return new RegExp(`@(${names.join("|")})(?![A-Za-zА-Яа-яЁё0-9_])`, "g");
}

// Экранированный HTML с @упоминаниями, обёрнутыми в кликабельный span.
export function mentionsToHtml(text, characters) {
  const regex = buildMentionRegex(characters);
  if (!regex) return escapeHtml(text);

  let html = "";
  let last = 0;
  let m;
  while ((m = regex.exec(text))) {
    html += escapeHtml(text.slice(last, m.index));
    const name = m[1];
    const c = characters.find((ch) => ch.name === name);
    html += `<span class="mention" data-char-id="${c.id}" style="color:${c.color || "var(--accent)"}">@${escapeHtml(name)}</span>`;
    last = m.index + m[0].length;
  }
  html += escapeHtml(text.slice(last));
  return html;
}

// Автодополнение @упоминаний при наборе — список подсказок под полем,
// без привязки к точным координатам курсора (для этого пришлось бы
// мерить метрики шрифта символ за символом в plain textarea — не стоит
// сложности ради простого автокомплита).
export function attachMentionAutocomplete(field, getCharacters) {
  const list = document.createElement("div");
  list.className = "mention-autocomplete";
  list.style.display = "none";
  const parent = field.parentElement;
  if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
  parent.appendChild(list);

  function currentQuery() {
    const pos = field.selectionStart;
    const before = field.value.slice(0, pos);
    const m = /@([A-Za-zА-Яа-яЁё0-9_]*)$/.exec(before);
    return m ? { query: m[1], start: pos - m[1].length - 1 } : null;
  }

  function hide() {
    list.style.display = "none";
  }

  function update() {
    const q = currentQuery();
    const characters = getCharacters();
    if (!q || !characters.length) return hide();
    const matches = characters.filter((c) =>
      (c.name || "").toLowerCase().startsWith(q.query.toLowerCase())
    );
    if (!matches.length) return hide();

    list.innerHTML = "";
    for (const c of matches.slice(0, 6)) {
      const item = document.createElement("div");
      item.className = "mention-autocomplete-item";
      item.style.setProperty("--chip-color", c.color || "#7c7157");
      item.textContent = c.name;
      // mousedown, не click — иначе blur поля срабатывает раньше и список
      // успевает скрыться до того, как долетит клик.
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const pos = field.selectionStart;
        const value = field.value;
        const inserted = `@${c.name} `;
        field.value = value.slice(0, q.start) + inserted + value.slice(pos);
        const newPos = q.start + inserted.length;
        field.setSelectionRange(newPos, newPos);
        hide();
        field.dispatchEvent(new Event("input"));
        field.focus();
      });
      list.appendChild(item);
    }
    list.style.display = "block";
  }

  field.addEventListener("input", update);
  field.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
  field.addEventListener("blur", () => setTimeout(hide, 150));
}

// Hover-превью карточки при наведении на @упоминание в режиме просмотра.
// Один тултип на всё приложение, добавленный в body, — чтобы не
// обрезаться overflow:hidden/auto контейнеров рукописи и таймлайна.
let tooltipEl = null;
function ensureTooltip() {
  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.className = "mention-preview";
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

export function attachMentionHoverPreview(container, getCharacters) {
  container.addEventListener("mouseover", (e) => {
    const el = e.target.closest(".mention");
    if (!el) return;
    const c = getCharacters().find((x) => x.id === el.dataset.charId);
    if (!c) return;

    const tip = ensureTooltip();
    const initial = (c.name || "?").trim().slice(0, 1).toUpperCase();
    tip.innerHTML = `
      <div class="mention-preview-avatar" style="background:${c.color || "#7c7157"}">${escapeHtml(initial)}</div>
      <div>
        <div class="mention-preview-name">${escapeHtml(c.name || "")}</div>
        <div class="mention-preview-role">${escapeHtml(c.role || "")}</div>
      </div>
    `;
    const rect = el.getBoundingClientRect();
    tip.style.left = `${rect.left}px`;
    tip.style.top = `${rect.bottom + 6}px`;
    tip.style.display = "flex";
  });

  container.addEventListener("mouseout", (e) => {
    const leavingMention = e.target.closest(".mention");
    const enteringMention = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest(".mention");
    if (leavingMention && !enteringMention && tooltipEl) tooltipEl.style.display = "none";
  });
}
