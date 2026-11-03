import { i18n } from "./i18n.js";

// ══════════════════════════════════════════════
//  РОДСТВО
//
//  Общее для карточки персонажа (characters.js — где связи правятся) и
//  Родословной (family-tree.js — древо и фокус на одном человеке).
//
//  Данные в characters.json, все поля необязательные:
//    partnerIds          — пары, симметрично у обоих;
//    partnerKinds        — { [id партнёра]: вид пары }, тоже симметрично;
//                          нет записи — «в браке» (так читались все пары
//                          до появления видов);
//    parentIds           — родители;
//    adoptiveParentIds   — подмножество parentIds: приёмный родитель;
//    uncertainParentIds  — подмножество parentIds: предполагаемый (тайна,
//                          слухи) — не пересекается с приёмными;
//    gender              — "male" | "female" | нет: только ради «отец/мать»
//                          вместо «родитель» в подписях.
//  Внебрачность не хранится — она следует из того, что кровные родители
//  ребёнка не женаты друг на друге.
// ══════════════════════════════════════════════

export const PARTNER_KINDS = [
  ["married", "в браке"],
  ["betrothed", "помолвлены"],
  ["lover", "любовники"],
  ["divorced", "в разводе"],
];

export const PARENT_KINDS = [
  ["birth", "родной"],
  ["adoptive", "приёмный"],
  ["uncertain", "предполагаемый"],
];

export const GENDERS = [
  ["", "не указан"],
  ["male", "мужской"],
  ["female", "женский"],
];

export function partnerKind(c, otherId) {
  const kind = c?.partnerKinds?.[otherId];
  return PARTNER_KINDS.some(([k]) => k === kind) ? kind : "married";
}

// Обе стороны сразу — вид пары, как и сама пара, симметричен.
export function setPartnerKind(a, b, kind) {
  for (const [x, y] of [[a, b], [b, a]]) {
    const kinds = { ...(x.partnerKinds || {}) };
    if (kind === "married") delete kinds[y.id];
    else kinds[y.id] = kind;
    if (Object.keys(kinds).length) x.partnerKinds = kinds;
    else delete x.partnerKinds;
  }
}

export function forgetPartner(a, b) {
  a.partnerIds = (a.partnerIds || []).filter((id) => id !== b.id);
  b.partnerIds = (b.partnerIds || []).filter((id) => id !== a.id);
  for (const [x, y] of [[a, b], [b, a]]) {
    if (!x.partnerKinds) continue;
    delete x.partnerKinds[y.id];
    if (!Object.keys(x.partnerKinds).length) delete x.partnerKinds;
  }
}

export function parentKind(child, parentId) {
  if ((child.adoptiveParentIds || []).includes(parentId)) return "adoptive";
  if ((child.uncertainParentIds || []).includes(parentId)) return "uncertain";
  return "birth";
}

export function setParentKind(child, parentId, kind) {
  child.adoptiveParentIds = (child.adoptiveParentIds || []).filter((id) => id !== parentId);
  child.uncertainParentIds = (child.uncertainParentIds || []).filter((id) => id !== parentId);
  if (kind === "adoptive") child.adoptiveParentIds.push(parentId);
  if (kind === "uncertain") child.uncertainParentIds.push(parentId);
  if (!child.uncertainParentIds.length) delete child.uncertainParentIds;
}

export function forgetParent(child, parentId) {
  child.parentIds = (child.parentIds || []).filter((id) => id !== parentId);
  setParentKind(child, parentId, "birth");
}

function areMarried(a, b) {
  if (!a || !b) return false;
  if (!(a.partnerIds || []).includes(b.id) || !(b.partnerIds || []).includes(a.id)) return false;
  const kind = partnerKind(a, b.id);
  return kind === "married" || kind === "divorced"; // развод после рождения не делает ребёнка внебрачным
}

// Внебрачный — двое и больше кровных (не приёмных) родителей, и какая-то
// пара из них не в браке. Один известный родитель — не повод: второй
// просто не заведён.
export function isIllegitimate(child, byId) {
  const blood = (child.parentIds || []).filter((id) => byId.has(id) && parentKind(child, id) !== "adoptive");
  for (let i = 0; i < blood.length; i++) {
    for (let j = i + 1; j < blood.length; j++) {
      if (!areMarried(byId.get(blood[i]), byId.get(blood[j]))) return true;
    }
  }
  return false;
}

export function isDead(c) {
  return /†|умер|погиб|мёртв|мертв|dead|deceased/i.test(c?.age || "");
}

// [мужское, женское, без пола] — подпись по полу того, о ком она.
function g(c, male, female, neutral) {
  return i18n(c?.gender === "male" ? male : c?.gender === "female" ? female : neutral);
}

export function partnerLabel(person, other) {
  const kind = partnerKind(person, other.id);
  if (kind === "lover") return g(other, "Любовник", "Любовница", "Возлюбленный(ая)");
  if (kind === "betrothed") return g(other, "Жених", "Невеста", "Помолвлены");
  if (kind === "divorced") return g(other, "Бывший муж", "Бывшая жена", "Бывший супруг(а)");
  // «Покойная» — только глазами живого: у двух умерших это просто брак.
  if (isDead(other) && !isDead(person)) return g(other, "Покойный муж", "Покойная жена", "Покойный супруг(а)");
  return g(other, "Муж", "Жена", "Супруг(а)");
}

// Общие родители двух людей: кровные с обеих сторон (shared), под
// вопросом ли хотя бы у одного (uncertain), только приёмные (adoptiveOnly).
function siblingTie(a, b) {
  const kindsA = new Map((a.parentIds || []).map((id) => [id, parentKind(a, id)]));
  const common = (b.parentIds || []).filter((id) => kindsA.has(id));
  const blood = common.filter((id) => kindsA.get(id) !== "adoptive" && parentKind(b, id) !== "adoptive");
  const uncertain = blood.some((id) => kindsA.get(id) === "uncertain" || parentKind(b, id) === "uncertain");
  return { common, blood, uncertain, adoptiveOnly: common.length > 0 && !blood.length };
}

function maybe(label, uncertain) {
  return uncertain ? `${label} (${i18n("под вопросом")})` : label;
}

function siblingLabel(me, s, byId) {
  const tie = siblingTie(me, s);
  if (tie.adoptiveOnly) return g(s, "Названый брат", "Названая сестра", "Названые брат или сестра");
  const base = g(s, "Брат", "Сестра", "Брат или сестра");
  const bloodOf = (c) => (c.parentIds || []).filter((id) => byId.has(id) && parentKind(c, id) !== "adoptive");
  const full = tie.blood.length >= 2 && tie.blood.length === bloodOf(me).length && tie.blood.length === bloodOf(s).length;
  if (full) return maybe(base, tie.uncertain);
  const via = byId.get(tie.blood[0]);
  const suffix = via?.gender === "male" ? i18n("по отцу") : via?.gender === "female" ? i18n("по матери") : i18n("наполовину");
  return maybe(`${base} ${suffix}`, tie.uncertain);
}

// ── Кем приходятся остальные ─────────────────────
// Для фокуса на одном человеке: группы родни, у каждого — подпись
// («Сестра по отцу», «Внебрачный сын», «Мачеха»). Один человек попадает
// только в первую подходящую группу — ближайшее родство важнее.
export function relativesOf(focusId, characters) {
  const byId = new Map(characters.map((c) => [c.id, c]));
  const me = byId.get(focusId);
  if (!me) return null;
  const taken = new Set([focusId]);
  const pick = (list) => list.filter((x) => x.c && !taken.has(x.c.id) && taken.add(x.c.id));

  const parentsOf = (c) => (c?.parentIds || []).map((id) => byId.get(id)).filter(Boolean);
  const childrenOf = (c) => characters.filter((x) => (x.parentIds || []).includes(c.id));
  const partnersOf = (c) => (c?.partnerIds || []).map((id) => byId.get(id)).filter((p) => p && (p.partnerIds || []).includes(c.id));
  const spouses = (c) => partnersOf(c).filter((p) => ["married", "divorced"].includes(partnerKind(c, p.id)));

  const parents = pick(parentsOf(me).map((p) => {
    const kind = parentKind(me, p.id);
    const label = kind === "adoptive"
      ? g(p, "Приёмный отец", "Приёмная мать", "Приёмный родитель")
      : kind === "uncertain"
        ? g(p, "Предполагаемый отец", "Предполагаемая мать", "Предполагаемый родитель")
        : g(p, "Отец", "Мать", "Родитель");
    return { c: p, label, kind };
  }));
  const parentIds = new Set(parents.map((x) => x.c.id));

  // Отчим/мачеха — живой супруг родителя в браке; умерший или бывший мог
  // и не застать ребёнка (первая жена отца) — тогда просто «жена отца».
  const stepParents = pick(parentsOf(me).flatMap((p) => spouses(p).map((s) => ({ p, s }))).map(({ p, s }) => {
    const current = partnerKind(p, s.id) === "married" && !isDead(s);
    const label = current
      ? g(s, "Отчим", "Мачеха", "Супруг(а) родителя")
      : p.gender === "male" ? i18n("Жена отца") : p.gender === "female" ? i18n("Муж матери") : i18n("Супруг(а) родителя");
    return { c: s, label, kind: "step" };
  }));

  const grandparents = pick(parents.filter((x) => x.kind !== "uncertain").flatMap((x) => parentsOf(x.c)).map((gp) =>
    ({ c: gp, label: g(gp, "Дедушка", "Бабушка", "Дедушка или бабушка") })));

  const partners = pick(partnersOf(me).map((p) => ({ c: p, label: partnerLabel(me, p), kind: partnerKind(me, p.id) })));

  const siblings = pick(characters
    .filter((x) => x.id !== me.id && (x.parentIds || []).some((id) => parentIds.has(id)))
    .map((s) => ({ c: s, label: siblingLabel(me, s, byId) })));

  const illegitimate = (child) => isIllegitimate(child, byId);
  const children = pick(childrenOf(me).map((k) => {
    const kind = parentKind(k, me.id);
    const label = kind === "adoptive"
      ? g(k, "Приёмный сын", "Приёмная дочь", "Приёмный ребёнок")
      : kind === "uncertain"
        ? g(k, "Предполагаемый сын", "Предполагаемая дочь", "Предполагаемый ребёнок")
        : illegitimate(k)
          ? g(k, "Внебрачный сын", "Внебрачная дочь", "Внебрачный ребёнок")
          : g(k, "Сын", "Дочь", "Ребёнок");
    return { c: k, label };
  }));

  const stepChildren = pick(spouses(me).flatMap((s) => childrenOf(s)).map((k) =>
    ({ c: k, label: g(k, "Пасынок", "Падчерица", "Ребёнок супруга") })));

  const grandchildren = pick(children.flatMap((x) => childrenOf(x.c)).map((k) =>
    ({ c: k, label: g(k, "Внук", "Внучка", "Внук или внучка") })));

  const auntsUncles = pick(parents.filter((x) => x.kind === "birth").flatMap((x) =>
    characters.filter((s) => s.id !== x.c.id && (s.parentIds || []).some((id) => (x.c.parentIds || []).includes(id)))
      .map((u) => ({ u, uncertain: siblingTie(x.c, u).uncertain })))
    .map(({ u, uncertain }) => ({ c: u, label: maybe(g(u, "Дядя", "Тётя", "Дядя или тётя"), uncertain) })));

  const cousins = pick(auntsUncles.flatMap((x) => childrenOf(x.c)).map((k) =>
    ({ c: k, label: g(k, "Двоюродный брат", "Двоюродная сестра", "Двоюродные брат или сестра") })));

  const nephews = pick(siblings.flatMap((x) => childrenOf(x.c).map((k) => ({ k, uncertain: siblingTie(me, x.c).uncertain }))).map(({ k, uncertain }) =>
    ({ c: k, label: maybe(g(k, "Племянник", "Племянница", "Племянник или племянница"), uncertain) })));

  // Родители супруга: тесть/тёща — у мужа, свёкор/свекровь — у жены.
  const inLaws = pick(spouses(me).flatMap((s) => parentsOf(s)).map((p) => {
    const label = me.gender === "male"
      ? g(p, "Тесть", "Тёща", "Родитель жены")
      : me.gender === "female"
        ? g(p, "Свёкор", "Свекровь", "Родитель мужа")
        : g(p, "Отец супруга", "Мать супруга", "Родитель супруга");
    return { c: p, label };
  }));

  return { me, grandparents, parents, stepParents, siblings, partners, children, stepChildren, grandchildren, auntsUncles, cousins, nephews, inLaws };
}
