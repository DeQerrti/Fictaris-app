import { uid } from "./api.js";
import { escapeHtml } from "./chips.js";
import { iconSvg } from "./icons.js";
import { openPopover, closeMenu } from "./context-menu.js";
import { toReaderText, applyInlineMarkupHtml } from "./text-format.js";
import { i18n, i18nPlural, currentLang } from "./i18n.js";

// ══════════════════════════════════════════════
//  КОММЕНТАРИИ К ТЕКСТУ И ОТЗЫВЫ
//
//  Комментарий привязан к фрагменту главы метками в тексте:
//  «[[c:<id>]]фрагмент[[/c]]» (в пределах абзаца). Сам разговор —
//  chapter.comments = [{ id, text, author, at, resolved?, quote, replies:
//  [{ text, author, at }] }]. Метки не видны ни в редакторе (там —
//  подсветка), ни в экспорте (toReaderText).
//
//  Бета-ридерам без сервера: «Читательский экземпляр» — один HTML-файл
//  (открывается в любом браузере, без интернета), где читатель выделяет
//  текст и пишет замечание; «Сохранить отзыв» даёт маленький файл .json,
//  который он присылает как угодно, а «Импорт отзыва» раскладывает
//  замечания по местам. То же — из .docx с комментариями Word.
// ══════════════════════════════════════════════

export const COMMENT_START_RE = /\[\[c:([\w-]+)\]\]/g;
export const COMMENT_END = "[[/c]]";

export function commentIdsIn(text) {
  return new Set([...String(text || "").matchAll(COMMENT_START_RE)].map((m) => m[1]));
}

export function removeCommentMarks(text, id) {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Метка конца — первая после метки начала в той же строке.
  return String(text || "").replace(new RegExp(`\\[\\[c:${esc}\\]\\]([^\\n]*?)\\[\\[\\/c\\]\\]`, "g"), "$1").replace(new RegExp(`\\[\\[c:${esc}\\]\\]`, "g"), "");
}

// ── Привязка цитаты к абзацу ──
// Видимый текст строки (как его видит читатель) и где каждый его символ
// лежит в строке с разметкой. Упоминания и ссылки — целиком.
function visibleMap(line) {
  const token = /\*\*|~~|==|<\/?u>|\[\[(?:place|faction|entry):[\w-]+\|([^\]\n]*)\]\]|\[\[note:[\w-]+\]\]|\[\[c:[\w-]+\]\]|\[\[\/c\]\]|@\[[^|\]\n]+\|([^\]\n]+)\]|\*/g;
  let vis = "";
  const starts = [];
  const ends = [];
  let i = 0;
  let m;
  const push = (text, s, e) => {
    for (let k = 0; k < text.length; k++) {
      // «@Имя» — собачка не видна читателю.
      if (text[k] === "@" && text.length === e - s && /\p{L}/u.test(text[k + 1] || "")) continue;
      vis += text[k];
      starts.push(text.length === e - s ? s + k : s);
      ends.push(text.length === e - s ? s + k + 1 : e);
    }
  };
  while ((m = token.exec(line))) {
    if (m.index > i) push(line.slice(i, m.index), i, m.index);
    const shown = m[1] ?? m[2];
    if (shown !== undefined) push(shown, m.index, m.index + m[0].length);
    i = m.index + m[0].length;
  }
  if (i < line.length) push(line.slice(i), i, line.length);
  return { vis, starts, ends };
}

function normalize(s) {
  return String(s || "").replace(/\s+/g, " ").replace(/[«»"„“”]/g, '"').replace(/[–—]/g, "-").trim();
}

// Где в строке с разметкой лежит цитата: { start, end } или null.
export function findQuote(line, quote) {
  const q = normalize(quote);
  if (!q) return null;
  const { vis, starts, ends } = visibleMap(line);
  // Кавычки и тире — к одному виду той же длины: индексы не сдвигаются.
  const plain = vis.replace(/[«»"„“”]/g, '"').replace(/[–—]/g, "-");
  let at = plain.indexOf(q);
  let len = q.length;
  if (at < 0) {
    const loose = plain.replace(/\s/g, " ");
    at = loose.toLowerCase().indexOf(q.toLowerCase());
  }
  if (at < 0) {
    // Не нашлась целиком — самое длинное слово цитаты.
    const word = q.split(" ").sort((a, b) => b.length - a.length)[0];
    if (!word || word.length < 4) return null;
    at = plain.toLowerCase().indexOf(word.toLowerCase());
    len = word.length;
    if (at < 0) return null;
  }
  return { start: starts[at], end: ends[at + len - 1] };
}

// Добавить комментарий к абзацу lineIndex главы по цитате. Возвращает
// true, если удалось привязать к тексту (иначе он в списке без места).
export function addAnchoredComment(chapter, lineIndex, quote, comment) {
  const lines = String(chapter.content || "").split("\n");
  let anchored = false;
  const tryLine = (i) => {
    const pos = findQuote(lines[i] || "", quote);
    if (!pos) return false;
    const line = lines[i];
    lines[i] = `${line.slice(0, pos.start)}[[c:${comment.id}]]${line.slice(pos.start, pos.end)}${COMMENT_END}${line.slice(pos.end)}`;
    return true;
  };
  if (lineIndex != null && lineIndex >= 0 && lineIndex < lines.length) anchored = tryLine(lineIndex);
  // Абзацы могли сдвинуться после отправки книги — ищем по всей главе.
  for (let i = 0; !anchored && i < lines.length; i++) anchored = tryLine(i);
  chapter.content = lines.join("\n");
  chapter.comments = [...(chapter.comments || []), { ...comment, quote: quote || comment.quote || "" }];
  return anchored;
}

const fmtTime = (iso) => {
  try {
    return new Date(iso).toLocaleString(currentLang() === "en" ? "en" : "ru", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
};

const AUTHOR_KEY = "fictaris_comment_author";
function myName() {
  try {
    return localStorage.getItem(AUTHOR_KEY) || i18n("Автор");
  } catch {
    return i18n("Автор");
  }
}

// ── Окно разговора ──
// onChange(kind) — "text" (поменялись метки в тексте главы) или "data".
export function openCommentThread(x, y, chapter, id, { onChange, onRemoveMarks, isNew = false }) {
  const c = (chapter.comments || []).find((x) => x.id === id);
  if (!c) return;
  const box = document.createElement("div");
  box.className = "cm-thread";
  const paint = () => {
    box.innerHTML = "";
    if (c.quote) {
      const q = document.createElement("div");
      q.className = "cm-quote";
      q.textContent = `«${c.quote.length > 140 ? c.quote.slice(0, 139) + "…" : c.quote}»`;
      box.appendChild(q);
    }
    const msgs = [{ text: c.text, author: c.author, at: c.at, main: true }, ...(c.replies || [])];
    for (const m of msgs) {
      if (!m.text && m.main) continue;
      const row = document.createElement("div");
      row.className = "cm-msg";
      row.innerHTML = `<div class="cm-msg-head"><b></b><span></span></div><div class="cm-msg-text"></div>`;
      row.querySelector("b").textContent = m.author || i18n("Без имени");
      row.querySelector("span").textContent = fmtTime(m.at);
      row.querySelector(".cm-msg-text").textContent = m.text;
      box.appendChild(row);
    }
    const input = document.createElement("textarea");
    input.className = "sec-new-input cm-input";
    input.rows = 2;
    input.placeholder = c.text ? i18n("Ответить…") : i18n("Комментарий к выделенному…");
    box.appendChild(input);
    const actions = document.createElement("div");
    actions.className = "cm-actions";
    const send = document.createElement("button");
    send.className = "btn primary";
    send.textContent = c.text ? i18n("Ответить") : i18n("Сохранить");
    const post = () => {
      const text = input.value.trim();
      if (!text) return;
      const msg = { text, author: myName(), at: new Date().toISOString() };
      if (!c.text) Object.assign(c, msg);
      else c.replies = [...(c.replies || []), msg];
      onChange("data");
      paint();
    };
    send.addEventListener("click", post);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) post();
    });
    const resolve = document.createElement("button");
    resolve.className = "btn";
    resolve.textContent = c.resolved ? i18n("Открыть снова") : i18n("Решено");
    resolve.title = c.resolved ? "" : i18n("Подсветка в тексте уйдёт, разговор останется в списке");
    resolve.addEventListener("click", () => {
      c.resolved = !c.resolved;
      onChange("data");
      closeMenu();
    });
    const del = document.createElement("button");
    del.className = "btn danger";
    del.innerHTML = iconSvg("trash", 13);
    del.title = i18n("Удалить комментарий");
    del.addEventListener("click", () => {
      if (del.dataset.confirm !== "1" && (c.replies || []).length) {
        del.dataset.confirm = "1";
        del.textContent = i18n("Точно?");
        return;
      }
      chapter.comments = (chapter.comments || []).filter((x) => x.id !== c.id);
      onRemoveMarks(c.id);
      closeMenu();
    });
    if (c.text) actions.append(resolve);
    actions.append(del, send);
    box.appendChild(actions);
    if (isNew || !c.text) requestAnimationFrame(() => input.focus());
  };
  paint();
  openPopover(x, y, box, "cm-pop");
  // Новый и не дописанный — убрать при закрытии, чтобы не висела пустая подсветка.
  if (isNew) {
    const watch = setInterval(() => {
      if (box.isConnected) return;
      clearInterval(watch);
      if (!c.text) {
        chapter.comments = (chapter.comments || []).filter((x) => x.id !== c.id);
        onRemoveMarks(c.id);
      }
    }, 300);
  }
}

export function newComment(quote) {
  return { id: uid(), text: "", author: myName(), at: new Date().toISOString(), quote: quote || "", replies: [] };
}

// ── Раздел «Комментарии» в панели главы ──
export function buildCommentsList(chapter, { onOpen }) {
  const box = document.createElement("div");
  box.className = "cm-list";
  const list = chapter.comments || [];
  const inText = commentIdsIn(chapter.content);
  if (!list.length) {
    box.innerHTML = `<div class="hint-text">${escapeHtml(i18n("Выделите текст → правая кнопка → «Комментарий…». Отзывы бета-ридеров – меню книги → «Импорт отзыва…»."))}</div>`;
    return box;
  }
  const sorted = [...list].sort((a, b) => Number(!!a.resolved) - Number(!!b.resolved));
  for (const c of sorted) {
    const row = document.createElement("button");
    row.className = "cm-row" + (c.resolved ? " resolved" : "") + (inText.has(c.id) ? "" : " loose");
    const replies = (c.replies || []).length;
    row.innerHTML = `<span class="cm-row-head"><b></b><i></i></span><span class="cm-row-text"></span><span class="cm-row-quote"></span>`;
    row.querySelector("b").textContent = c.author || i18n("Без имени");
    row.querySelector("i").textContent = [c.resolved ? i18n("решено") : "", replies ? i18nPlural(replies, ["{n} ответ", "{n} ответа", "{n} ответов"]) : "", inText.has(c.id) ? "" : i18n("без места в тексте")].filter(Boolean).join(" · ");
    row.querySelector(".cm-row-text").textContent = c.text || i18n("(пусто)");
    row.querySelector(".cm-row-quote").textContent = c.quote ? `«${c.quote.slice(0, 80)}»` : "";
    row.addEventListener("click", () => onOpen(c.id, row.getBoundingClientRect()));
    box.appendChild(row);
  }
  return box;
}

// ══════════════════════════════════════════════
//  ЧИТАТЕЛЬСКИЙ ЭКЗЕМПЛЯР
// ══════════════════════════════════════════════
export function buildReaderCopyHtml({ title, author, parts, bookId }) {
  const L = {
    name: i18n("Ваше имя"),
    hint: i18n("Выделите фрагмент текста – появится кнопка «Комментировать». Замечания сохраняются в этом браузере. Когда закончите – «Сохранить отзыв» и пришлите файл автору."),
    comment: i18n("Комментировать"),
    save: i18n("Сохранить отзыв"),
    list: i18n("Ваши замечания"),
    none: i18n("Пока нет замечаний."),
    placeholder: i18n("Что здесь не так или что понравилось?"),
    ok: i18n("Добавить"),
    cancel: i18n("Отмена"),
    del: i18n("Удалить"),
    contents: i18n("Содержание"),
    untitled: i18n("Без названия"),
    needName: i18n("Напишите своё имя вверху – автор увидит, чьи это замечания."),
  };
  let toc = "";
  let body = "";
  for (const part of parts) {
    if (part.title) body += `<h2 class="part">${escapeHtml(part.title)}</h2>`;
    for (const ch of part.chapters) {
      toc += `<li><a href="#ch-${escapeHtml(ch.id)}">${escapeHtml(ch.title || L.untitled)}</a></li>`;
      body += `<section class="chapter" id="ch-${escapeHtml(ch.id)}"><h3>${escapeHtml(ch.title || L.untitled)}</h3>`;
      toReaderText(ch.content).split("\n").forEach((line, i) => {
        if (line.trim()) body += `<p data-ch="${escapeHtml(ch.id)}" data-p="${i}">${applyInlineMarkupHtml(escapeHtml(line))}</p>`;
      });
      body += `</section>`;
    }
  }
  const meta = JSON.stringify({ format: "fictaris-feedback", version: 1, bookId: bookId || null, title, L }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="${currentLang() === "en" ? "en" : "ru"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#f6f0e4;--text:#2b2013;--dim:#6b5b40;--acc:#8a5129;--card:#fffaf0;--line:#d9c9a6}
@media (prefers-color-scheme:dark){:root{--bg:#17130e;--text:#ece0c3;--dim:#a99977;--acc:#dba760;--card:#221c14;--line:#3a3020}}
body{margin:0;background:var(--bg);color:var(--text);font:18px/1.7 Georgia,serif}
header{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:10px 18px;background:var(--card);border-bottom:1px solid var(--line);font:14px system-ui,sans-serif}
header b{font-size:15px;margin-right:auto}
header input{padding:6px 10px;border:1px solid var(--line);border-radius:7px;background:var(--bg);color:var(--text);font:inherit}
button{font:14px system-ui,sans-serif;padding:6px 12px;border-radius:7px;border:1px solid var(--line);background:var(--bg);color:var(--text);cursor:pointer}
button.acc{background:var(--acc);border-color:var(--acc);color:#fff}
main{max-width:680px;margin:0 auto;padding:24px 20px 120px}
.hint{font:13px/1.5 system-ui,sans-serif;color:var(--dim);border:1px dashed var(--line);border-radius:10px;padding:10px 14px}
h1{font-size:30px;margin:28px 0 4px}.author{color:var(--dim);margin:0 0 20px}
.toc{font:15px/1.8 system-ui,sans-serif}h2.part{margin-top:48px;text-transform:uppercase;letter-spacing:.06em;font-size:15px;color:var(--acc)}
h3{margin-top:40px}p{margin:0 0 .8em;text-indent:1.4em}
mark.c{background:color-mix(in srgb,var(--acc) 25%,transparent);color:inherit;border-bottom:2px solid var(--acc);cursor:pointer}
#fly{position:absolute;display:none;z-index:6}
#box{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);width:min(520px,92vw);display:none;z-index:7;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;box-shadow:0 10px 40px #0005;font:14px system-ui,sans-serif}
#box textarea{width:100%;box-sizing:border-box;min-height:70px;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text);font:inherit}
#box .q{color:var(--dim);margin-bottom:6px;font-style:italic}#box .row{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}
#list{font:14px/1.5 system-ui,sans-serif;margin-top:60px;border-top:1px solid var(--line);padding-top:12px}
#list .it{border:1px solid var(--line);border-radius:10px;padding:8px 12px;margin:8px 0;background:var(--card)}#list .it i{color:var(--dim)}
</style></head><body>
<header><b>${escapeHtml(title)}</b><input id="who" placeholder="${escapeHtml(L.name)}"><button class="acc" id="save">${escapeHtml(L.save)}</button></header>
<main><p class="hint">${escapeHtml(L.hint)}</p>
<h1>${escapeHtml(title)}</h1>${author ? `<p class="author">${escapeHtml(author)}</p>` : ""}
<nav class="toc"><b>${escapeHtml(L.contents)}</b><ol>${toc}</ol></nav>
${body}
<div id="list"></div></main>
<button id="fly" class="acc">${escapeHtml(L.comment)}</button>
<div id="box"><div class="q"></div><textarea></textarea><div class="row"><button id="cancel">${escapeHtml(L.cancel)}</button><button class="acc" id="ok">${escapeHtml(L.ok)}</button></div></div>
<script type="application/json" id="meta">${meta}</script>
<script>
(function(){
var META=JSON.parse(document.getElementById("meta").textContent),L=META.L,KEY="fictaris-feedback:"+(META.bookId||META.title);
var state;try{state=JSON.parse(localStorage.getItem(KEY))||{}}catch(e){state={}}
state.comments=state.comments||[];var who=document.getElementById("who");who.value=state.reader||"";
function store(){try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){}}
who.addEventListener("input",function(){state.reader=who.value;store()});
var fly=document.getElementById("fly"),box=document.getElementById("box"),pending=null;
function para(n){while(n&&!(n.nodeType===1&&n.dataset&&n.dataset.p!==undefined))n=n.parentNode;return n}
document.addEventListener("mouseup",function(e){setTimeout(function(){
 if(box.contains(e.target))return;var s=window.getSelection();if(!s.rangeCount||s.isCollapsed){fly.style.display="none";return}
 var r=s.getRangeAt(0),a=para(r.startContainer),b=para(r.endContainer);if(!a||a!==b){fly.style.display="none";return}
 var q=s.toString().replace(/\\s+/g," ").trim();if(!q){fly.style.display="none";return}
 var rect=r.getBoundingClientRect();pending={ch:a.dataset.ch,p:+a.dataset.p,quote:q};
 fly.style.left=(window.scrollX+rect.left)+"px";fly.style.top=(window.scrollY+rect.bottom+6)+"px";fly.style.display="block"},10)});
fly.addEventListener("click",function(){fly.style.display="none";box.querySelector(".q").textContent="\\u00ab"+pending.quote.slice(0,160)+"\\u00bb";box.querySelector("textarea").value="";box.style.display="block";box.querySelector("textarea").focus()});
document.getElementById("cancel").addEventListener("click",function(){box.style.display="none"});
document.getElementById("ok").addEventListener("click",function(){var t=box.querySelector("textarea").value.trim();if(!t||!pending)return;
 state.comments.push({chapterId:pending.ch,para:pending.p,quote:pending.quote,text:t,at:new Date().toISOString()});store();box.style.display="none";paint()});
function paint(){var list=document.getElementById("list");list.innerHTML="<b>"+L.list+"</b>";
 if(!state.comments.length){list.insertAdjacentHTML("beforeend","<p>"+L.none+"</p>")}
 state.comments.forEach(function(c,i){var d=document.createElement("div");d.className="it";var q=document.createElement("i");q.textContent="\\u00ab"+c.quote.slice(0,100)+"\\u00bb";
  var t=document.createElement("div");t.textContent=c.text;var x=document.createElement("button");x.textContent=L.del;x.addEventListener("click",function(){state.comments.splice(i,1);store();paint()});
  d.appendChild(q);d.appendChild(t);d.appendChild(x);list.appendChild(d)});}
paint();
document.getElementById("save").addEventListener("click",function(){
 if(!who.value.trim()){alert(L.needName);who.focus();return}
 var data={format:"fictaris-feedback",version:1,bookId:META.bookId,title:META.title,reader:who.value.trim(),savedAt:new Date().toISOString(),comments:state.comments};
 var a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));
 a.download=(META.title+" – "+who.value.trim()).replace(/[\\\\/:*?"<>|]+/g," ")+".json";document.body.appendChild(a);a.click();a.remove()});
})();
</script></body></html>`;
}

// ── Импорт отзыва ──
// Отзыв из читательского экземпляра: { format: "fictaris-feedback", reader, comments: [{ chapterId, para, quote, text, at }] }.
export function importFeedback(data, manuscript) {
  if (!data || data.format !== "fictaris-feedback" || !Array.isArray(data.comments)) throw new Error(i18n("Это не файл отзыва Fictaris."));
  let anchored = 0;
  let loose = 0;
  let missing = 0;
  for (const c of data.comments) {
    const ch = manuscript.chapters.find((x) => x.id === c.chapterId);
    if (!ch || typeof c.text !== "string" || !c.text.trim()) { missing++; continue; }
    const ok = addAnchoredComment(ch, Number(c.para), String(c.quote || ""), { id: uid(), text: c.text.trim().slice(0, 4000), author: String(data.reader || i18n("Читатель")).slice(0, 80), at: c.at || new Date().toISOString(), replies: [] });
    if (ok) anchored++;
    else loose++;
  }
  return { anchored, loose, missing };
}

// ── Комментарии Word (.docx) ──
// Читатель открыл наш .docx (экспорт книги), оставил комментарии в Word
// или Google Документах и прислал файл обратно. Главы узнаём по
// заголовкам — абзац с названием главы, дальше абзацы по порядку.
async function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(i18n("Это не файл .docx."));
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    files[name] = { method, size, local };
    p += 46 + nameLen + extraLen + commentLen;
  }
  const read = async (name) => {
    const f = files[name];
    if (!f) return null;
    const lNameLen = view.getUint16(f.local + 26, true);
    const lExtra = view.getUint16(f.local + 28, true);
    const start = f.local + 30 + lNameLen + lExtra;
    const raw = bytes.subarray(start, start + f.size);
    if (f.method === 0) return new TextDecoder().decode(raw);
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream).text();
  };
  return read;
}

export async function importDocxComments(bytes, chapters, reader) {
  const read = await unzip(bytes);
  const [docXml, commentsXml] = await Promise.all([read("word/document.xml"), read("word/comments.xml")]);
  if (!docXml) throw new Error(i18n("Это не файл .docx."));
  if (!commentsXml) return { anchored: 0, loose: 0, missing: 0, none: true };
  const parser = new DOMParser();
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const cdoc = parser.parseFromString(commentsXml, "application/xml");
  const texts = {};
  for (const c of cdoc.getElementsByTagNameNS(W, "comment")) {
    const id = c.getAttributeNS(W, "id") ?? c.getAttribute("w:id");
    texts[id] = {
      text: [...c.getElementsByTagNameNS(W, "p")].map((p) => [...p.getElementsByTagNameNS(W, "t")].map((t) => t.textContent).join("")).join("\n").trim(),
      author: c.getAttributeNS(W, "author") ?? c.getAttribute("w:author") ?? reader,
      at: c.getAttributeNS(W, "date") ?? c.getAttribute("w:date") ?? new Date().toISOString(),
    };
  }
  const ddoc = parser.parseFromString(docXml, "application/xml");
  const byTitle = new Map(chapters.map((ch) => [normalize(ch.title || ""), ch]));
  let current = null;
  let lineIndex = -1;
  const open = new Map(); // id → { ch, line, quote }
  const found = [];
  for (const p of ddoc.getElementsByTagNameNS(W, "p")) {
    const text = [...p.getElementsByTagNameNS(W, "t")].map((t) => t.textContent).join("");
    const asTitle = byTitle.get(normalize(text));
    if (asTitle) { current = asTitle; lineIndex = -1; continue; }
    lineIndex++;
    // Обходим узлы абзаца по порядку: начало и конец диапазона комментария и текст.
    const walker = ddoc.createTreeWalker(p, NodeFilter.SHOW_ELEMENT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.namespaceURI !== W) continue;
      const id = n.getAttributeNS(W, "id") ?? n.getAttribute("w:id");
      if (n.localName === "commentRangeStart") open.set(id, { ch: current, line: lineIndex, quote: "" });
      else if (n.localName === "commentRangeEnd") {
        const o = open.get(id);
        if (o) { found.push({ id, ...o }); open.delete(id); }
      } else if (n.localName === "t") for (const o of open.values()) o.quote += n.textContent;
    }
  }
  let anchored = 0;
  let loose = 0;
  let missing = 0;
  for (const f of found) {
    const t = texts[f.id];
    if (!t || !t.text) continue;
    if (!f.ch) { missing++; continue; }
    const ok = addAnchoredComment(f.ch, f.line, f.quote, { id: uid(), text: t.text.slice(0, 4000), author: String(t.author || reader || i18n("Читатель")).slice(0, 80), at: t.at, replies: [] });
    if (ok) anchored++;
    else loose++;
  }
  return { anchored, loose, missing };
}
