import { apiGet, apiPost } from "./api.js";
import { iconSvg } from "./icons.js";
import { wordCount } from "./stats.js";
import { loadWritingLog } from "./writing-goal.js";
import { makeDialog } from "./a11y.js";
import { i18n, i18nPlural } from "./i18n.js";

// ══════════════════════════════════════════════
//  СПРИНТ
//
//  Таймер письма: 15/25/45 минут или своё, цель по словам. Во время
//  спринта — плашка в углу (время, сколько слов прибавилось, полоска
//  цели, пауза, стоп), сайдбар и панель главы спрятаны (фокус-режим).
//  Считается чистый прирост слов во всей рукописи — удалять можно.
//  В конце — итог и запись в writing-log.json → sprints (дневник
//  письма показывает их в Статистике).
// ══════════════════════════════════════════════

let sprint = null; // { minutes, goal, startWords, leftMs, endsAt, paused, timer, el }

async function totalWords() {
  await window.__flushPendingSaves?.();
  const ms = await apiGet("/api/manuscript").catch(() => ({ chapters: [] }));
  return (ms.chapters || []).reduce((s, c) => s + wordCount(c.content), 0);
}

export function sprintRunning() {
  return !!sprint;
}

export function openSprintDialog() {
  if (sprint) return;
  let minutes = 25;
  let goal = 500;
  const backdrop = document.createElement("div");
  backdrop.className = "entity-modal-backdrop";
  const panel = document.createElement("div");
  panel.className = "entity-modal-panel sprint-dialog";
  const durations = [15, 25, 45];
  const goals = [0, 300, 500, 1000];
  panel.innerHTML = `
    <div class="sprint-sub"></div>
    <div class="sprint-row" data-r="time"></div>
    <div class="sprint-time"></div>
    <div class="sprint-row" data-r="goal"></div>
    <p class="sprint-note"></p>
    <div class="sec-new-actions"><button class="btn" data-a="cancel"></button><button class="btn primary" data-a="ok"></button></div>`;
  panel.querySelector(".sprint-note").textContent = i18n("Во время спринта прячется всё, кроме текста. Удалять можно – считается чистый прирост слов.");
  panel.querySelector('[data-a="cancel"]').textContent = i18n("Отмена");
  panel.querySelector('[data-a="ok"]').textContent = i18n("Начать");
  const paint = () => {
    panel.querySelector(".sprint-sub").textContent = goal ? i18n("Спринт · цель {n} слов", { n: goal }) : i18n("Спринт · без цели");
    panel.querySelector(".sprint-time").textContent = `${minutes}:00`;
    const time = panel.querySelector('[data-r="time"]');
    time.innerHTML = "";
    for (const m of durations) {
      const b = document.createElement("button");
      b.className = "btn" + (m === minutes ? " primary" : "");
      b.textContent = i18n("{n} мин", { n: m });
      b.addEventListener("click", () => { minutes = m; paint(); });
      time.appendChild(b);
    }
    const own = document.createElement("input");
    own.type = "number";
    own.min = "1";
    own.max = "240";
    own.className = "sec-new-input sprint-own";
    own.placeholder = i18n("своё");
    own.title = i18n("Своё время, минут");
    if (!durations.includes(minutes)) own.value = minutes;
    own.addEventListener("change", () => {
      const v = Math.round(Number(own.value));
      if (v >= 1 && v <= 240) minutes = v;
      paint();
    });
    time.appendChild(own);
    const g = panel.querySelector('[data-r="goal"]');
    g.innerHTML = "";
    for (const n of goals) {
      const b = document.createElement("button");
      b.className = "btn" + (n === goal ? " primary" : "");
      b.textContent = n ? String(n) : i18n("Без цели");
      b.addEventListener("click", () => { goal = n; paint(); });
      g.appendChild(b);
    }
  };
  paint();
  const close = () => {
    backdrop.remove();
    release();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  panel.querySelector('[data-a="cancel"]').addEventListener("click", close);
  panel.querySelector('[data-a="ok"]').addEventListener("click", async () => {
    close();
    await startSprint(minutes, goal);
  });
  backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) close(); });
  document.addEventListener("keydown", onKey);
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  const release = makeDialog(panel, i18n("Спринт"));
  panel.querySelector('[data-a="ok"]').focus();
}

async function startSprint(minutes, goal) {
  const startWords = await totalWords();
  const hadFocus = document.body.classList.contains("focus-mode");
  sprint = { minutes, goal, startWords, leftMs: minutes * 60000, endsAt: Date.now() + minutes * 60000, paused: false, words: 0, hadFocus };
  document.body.classList.add("focus-mode", "sprint-on");
  const el = document.createElement("div");
  el.className = "sprint-mini";
  el.setAttribute("role", "status");
  el.innerHTML = `${iconSvg("clock", 15)}<b class="sprint-left"></b><span class="sprint-words"></span><span class="sprint-bar"><i></i></span><button class="btn sprint-pause"></button><button class="btn sprint-stop"></button>`;
  el.querySelector(".sprint-stop").textContent = i18n("Стоп");
  el.querySelector(".sprint-pause").addEventListener("click", togglePause);
  el.querySelector(".sprint-stop").addEventListener("click", () => finish(true));
  document.body.appendChild(el);
  sprint.el = el;
  sprint.timer = setInterval(tick, 1000);
  sprint.wordsTimer = setInterval(updateWords, 4000);
  tick();
}

function togglePause() {
  if (!sprint) return;
  if (sprint.paused) {
    sprint.endsAt = Date.now() + sprint.leftMs;
    sprint.paused = false;
  } else {
    sprint.leftMs = Math.max(0, sprint.endsAt - Date.now());
    sprint.paused = true;
  }
  tick();
}

async function updateWords() {
  if (!sprint) return;
  const now = await totalWords();
  if (!sprint) return;
  sprint.words = Math.max(0, now - sprint.startWords);
  paintMini();
}

function paintMini() {
  const s = sprint;
  const left = s.paused ? s.leftMs : Math.max(0, s.endsAt - Date.now());
  const mm = Math.floor(left / 60000);
  const ss = Math.floor((left % 60000) / 1000);
  s.el.querySelector(".sprint-left").textContent = `${mm}:${String(ss).padStart(2, "0")}`;
  s.el.querySelector(".sprint-words").textContent = s.goal ? i18n("+{n} из {goal}", { n: s.words, goal: s.goal }) : i18n("+{n} слов", { n: s.words });
  s.el.querySelector(".sprint-bar i").style.width = `${s.goal ? Math.min(100, (s.words / s.goal) * 100) : Math.min(100, ((s.minutes * 60000 - left) / (s.minutes * 60000)) * 100)}%`;
  s.el.querySelector(".sprint-pause").textContent = s.paused ? i18n("Дальше") : i18n("Пауза");
  s.el.classList.toggle("paused", s.paused);
}

function tick() {
  if (!sprint) return;
  paintMini();
  if (!sprint.paused && Date.now() >= sprint.endsAt) finish(false);
}

async function finish(stopped) {
  const s = sprint;
  if (!s) return;
  clearInterval(s.timer);
  clearInterval(s.wordsTimer);
  sprint = null;
  const elapsedMs = s.minutes * 60000 - (s.paused ? s.leftMs : Math.max(0, s.endsAt - Date.now()));
  const minutes = Math.max(1, Math.round(elapsedMs / 60000));
  const words = Math.max(0, (await totalWords()) - s.startWords);
  s.el.remove();
  document.body.classList.remove("sprint-on");
  if (!s.hadFocus) document.body.classList.remove("focus-mode");

  const log = await loadWritingLog();
  const sprints = Array.isArray(log.sprints) ? log.sprints : [];
  const prevBest = sprints.reduce((b, x) => Math.max(b, x.words || 0), 0);
  if (words > 0 || !stopped) {
    sprints.push({ at: new Date().toISOString(), minutes, words, goal: s.goal || 0 });
    await apiPost("/api/writing-log", { ...log, sprints: sprints.slice(-500) }).catch(() => {});
  }

  const box = document.createElement("div");
  box.className = "sprint-done";
  box.setAttribute("role", "status");
  const hit = s.goal && words >= s.goal;
  box.innerHTML = `<b></b><span></span><button class="btn"></button>`;
  box.querySelector("b").textContent = i18nPlural(words, ["{n} слово за {min} мин", "{n} слова за {min} мин", "{n} слов за {min} мин"], { min: minutes });
  box.querySelector("span").textContent = words > prevBest && prevBest > 0
    ? i18n("Лучший спринт!")
    : hit ? i18n("Цель взята.") : s.goal ? i18n("До цели было {n}.", { n: s.goal - words }) : "";
  box.querySelector("button").textContent = i18n("Хорошо");
  box.querySelector("button").addEventListener("click", () => box.remove());
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 12000);
}

export function buildSprintButton() {
  const btn = document.createElement("button");
  btn.className = "btn icon-btn";
  btn.innerHTML = iconSvg("clock", 15);
  btn.title = i18n("Спринт – писать на время (Ctrl+Shift+S)");
  btn.setAttribute("aria-label", btn.title);
  btn.addEventListener("click", openSprintDialog);
  return btn;
}

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "KeyS" && document.querySelector(".ms-editor, .rich-editor")) {
    e.preventDefault();
    openSprintDialog();
  }
});

