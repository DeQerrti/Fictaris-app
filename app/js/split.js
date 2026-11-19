import { apiGet } from "./api.js";
import { escapeHtml } from "./chips.js";
import { iconSvg } from "./icons.js";
import { i18n } from "./i18n.js";
import { toReaderText, applyInlineMarkupHtml } from "./text-format.js";
import { loadEntries } from "./sections.js";

// ══════════════════════════════════════════════
//  РАЗДЕЛЁННЫЙ ЭКРАН
//
//  Справа от Рукописи — панель с вкладками: досье персонажа, места,
//  фракции или записи своего раздела, карта, другая глава (для чтения).
//  Открывается Ctrl+щелчком по ссылке в тексте, «Открыть рядом» в её
//  меню, кнопкой «Рядом» в шапке главы. Граница двигается, ширина
//  запоминается; ✕ закрывает вкладку, последняя — всю панель. Панель
//  видна только в Рукописи: в других разделах тот же модуль занят сам.
// ══════════════════════════════════════════════

const WIDTH_KEY = "fictaris_split_width";
const MODULE_OF = { character: "characters", location: "locations", faction: "factions", entry: "section", map: "map" };
const ICON_OF = { character: "user", location: "pin", faction: "shield", entry: "folder", map: "map", chapter: "book" };

let renderers = null;
let pane = null;
let tabsEl = null;
let bodyEl = null;
let tabs = []; // { type, id }
let active = -1;
let visibleHere = false;

export function initSplit(modules) {
  renderers = modules;
  pane = document.createElement("aside");
  pane.className = "split-pane";
  pane.hidden = true;
  pane.innerHTML = `<div class="split-divider" role="separator" aria-orientation="vertical"></div><div class="split-inner"><div class="split-tabs" role="tablist"></div><div class="split-body"></div></div>`;
  tabsEl = pane.querySelector(".split-tabs");
  bodyEl = pane.querySelector(".split-body");
  document.getElementById("content").after(pane);
  try {
    const w = Number(localStorage.getItem(WIDTH_KEY));
    if (w >= 280) pane.style.width = `${w}px`;
  } catch { /* без localStorage — ширина по умолчанию */ }
  attachDivider(pane.querySelector(".split-divider"));

  document.addEventListener("fictaris:open-split", (e) => openSplit(e.detail));
  document.addEventListener("fictaris:module-opened", (e) => {
    visibleHere = e.detail.name === "manuscript";
    sync();
  });
  // Данные поменялись в другом месте (окно карточки, корзина, внешняя
  // правка) — открытая вкладка перечитывается.
  document.addEventListener("fictaris:data-replaced", () => { if (!pane.hidden) renderActive(); });
  document.addEventListener("fictaris:entity-modal-closed", () => { if (!pane.hidden) renderActive(); });
}

export function openSplit(tab) {
  if (!tab?.type) return;
  const i = tabs.findIndex((t) => t.type === tab.type && t.id === tab.id);
  if (i >= 0) active = i;
  else {
    tabs.push({ type: tab.type, id: tab.id ?? null });
    active = tabs.length - 1;
  }
  sync();
}

function close(i) {
  tabs.splice(i, 1);
  if (active >= tabs.length) active = tabs.length - 1;
  sync();
}

function sync() {
  if (!pane) return;
  pane.hidden = !visibleHere || !tabs.length;
  document.getElementById("app").classList.toggle("has-split", !pane.hidden);
  if (pane.hidden) return;
  drawTabs();
  renderActive();
}

async function titleOf(t) {
  if (t.type === "map") return i18n("Карта");
  if (t.type === "chapter") {
    const ms = await apiGet("/api/manuscript").catch(() => ({ chapters: [] }));
    return ms.chapters.find((c) => c.id === t.id)?.title || i18n("Глава");
  }
  if (t.type === "entry") return (await loadEntries()).entries.find((e) => e.id === t.id)?.name || i18n("Запись");
  const path = { character: "/api/characters", location: "/api/locations", faction: "/api/factions" }[t.type];
  const list = await apiGet(path).catch(() => []);
  return list.find((x) => x.id === t.id)?.name || i18n("Удалено из мира");
}

async function drawTabs() {
  const titles = await Promise.all(tabs.map(titleOf));
  tabsEl.innerHTML = "";
  tabs.forEach((t, i) => {
    const tab = document.createElement("div");
    tab.className = "split-tab" + (i === active ? " on" : "");
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", i === active ? "true" : "false");
    tab.innerHTML = `<button class="split-tab-name">${iconSvg(ICON_OF[t.type] || "note", 13)}<span></span></button><button class="split-tab-close" aria-label="${escapeHtml(i18n("Закрыть вкладку"))}">${iconSvg("close", 11)}</button>`;
    tab.querySelector("span").textContent = titles[i];
    tab.querySelector(".split-tab-name").addEventListener("click", () => { active = i; sync(); });
    tab.querySelector(".split-tab-close").addEventListener("click", () => close(i));
    tab.addEventListener("auxclick", (e) => { if (e.button === 1) close(i); });
    tabsEl.appendChild(tab);
  });
  const closeAll = document.createElement("button");
  closeAll.className = "split-close-all";
  closeAll.innerHTML = iconSvg("close", 13);
  closeAll.title = i18n("Закрыть панель");
  closeAll.addEventListener("click", () => { tabs = []; active = -1; sync(); });
  tabsEl.appendChild(closeAll);
}

let renderToken = 0;
async function renderActive() {
  const t = tabs[active];
  if (!t) return;
  const token = ++renderToken;
  const host = document.createElement("div");
  if (t.type === "chapter") {
    host.className = "split-chapter";
    const ms = await apiGet("/api/manuscript").catch(() => ({ chapters: [] }));
    const ch = ms.chapters.find((c) => c.id === t.id);
    if (!ch) host.innerHTML = `<p class="dossier-none">${escapeHtml(i18n("Главы уже нет."))}</p>`;
    else {
      const paras = toReaderText(ch.content).split("\n").map((line) => (line.trim() ? `<p>${applyInlineMarkupHtml(escapeHtml(line))}</p>` : "")).join("");
      host.innerHTML = `<div class="split-chapter-head"><h2></h2><span class="split-readonly">${iconSvg("eye", 12)}${escapeHtml(i18n("только чтение"))}</span><button class="btn split-goto"></button></div>${paras}`;
      host.querySelector("h2").textContent = ch.title || i18n("Без названия");
      const go = host.querySelector(".split-goto");
      go.textContent = i18n("Писать здесь");
      go.title = i18n("Открыть эту главу слева, в редакторе");
      go.addEventListener("click", () => document.dispatchEvent(new CustomEvent("fictaris:open-chapter", { detail: { id: ch.id } })));
    }
  } else {
    // entity-modal-body — разделы показывают одну страницу, без списка.
    host.className = t.type === "map" ? "split-module" : "entity-modal-body split-entity";
    const render = renderers?.[MODULE_OF[t.type]];
    if (render) await render(host, t.id || undefined);
  }
  if (token !== renderToken) return;
  bodyEl.replaceChildren(host);
}

function attachDivider(div) {
  div.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    div.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = pane.getBoundingClientRect().width;
    const move = (ev) => {
      const w = Math.max(280, Math.min(window.innerWidth * 0.7, startW + (startX - ev.clientX)));
      pane.style.width = `${w}px`;
    };
    const up = () => {
      div.removeEventListener("pointermove", move);
      div.removeEventListener("pointerup", up);
      try { localStorage.setItem(WIDTH_KEY, String(Math.round(pane.getBoundingClientRect().width))); } catch { /* не запомним */ }
    };
    div.addEventListener("pointermove", move);
    div.addEventListener("pointerup", up);
  });
  div.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const w = pane.getBoundingClientRect().width + (e.key === "ArrowLeft" ? 40 : -40);
    pane.style.width = `${Math.max(280, w)}px`;
  });
  div.tabIndex = 0;
  div.title = i18n("Потяните, чтобы поменять ширину");
}
