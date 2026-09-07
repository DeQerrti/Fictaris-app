// ══════════════════════════════════════════════
//  ПОСТРОЧНЫЙ DIFF (Настройки → Данные → История версий)
//
//  Обычный LCS-diff (наибольшая общая подпоследовательность строк) —
//  тот же принцип, что у git diff/diff -u, только без внешней
//  библиотеки: весь фронтенд ванильный, своя реализация в полсотни
//  строк проще, чем тащить зависимость ради неё одной.
//
//  Работает над строками ЛЮБОГО файла истории как есть — вызывающая
//  сторона (data-panel.js) сравнивает не сами модули (характеры,
//  локации и т.п.) по смыслу, а их JSON.stringify(..., null, 2)
//  построчно. Это не "умный" diff конкретного персонажа, а честный
//  "что изменилось в файле" — зато один код на все девять файлов
//  истории, а не отдельная логика под схему каждого модуля.
// ══════════════════════════════════════════════

// Классический DP через таблицу длин LCS — O(n·m) по времени и памяти.
// На истории Fictaris (JSON конкретных карточек/модулей, не мегабайтные
// логи) более чем достаточно, но не бесконечно — вызывающая сторона
// обязана проверить размер сама (см. DIFF_LINE_LIMIT) и не звать
// diffLines на файлах за разумным пределом: n·m растёт квадратично, и
// без проверки вкладка может надолго зависнуть или вылететь по памяти.
export const DIFF_LINE_LIMIT = 4000;

export function diffLines(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "equal", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", text: a[i] });
      i++;
    } else {
      out.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ type: "del", text: a[i++] });
  while (j < m) out.push({ type: "add", text: b[j++] });
  return out;
}

// Схлопывает длинные пробеги неизменных строк до contextLines с каждой
// стороны изменения — без этого одна правка внутри большого JSON-
// массива (двадцать персонажей, поменялось имя у одного) тянула бы за
// собой сотни неизменных строк вокруг, и саму правку пришлось бы
// выискивать глазами. Схлопнутый пробег превращается в запись
// { type: "gap", count } — сколько строк спрятано.
export function collapseContext(rows, contextLines = 3) {
  const out = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].type !== "equal") {
      out.push(rows[i]);
      i++;
      continue;
    }
    let j = i;
    while (j < rows.length && rows[j].type === "equal") j++;
    const runLength = j - i;
    if (runLength <= contextLines * 2) {
      for (let k = i; k < j; k++) out.push(rows[k]);
    } else {
      for (let k = i; k < i + contextLines; k++) out.push(rows[k]);
      out.push({ type: "gap", count: runLength - contextLines * 2 });
      for (let k = j - contextLines; k < j; k++) out.push(rows[k]);
    }
    i = j;
  }
  return out;
}
