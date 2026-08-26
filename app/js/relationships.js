import { apiGet, apiPost, uid } from "./api.js";
import { debounceSave } from "./save-badge.js";
import { escapeHtml, characterSelect } from "./chips.js";

let characters = [];
let relationships = [];
let container = null;
const save = debounceSave((list) => apiPost("/api/relationships", list));

function persist() {
  save(relationships);
}

function charById(id) {
  return characters.find((c) => c.id === id);
}

// -100 (вражда, красный) → 0 (нейтрально, серый) → +100 (союз, зелёный)
function scoreColor(score) {
  const t = Math.max(-100, Math.min(100, Number(score) || 0)) / 100;
  const neg = [0xa4, 0x48, 0x3c];
  const mid = [0x7c, 0x71, 0x57];
  const pos = [0x5a, 0x8a, 0x5f];
  const [a, b] = t < 0 ? [neg, mid] : [mid, pos];
  const k = Math.abs(t);
  const mix = a.map((v, i) => Math.round(v + (b[i] - v) * k));
  return `rgb(${mix.join(",")})`;
}

export async function renderRelationships(root) {
  container = root;
  [characters, relationships] = await Promise.all([
    apiGet("/api/characters"),
    apiGet("/api/relationships"),
  ]);
  draw();
}

function draw() {
  container.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.style.cssText = "flex:1;overflow-y:auto;padding:24px;display:flex;flex-direction:column;gap:24px;";

  if (characters.length < 2) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Нужно как минимум два персонажа, чтобы связать их между собой.";
    wrap.appendChild(empty);
    container.appendChild(wrap);
    return;
  }

  wrap.appendChild(buildGraph());
  wrap.appendChild(buildList());
  container.appendChild(wrap);
}

function buildGraph() {
  const size = 420;
  const r = size / 2 - 50;
  const cx = size / 2;
  const cy = size / 2;

  const positions = {};
  characters.forEach((c, i) => {
    const angle = (2 * Math.PI * i) / characters.length - Math.PI / 2;
    positions[c.id] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });

  const lines = relationships
    .map((rel) => {
      const a = positions[rel.charA];
      const b = positions[rel.charB];
      if (!a || !b) return "";
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${scoreColor(rel.score)}" stroke-width="2.5" opacity="0.85"/>`;
    })
    .join("");

  const nodes = characters
    .map((c) => {
      const p = positions[c.id];
      return `
        <circle cx="${p.x}" cy="${p.y}" r="16" fill="${c.color || "#7c7157"}" />
        <text x="${p.x}" y="${p.y + 30}" text-anchor="middle" fill="#a99977" font-size="12" font-family="Inter,sans-serif">${escapeHtml(c.name || "?")}</text>
      `;
    })
    .join("");

  const holder = document.createElement("div");
  holder.style.cssText = "background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;display:flex;justify-content:center;";
  holder.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${lines}${nodes}</svg>`;
  return holder;
}

function buildList() {
  const box = document.createElement("div");
  box.style.cssText = "display:flex;flex-direction:column;gap:10px;max-width:640px;";

  for (const rel of relationships) {
    box.appendChild(buildRelRow(rel));
  }

  const addBtn = document.createElement("button");
  addBtn.className = "btn";
  addBtn.textContent = "+ Добавить связь";
  addBtn.style.alignSelf = "flex-start";
  addBtn.addEventListener("click", () => {
    relationships.push({
      id: uid(),
      charA: characters[0].id,
      charB: characters[1].id,
      label: "",
      score: 0,
      note: "",
    });
    persist();
    draw();
  });
  box.appendChild(addBtn);

  return box;
}

function buildRelRow(rel) {
  const row = document.createElement("div");
  row.style.cssText = "background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px;";

  const top = document.createElement("div");
  top.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:8px;";

  const selA = characterSelect(characters, rel.charA);
  selA.addEventListener("change", () => { rel.charA = selA.value; persist(); draw(); });
  const arrow = document.createElement("span");
  arrow.textContent = "↔";
  arrow.style.color = "var(--text-faint)";
  const selB = characterSelect(characters, rel.charB);
  selB.addEventListener("change", () => { rel.charB = selB.value; persist(); draw(); });

  const label = document.createElement("input");
  label.placeholder = "Метка (наставник, вражда…)";
  label.value = rel.label || "";
  label.style.flex = "1";
  label.style.cssText += "background:var(--panel-alt);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:6px 8px;font-family:inherit;font-size:0.85rem;";
  label.addEventListener("input", () => { rel.label = label.value; persist(); });

  const delBtn = document.createElement("button");
  delBtn.className = "btn danger";
  delBtn.textContent = "✕";
  delBtn.addEventListener("click", () => {
    relationships = relationships.filter((r) => r.id !== rel.id);
    persist();
    draw();
  });

  top.append(selA, arrow, selB, label, delBtn);
  row.appendChild(top);

  const sliderRow = document.createElement("div");
  sliderRow.style.cssText = "display:flex;align-items:center;gap:10px;";
  const scoreLabel = document.createElement("span");
  scoreLabel.style.cssText = "font-family:'JetBrains Mono',monospace;font-size:0.75rem;color:var(--text-faint);width:36px;text-align:right;";
  scoreLabel.textContent = rel.score;
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = -100;
  slider.max = 100;
  slider.value = rel.score || 0;
  slider.style.flex = "1";
  slider.addEventListener("input", () => {
    rel.score = Number(slider.value);
    scoreLabel.textContent = rel.score;
    persist();
  });
  sliderRow.append(scoreLabel, slider);
  row.appendChild(sliderRow);

  const note = document.createElement("textarea");
  note.placeholder = "Заметка о связи…";
  note.value = rel.note || "";
  note.style.cssText = "width:100%;margin-top:8px;background:var(--panel-alt);border:1px solid var(--border);border-radius:6px;color:var(--text-dim);padding:6px 8px;font-family:inherit;font-size:0.85rem;resize:vertical;min-height:36px;";
  note.addEventListener("input", () => { rel.note = note.value; persist(); });
  row.appendChild(note);

  return row;
}
