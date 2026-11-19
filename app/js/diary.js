import { escapeHtml } from "./chips.js";
import { toReaderText } from "./text-format.js";
import { i18n, i18nPlural, currentLang } from "./i18n.js";

// ══════════════════════════════════════════════
//  ДНЕВНИК ПИСЬМА (окно Статистики)
//
//  Полгода по дням клетками (ярче — больше слов, рамка — цель дня
//  взята), рекорды, частые слова книги, в какие дни недели пишется
//  лучше, спринты. Всё считается по writing-log.json: days — сколько
//  слов было в рукописи к концу дня (writing-goal.js), sprints —
//  записи спринтов (sprint.js).
// ══════════════════════════════════════════════

const WEEKS = 26;

const pad = (n) => String(n).padStart(2, "0");
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Слова за день — прирост к прошлому записанному дню. Первый день
// журнала — не прирост, а вся рукопись на тот момент: его не считаем.
export function dailyWords(days) {
  const dates = Object.keys(days || {}).sort();
  const out = {};
  for (let i = 1; i < dates.length; i++) out[dates[i]] = Math.max(0, (days[dates[i]] || 0) - (days[dates[i - 1]] || 0));
  return out;
}

// Стоп-слова — служебные, без них список частых слов показывает то,
// на что автор действительно опирается (и любимые слова-паразиты).
const STOP = new Set(("и в во не на что с со я он она оно они по как к ко а но за то из у же от о об так все всё это эта этот эти её ее его их был была было были бы ли мне меня мой моя для до мы вы ты ни да нет уже или если когда только ещё еще над под при без про чем чём чтобы там тут где кто вот ему ей им них себя свой своей своих свою своё быть есть будет даже может сказал сказала очень тоже один одна ничего потом теперь тогда тебя тебе нам вам нас вас ним ней чего кого здесь сейчас всех весь вся всего этого этой этом том той тем того который которая которые которых которой где-то тоже лишь хотя ведь будто словно него неё нему ней нею ними сама само сами себе собой всем всеми свои своим своего своему этих этим этими тоже снова просто опять уж the and of to a in is it that was he she for on with as his her at by this but not be").split(" "));

export function frequentWords(chapters, limit = 24) {
  const freq = new Map();
  for (const ch of chapters || []) {
    const text = toReaderText(ch.content || "").toLowerCase();
    for (const w of text.match(/\p{L}[\p{L}-]{3,}/gu) || []) {
      if (STOP.has(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  return [...freq.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function fmtDate(k) {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(currentLang() === "en" ? "en" : "ru", { day: "numeric", month: "long", year: "numeric" });
}

export function buildDiarySection(log, manuscript, onFindWord) {
  const section = document.createElement("div");
  section.className = "data-section diary stats-dashboard-full";
  const words = dailyWords(log.days);
  const goal = log.dailyGoal || 0;
  const written = Object.entries(words).filter(([, n]) => n > 0);
  const total = written.reduce((s, [, n]) => s + n, 0);
  const best = written.reduce((b, x) => (x[1] > (b?.[1] || 0) ? x : b), null);
  const firstDay = Object.keys(log.days || {}).sort()[0];

  section.innerHTML = `<h3>${escapeHtml(i18n("Дневник письма"))}</h3><p>${escapeHtml(i18n("Полгода по дням: клетка ярче – больше слов, рамка – цель дня взята. Наведите на клетку – число слов."))}</p>`;

  // Клетки: столбец — неделя (пн…вс).
  const heat = document.createElement("div");
  heat.className = "diary-heat";
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - (WEEKS * 7 - 1));
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const max = Math.max(1, ...written.map(([, n]) => n));
  for (const d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const k = key(d);
    const n = words[k] || 0;
    const cell = document.createElement("i");
    if (n) cell.style.background = `color-mix(in srgb, var(--accent) ${Math.round(25 + 75 * (n / max))}%, var(--panel-alt))`;
    if (goal && n >= goal) cell.classList.add("hit");
    cell.title = `${fmtDate(k)}: ${i18nPlural(n, ["{n} слово", "{n} слова", "{n} слов"])}`;
    heat.appendChild(cell);
  }
  const heatWrap = document.createElement("div");
  heatWrap.className = "diary-heat-wrap";
  heatWrap.appendChild(heat);
  section.appendChild(heatWrap);

  // Рекорды
  const rec = document.createElement("div");
  rec.className = "diary-rec";
  const tile = (value, label) => `<div class="stat-tile"><div class="stat-tile-value">${escapeHtml(String(value))}</div><div class="stat-tile-label">${escapeHtml(label)}</div></div>`;
  rec.innerHTML =
    tile(total.toLocaleString(), i18nPlural(written.length, ["слов за {n} день письма", "слов за {n} дня письма", "слов за {n} дней письма"])) +
    tile(written.length ? Math.round(total / written.length) : 0, i18n("в среднем за день письма")) +
    tile(best ? best[1] : 0, best ? i18n("лучший день · {date}", { date: fmtDate(best[0]) }) : i18n("лучший день")) +
    tile(firstDay ? fmtDate(firstDay) : "–", i18n("с этого дня ведётся дневник"));
  section.appendChild(rec);

  const two = document.createElement("div");
  two.className = "diary-two";

  // Частые слова
  const freqBox = document.createElement("div");
  freqBox.className = "diary-card";
  freqBox.innerHTML = `<b>${escapeHtml(i18n("Частые слова в книге"))}</b>`;
  const list = document.createElement("div");
  list.className = "diary-words";
  for (const [w, n] of frequentWords(manuscript.chapters)) {
    const b = document.createElement("button");
    b.className = "diary-word";
    b.innerHTML = `${escapeHtml(w)}<em>${n}</em>`;
    b.title = i18n("Где это слово – поиск по книге");
    b.addEventListener("click", () => onFindWord?.(w));
    list.appendChild(b);
  }
  if (!list.children.length) list.innerHTML = `<span class="dossier-none">${escapeHtml(i18n("Текста пока мало."))}</span>`;
  freqBox.appendChild(list);
  const freqHint = document.createElement("div");
  freqHint.className = "diary-hint";
  freqHint.textContent = i18n("Помогает ловить любимые слова-паразиты. Щелчок – найти слово в главах.");
  freqBox.appendChild(freqHint);
  two.appendChild(freqBox);

  // Дни недели и спринты
  const weekBox = document.createElement("div");
  weekBox.className = "diary-card";
  weekBox.innerHTML = `<b>${escapeHtml(i18n("Когда пишется лучше"))}</b>`;
  const names = currentLang() === "en" ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] : ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  const sums = Array(7).fill(0);
  const counts = Array(7).fill(0);
  for (const [k, n] of written) {
    const [y, m, d] = k.split("-").map(Number);
    const wd = (new Date(y, m - 1, d).getDay() + 6) % 7;
    sums[wd] += n;
    counts[wd]++;
  }
  const avgs = sums.map((s, i) => (counts[i] ? Math.round(s / counts[i]) : 0));
  const top = Math.max(1, ...avgs);
  names.forEach((name, i) => {
    const row = document.createElement("div");
    row.className = "diary-wd";
    row.innerHTML = `<span>${name}</span><span class="diary-wd-track"><i style="width:${Math.max(2, (avgs[i] / top) * 100)}%"></i></span><span>${avgs[i]}</span>`;
    weekBox.appendChild(row);
  });
  const sprints = Array.isArray(log.sprints) ? log.sprints : [];
  const sHint = document.createElement("div");
  sHint.className = "diary-hint";
  if (sprints.length) {
    const recent = sprints.filter((s) => Date.now() - new Date(s.at).getTime() < 30 * 86400000);
    const avg = recent.length ? Math.round(recent.reduce((s, x) => s + (x.words || 0), 0) / recent.length) : 0;
    const bestS = sprints.reduce((b, x) => ((x.words || 0) > (b?.words || 0) ? x : b), null);
    sHint.textContent = i18n("Спринты: {n} за месяц, в среднем {avg} слов. Лучший – {best} слов за {min} мин.", { n: recent.length, avg, best: bestS?.words || 0, min: bestS?.minutes || 0 });
  } else {
    sHint.textContent = i18n("Спринтов пока не было – кнопка с часами в шапке главы.");
  }
  weekBox.appendChild(sHint);
  two.appendChild(weekBox);
  section.appendChild(two);
  return section;
}
