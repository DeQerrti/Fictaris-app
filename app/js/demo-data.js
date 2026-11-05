// Связный тестовый сюжет для кнопки «Заполнить примером» — мир
// «Раскольного клинка», в котором задействовано всё, что умеет
// приложение: две книги с частями, вложенной папкой, синопсисами,
// @упоминаниями, форматированием, стикерами, заметками и снимками;
// четыре поколения двух родов со всеми видами пар (брак, помолвка,
// любовники, развод), приёмным и предполагаемым родителем; вложенные
// локации; фракции с отношениями (в том числе своими статусами);
// таймлайн с точными датами своего календаря; две доски со всеми типами
// карточек; три холста (аккуратный, «от руки» со всеми фигурами,
// карточки из мира); четыре карты (нарисованная с нуля, рисунок поверх
// картинки, вложенный план) с границами фракций; знания.
//
// Настройки мира, без которых часть этого не видна (календарь, свои
// статусы глав, шаблоны анкет с полями «Дата мира»), живут в
// site-settings.json, а не в данных: их дописывает withDemoSettings и
// снимает stripDemoSettings («Убрать пример»). Всё своё у примера —
// с префиксом demo-, чтобы снять ровно его и не тронуть настроек
// пользователя.
//
// Язык контента — по текущему языку интерфейса (i18n.js, currentLang):
// L(ru, en) выбирает нужную половину. Структура (id, связи, координаты,
// цвета) одна на оба языка. Стандартные теги (tags.js → DEFAULT_TAGS_MAP)
// хранятся по-русски в обоих языках — это ключи словаря, интерфейс
// переводит их сам; свои теги переводятся через L.
import { apiPost } from "./api.js";
import { KNOWS_FROM_START } from "./knowledge.js";
import { currentLang } from "./i18n.js";

// Простая карта-заглушка на <canvas> — тот же приём, что в
// image-compress.js: рисуем, берём dataURL, отрезаем префикс до base64.
function buildDemoMapImage(title, accent = "#6b5636") {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 800;
  const ctx = canvas.getContext("2d");

  const grad = ctx.createLinearGradient(0, 0, 1200, 800);
  grad.addColorStop(0, "#e8d9b5");
  grad.addColorStop(1, "#cdb583");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1200, 800);

  ctx.strokeStyle = accent;
  ctx.lineWidth = 10;
  ctx.strokeRect(16, 16, 1168, 768);

  ctx.fillStyle = "#4a3b22";
  ctx.font = "bold 42px serif";
  ctx.textAlign = "center";
  ctx.fillText(title, 600, 90);

  ctx.strokeStyle = "#8a744f";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(120, 620);
  ctx.bezierCurveTo(300, 700, 500, 560, 700, 610);
  ctx.bezierCurveTo(900, 660, 1000, 560, 1120, 600);
  ctx.stroke();

  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

const isEn = () => currentLang() === "en";
const lang = () => {
  const en = isEn();
  return (ru, enText) => (en ? enText : ru);
};

// ══════════════ Настройки мира для примера ══════════════

const BIRTH_KEY = "demo_birth";

// Дописывает в site-settings календарь, статусы и шаблоны примера.
// Свои настройки пользователя (тема, язык, порядок вкладок…) не трогает.
export function withDemoSettings(settings) {
  const L = lang();
  const s = { ...(settings || {}) };
  s.calendar = {
    demo: true,
    enabled: true,
    eraLabel: L("год", "year"),
    months: [
      [L("Снежень", "Snowmoon"), 30, "winter"], [L("Ледолом", "Icebreak"), 30, "winter"],
      [L("Капельник", "Thawmoon"), 30, "spring"], [L("Цветень", "Bloommoon"), 31, "spring"],
      [L("Травень", "Grassmoon"), 30, "spring"], [L("Солнцеворот", "Sunturn"), 31, "summer"],
      [L("Жатвень", "Reapmoon"), 30, "summer"], [L("Зноень", "Heatmoon"), 30, "summer"],
      [L("Листопад", "Leaffall"), 30, "autumn"], [L("Туманник", "Mistmoon"), 31, "autumn"],
      [L("Предзимье", "Frostfall"), 30, "autumn"], [L("Долгая ночь", "Longnight"), 28, "winter"],
    ].map(([name, days, season]) => ({ name, days, season })),
    weekdays: [L("Звездень", "Starday"), L("Луньдень", "Moonday"), L("Огнедень", "Fireday"), L("Водень", "Waterday"),
      L("Древень", "Treeday"), L("Златень", "Goldday"), L("Покой", "Restday")],
    weekOffset: 2,
    holidays: [
      { id: "demo-h-1", name: L("Первоснежье", "First Snow"), month: 0, day: 1, kind: "holiday", color: "#6a8fae" },
      { id: "demo-h-2", name: L("Ночь Пепла", "Night of Ash"), month: 2, day: 9, kind: "mourning", color: "#6b6b6b" },
      { id: "demo-h-3", name: L("Солнцеворот", "Sunturn"), month: 5, day: 21, kind: "holiday", color: "#c9944a" },
      { id: "demo-h-4", name: L("Праздник жатвы", "Harvest Feast"), month: 6, day: 15, kind: "holiday", color: "#9a9250" },
      { id: "demo-h-5", name: L("День Раскола", "Sundering Day"), month: 8, day: 3, kind: "memorial", color: "#4f7d74" },
      { id: "demo-h-6", name: L("Поминовение Первых королей", "Remembrance of the First Kings"), month: 10, day: 20, kind: "memorial", color: "#7a6a9a" },
    ],
    today: { year: 224, month: 8, day: 12 },
  };

  s.chapterStatuses = [
    { key: "demo-idea", label: L("Задумка", "Idea"), color: "#6a8fae", emoji: "💡" },
    { key: "draft", label: L("Черновик", "Draft"), color: "#7c7157", emoji: "" },
    { key: "editing", label: L("На редактуре", "Editing"), color: "#c9944a", emoji: "" },
    { key: "demo-review", label: L("У бета-ридера", "With beta reader"), color: "#9e6a7d", emoji: "" },
    { key: "done", label: L("Готово", "Done"), color: "#5a8a5f", emoji: "" },
  ];

  const tpl = { ...(s.templates || {}) };
  // Персонажи: в шаблон «По умолчанию» — поле «Дата рождения» (вид «Дата
  // мира», «рожд» в названии → день рождения в календаре).
  const chars = (Array.isArray(tpl.characters) && tpl.characters.length ? tpl.characters : [{
    id: "default", name: L("По умолчанию", "Default"), fields: [
      { key: "role", label: L("Роль", "Role"), type: "input" },
      { key: "age", label: L("Возраст", "Age"), type: "input" },
      { key: "appearance", label: L("Внешность", "Appearance"), type: "textarea" },
      { key: "personality", label: L("Характер", "Personality"), type: "textarea" },
      { key: "motivation", label: L("Мотивация", "Motivation"), type: "textarea" },
      { key: "goal", label: L("Цель", "Goal"), type: "textarea" },
      { key: "flaws", label: L("Слабости", "Flaws"), type: "textarea" },
      { key: "backstory", label: L("Предыстория", "Backstory"), type: "textarea" },
    ] }]).map((t) => ({ ...t, fields: [...(t.fields || [])] }));
  const def = chars.find((t) => t.id === "default") || chars[0];
  if (!def.fields.some((f) => f.key === BIRTH_KEY)) {
    def.fields.splice(2, 0, { key: BIRTH_KEY, label: L("Дата рождения", "Date of birth"), type: "date" });
  }
  tpl.characters = chars;

  // Свои шаблоны пользователя остаются, шаблон примера заменяется
  // (повторное «Заполнить примером» не плодит копии).
  const withDefault = (list, fields) => (Array.isArray(list) && list.length
    ? list.filter((t) => !String(t.id).startsWith("demo-"))
    : [{ id: "default", name: L("По умолчанию", "Default"), fields }]);
  tpl.locations = [...withDefault(tpl.locations, [
    { key: "description", label: L("Описание", "Description"), type: "textarea" },
    { key: "notes", label: L("Заметки", "Notes"), type: "textarea" },
  ]), { id: "demo-tpl-settlement", name: L("Поселение", "Settlement"), fields: [
    { key: "description", label: L("Описание", "Description"), type: "textarea" },
    { key: "population", label: L("Население", "Population"), type: "input" },
    { key: "ruler", label: L("Кто правит", "Ruled by"), type: "input" },
    { key: "founded", label: L("Дата основания", "Founded"), type: "date" },
    { key: "notes", label: L("Заметки", "Notes"), type: "richtext" },
  ] }];
  tpl.factions = [...withDefault(tpl.factions, [
    { key: "description", label: L("Описание / идеология", "Description / ideology"), type: "textarea" },
    { key: "notes", label: L("Заметки", "Notes"), type: "textarea" },
  ]), { id: "demo-tpl-order", name: L("Орден или культ", "Order or cult"), fields: [
    { key: "description", label: L("Описание / идеология", "Description / ideology"), type: "textarea" },
    { key: "motto", label: L("Девиз", "Motto"), type: "input" },
    { key: "founded", label: L("Дата основания", "Founded"), type: "date" },
    { key: "notes", label: L("Заметки", "Notes"), type: "textarea" },
  ] }];
  s.templates = tpl;
  return s;
}

// «Убрать пример»: снимает только то, что дописал withDemoSettings.
export function stripDemoSettings(settings) {
  const s = { ...(settings || {}) };
  if (s.calendar?.demo) delete s.calendar;
  if (Array.isArray(s.chapterStatuses)) {
    const rest = s.chapterStatuses.filter((x) => !String(x.key).startsWith("demo-"));
    if (rest.length !== s.chapterStatuses.length) {
      // Остались ровно три стандартных — убираем ключ: без него
      // приложение берёт свои статусы с подписями на языке интерфейса.
      const keys = rest.map((x) => x.key).join(",");
      if (keys === "draft,editing,done") delete s.chapterStatuses;
      else s.chapterStatuses = rest;
    }
  }
  if (s.templates) {
    const tpl = {};
    for (const [kind, list] of Object.entries(s.templates)) {
      tpl[kind] = Array.isArray(list)
        ? list.filter((t) => !String(t.id).startsWith("demo-"))
          .map((t) => ({ ...t, fields: (t.fields || []).filter((f) => f.key !== BIRTH_KEY) }))
        : list;
    }
    s.templates = tpl;
  }
  return s;
}

// ══════════════ Данные мира ══════════════

export async function buildDemoBundle() {
  const L = lang();
  // Абзацы главы разделяются одним переводом строки.
  const P = (...lines) => lines.join("\n");

  // ── Персонажи ──────────────────────────────
  const characters = [];
  const C = {};
  const person = (id, ru, en, color, gender, tags, extra = {}) => {
    const c = { id, name: L(ru, en), color, gender, templateId: "default", tags,
      role: "", age: "", appearance: "", personality: "", motivation: "", goal: "", flaws: "", backstory: "", ...extra };
    characters.push(c);
    C[id.replace(/^demo-c-/, "")] = c;
    return c;
  };

  person("demo-c-aster", "Астра Вирен", "Astra Viren", "#c9944a", "female", "Протагонист, Герой, Наследие, Жив, " + L("изгнанница", "exile"), {
    role: L("Изгнанная наследница", "Exiled heir"), age: "24", [BIRTH_KEY]: "200-4-14",
    appearance: L("Шрам через бровь, серебряная прядь в чёрных волосах", "A scar through one eyebrow, a streak of silver in black hair"),
    personality: L("Упряма, скрытна, верна немногим", "Stubborn, guarded, loyal to few"),
    motivation: L("Вернуть себе Дом Вирен", "Reclaim House Viren"),
    goal: L("Найти Раскольный клинок", "Find the Sundering Blade"),
    flaws: L("Не умеет просить о помощи", "Can't ask for help"),
    backstory: L("Изгнана после переворота десять лет назад", "Exiled after the coup ten years ago") });
  person("demo-c-kael", "Каэль Дорн", "Kael Dorn", "#4f7d74", "male", "Наставник, Второстепенный, Искупление, Жив", {
    role: L("Наставник-отступник", "Renegade mentor"), age: "51", [BIRTH_KEY]: "173-9-2",
    appearance: L("Седая борода, ожог на левой руке", "Grey beard, a burn on his left hand"),
    personality: L("Циничен, но заботлив", "Cynical but caring"),
    motivation: L("Искупить старую ошибку", "Atone for an old mistake"),
    goal: L("Уберечь Астру от своей же судьбы", "Keep Astra from his own fate"),
    flaws: L("Пьёт, когда страшно", "Drinks when he's scared"),
    backstory: L("Бывший рыцарь Раскола, предал орден", "A former Knight of the Sundering who betrayed the order") });
  person("demo-c-varn", "Лорд Варн", "Lord Varn", "#a4483c", "male", "Антагонист, Тень, Жив", {
    role: L("Узурпатор", "Usurper"), age: "47", [BIRTH_KEY]: "177-12-20",
    appearance: L("Безупречно одет, холодный взгляд", "Impeccably dressed, a cold stare"),
    personality: L("Расчётлив, обаятелен на публике", "Calculating, charming in public"),
    motivation: L("Удержать власть любой ценой", "Hold on to power at any cost"),
    goal: L("Уничтожить всех наследников Дома Вирен", "Destroy every heir of House Viren"),
    flaws: L("Недооценивает тех, кого считает слабыми", "Underestimates those he deems weak"),
    backstory: L("Организовал переворот против Дома Вирен", "Orchestrated the coup against House Viren") });
  person("demo-c-nessa", "Несса", "Nessa", "#7d6a9e", "female", "Союзник, Трикстер, Второстепенный, Тайная личность, Жив", {
    role: L("Контрабандистка", "Smuggler"), age: "29", [BIRTH_KEY]: "195-3-5",
    appearance: L("Татуировки-карты портов по предплечьям", "Tattooed harbour maps along her forearms"),
    personality: L("Дружелюбна с виду, торгуется до последнего", "Friendly on the surface, haggles to the last coin"),
    motivation: L("Разбогатеть и уплыть подальше", "Get rich and sail far away"),
    goal: L("Вывезти Астру из города", "Get Astra out of the city"),
    flaws: L("Продаст кого угодно, если цена достаточно высока", "Will sell anyone if the price is right"),
    backstory: L("Знает все контрабандные тропы побережья. Мать перед смертью назвала ей имя отца – Несса до сих пор не уверена, что это не бред лихорадки.",
      "Knows every smuggling route on the coast. Before she died, her mother named Nessa's father – Nessa still isn't sure it wasn't fever talk.") });
  person("demo-c-aldric", "Король Альдрик Вирен", "King Aldric Viren", "#8a7a3c", "male", "Погиб, Массовка, Наследие", {
    role: L("Дед Астры, последний коронованный Вирен", "Astra's grandfather, the last crowned Viren"), age: "†", [BIRTH_KEY]: "140-1-3",
    backstory: L("Правил сорок шесть лет. Запретил Ордену Раскола вмешиваться в дела трона.", "Reigned for forty-six years. Forbade the Order of the Sundering to meddle in matters of the throne.") });
  person("demo-c-ingrid", "Королева Ингрид Вирен", "Queen Ingrid Viren", "#7a6a9a", "female", "Погиб, Массовка", {
    role: L("Бабушка Астры", "Astra's grandmother"), age: "†", [BIRTH_KEY]: "145-8-19",
    backstory: L("Хранила ключ от склепа клинка до самой смерти.", "Kept the key to the blade's crypt until her death.") });
  person("demo-c-father", "Лорд Эдвин Вирен", "Lord Edwin Viren", "#9a9250", "male", "Погиб, Массовка", {
    role: L("Прежний глава Дома Вирен", "Former head of House Viren"), age: "†", [BIRTH_KEY]: "171-6-21",
    appearance: L("Известен только по портретам", "Known only from portraits"),
    personality: L("Мягок с семьёй, нерешителен в совете", "Gentle with family, indecisive in council"),
    backstory: L("Убит во время переворота Варна. Говорят, у него была женщина в Портовом квартале.", "Killed during Varn's coup. Rumour has it he kept a woman in the docks.") });
  person("demo-c-mother", "Леди Мира Вирен", "Lady Mira Viren", "#6a8fae", "female", "Погиб, Массовка", {
    role: L("Прежняя глава Дома Вирен", "Former head of House Viren"), age: "†", [BIRTH_KEY]: "176-2-11",
    appearance: L("Известна только по портретам", "Known only from portraits"),
    backstory: L("Убита во время переворота Варна", "Killed during Varn's coup") });
  person("demo-c-edwin-first-wife", "Леди Тесса", "Lady Tessa", "#7d6a9e", "female", "Погиб, Массовка", {
    role: L("Первая жена Эдвина Вирена", "Edwin Viren's first wife"), age: "†",
    backstory: L("Умерла бездетной за много лет до переворота", "Died childless many years before the coup") });
  person("demo-c-ada", "Ада Солтри", "Ada Saltry", "#b5636b", "female", "Погиб, Массовка, Запретная любовь", {
    role: L("Певица из портового квартала, мать Нессы", "A singer from the docks, Nessa's mother"), age: "†", [BIRTH_KEY]: "174-7-7",
    backstory: L("Пела в таверне «Серая чайка». Говорят, её навещал сам Лорд Эдвин. Умерла от лихорадки, когда Нессе было двенадцать.",
      "Sang at the Grey Gull tavern. Rumour has it Lord Edwin himself used to visit her. Died of fever when Nessa was twelve.") });
  person("demo-c-iris", "Леди Ирис Вирен", "Lady Iris Viren", "#b5636b", "female", "Второстепенный, Жив, " + L("изгнанница", "exile"), {
    role: L("Старшая сестра Астры", "Astra's elder sister"), age: "27", [BIRTH_KEY]: "197-10-8",
    personality: L("Осторожна, практична, не верит в возвращение трона", "Cautious, practical, has no faith in reclaiming the throne"),
    motivation: L("Защитить дочь", "Protect her daughter"),
    goal: L("Уговорить Астру отказаться от клинка", "Talk Astra out of seeking the blade"),
    backstory: L("Бежала в изгнание с первым мужем, Дамианом, сразу после переворота. Развелась с ним через три года.",
      "Fled into exile with her first husband, Damian, right after the coup. Divorced him three years later.") });
  person("demo-c-damian", "Дамиан Корс", "Damian Kors", "#5d6b7a", "male", "Массовка, Предательство, Жив", {
    role: L("Первый муж Ирис", "Iris's first husband"), age: "30", [BIRTH_KEY]: "194-11-2",
    personality: L("Обаятелен и труслив", "Charming and cowardly"),
    motivation: L("Вернуться ко двору любой ценой", "Return to court at any cost"),
    flaws: L("Продаёт секреты Вирен людям Варна", "Sells Viren secrets to Varn's men"),
    backstory: L("Оставил Ирис через три года изгнания и тайно присягнул Варну.", "Left Iris after three years in exile and secretly swore fealty to Varn.") });
  person("demo-c-renar", "Ренар", "Renar", "#6a8fae", "male", "Союзник, Массовка, Жив", {
    role: L("Муж Ирис", "Iris's husband"), age: "35", [BIRTH_KEY]: "189-5-30",
    personality: L("Спокоен, немногословен, отличный лучник", "Calm, few words, an excellent archer"),
    backstory: L("Не из Дома Вирен – познакомился с Ирис уже в изгнании", "Not of House Viren – met Iris in exile") });
  person("demo-c-lia", "Лия", "Lia", "#9a9250", "female", "Массовка, Жив", {
    role: L("Племянница Астры", "Astra's niece"), age: "9", [BIRTH_KEY]: "215-1-17",
    personality: L("Любопытна, рисует карты всего, что видит", "Curious, draws maps of everything she sees"),
    backstory: L("Дочь Ирис от первого брака – Ренар удочерил её после свадьбы", "Iris's daughter from her first marriage – Renar adopted her after the wedding") });
  person("demo-c-varn-father", "Старый Дом Варн", "Old House Varn", "#9a9250", "male", "Погиб, Массовка, Наследие", {
    role: L("Основатель Дома Варн", "Founder of House Varn"), age: "†",
    backstory: L("Заложил притязания Дома Варн на трон", "Laid House Varn's claim to the throne") });
  person("demo-c-elaine", "Леди Элейн Варн", "Lady Elaine Varn", "#6a6f8e", "female", "Погиб, Массовка", {
    role: L("Покойная жена Варна", "Varn's late wife"), age: "†", [BIRTH_KEY]: "182-2-2",
    backstory: L("Умерла зимой 220 года. Тейн уверен, что её отравили.", "Died in the winter of 220. Thane is sure she was poisoned.") });
  person("demo-c-rowena", "Леди Ровена Таль", "Lady Rowena Tal", "#c06c84", "female", "Второстепенный, Двойная жизнь, Жив", {
    role: L("Невеста Варна", "Varn's betrothed"), age: "22", [BIRTH_KEY]: "202-5-1",
    appearance: L("Рыжие косы, перчатки даже летом", "Red braids, gloves even in summer"),
    personality: L("Улыбчива, наблюдательна, ничего не забывает", "Smiling, observant, forgets nothing"),
    motivation: L("Отомстить Варну за разорение Дома Таль", "Avenge the ruin of House Tal on Varn"),
    goal: L("Стать королевой и править вместо него", "Become queen and rule in his place"),
    flaws: L("Верит, что сможет переиграть кого угодно", "Believes she can outplay anyone") });
  person("demo-c-thane", "Тейн Варн", "Thane Varn", "#b0603a", "male", "Второстепенный, Запретная любовь, Двойная жизнь, Жив", {
    role: L("Сын узурпатора", "The usurper's son"), age: "19", [BIRTH_KEY]: "205-8-23",
    appearance: L("Худой, отцовские глаза, вечно в чернилах", "Thin, his father's eyes, always ink-stained"),
    personality: L("Книжник, мечтатель, упрям, как отец", "Bookish, a dreamer, as stubborn as his father"),
    motivation: L("Узнать правду о смерти матери", "Learn the truth about his mother's death"),
    goal: L("Остановить отца, не убивая его", "Stop his father without killing him"),
    flaws: L("Наивен в том, что касается людей", "Naive about people"),
    backstory: L("Вырос во дворце, который отец отнял у Вирен. Тайно переписывается с Магистром Остеном.",
      "Grew up in the palace his father took from the Virens. Secretly corresponds with Master Osten.") });
  person("demo-c-osten", "Магистр Остен", "Master Osten", "#4f6d8a", "male", "Наставник, Второстепенный, Пророчество, Жив", {
    role: L("Магистр Ордена Раскола", "Master of the Order of the Sundering"), age: "68", [BIRTH_KEY]: "156-1-28",
    appearance: L("Слепой, ходит с посохом из чёрного дуба", "Blind, walks with a black-oak staff"),
    personality: L("Терпелив, говорит загадками", "Patient, speaks in riddles"),
    motivation: L("Исполнить пророчество о клинке", "Fulfil the prophecy of the blade"),
    goal: L("Дождаться законной наследницы", "Wait for the rightful heir"),
    flaws: L("Ради пророчества пожертвует кем угодно", "Will sacrifice anyone for the prophecy"),
    backstory: L("Принял Каэля в орден мальчишкой и не простил его ухода.", "Took Kael into the order as a boy and never forgave him for leaving.") });
  person("demo-c-meira", "Мейра Пепельная", "Meira the Ashen", "#9c3d54", "female", "Антагонист, Тень, Договор с силой, Жив", {
    role: L("Верховная жрица Культа Пепельного огня", "High priestess of the Cult of the Ashen Fire"), age: "40", [BIRTH_KEY]: "184-11-11",
    appearance: L("Лицо в пепельных узорах, голос тише шёпота", "Ash patterns on her face, a voice softer than a whisper"),
    personality: L("Фанатична и бесконечно спокойна", "Fanatical and endlessly calm"),
    motivation: L("Вернуть миру древний огонь", "Bring the ancient fire back to the world"),
    goal: L("Заполучить клинок для обряда", "Obtain the blade for the rite"),
    flaws: L("Видит знаки там, где их нет", "Sees omens where there are none"),
    backstory: L("Помогла Варну с переворотом в обмен на храм в столице.", "Helped Varn with the coup in exchange for a temple in the capital.") });
  person("demo-c-garrett", "Капитан Гаррет Хольм", "Captain Garrett Holm", "#7a5c3e", "male", "Оборотень (сюжетный), Второстепенный, Жив", {
    role: L("Капитан Легиона", "Captain of the Legion"), age: "38", [BIRTH_KEY]: "186-4-4",
    personality: L("Служака, честен до неловкости", "A career soldier, awkwardly honest"),
    motivation: L("Защитить своих людей", "Protect his men"),
    goal: L("Понять, кому на самом деле служит", "Work out whom he really serves"),
    flaws: L("Слишком долго выполняет приказы", "Follows orders for too long"),
    backstory: L("Командовал гвардейцами в ночь переворота. Видел, кто открыл ворота.", "Commanded the guards on the night of the coup. Saw who opened the gates.") });
  person("demo-c-yorick", "Йорик", "Yorick", "#8f8f5a", "male", "Массовка, Жив", {
    role: L("Мальчишка-вор из Тени", "A street thief from the Shade"), age: "12", [BIRTH_KEY]: "212-6-6",
    personality: L("Нахален, быстр, голоден", "Cheeky, quick, hungry"),
    motivation: L("Наесться досыта", "Eat his fill") });
  person("demo-c-velda", "Вельда", "Velda", "#5f8a5f", "female", "Массовка, Жив", {
    role: L("Травница из Ивняка", "Herbalist of Willowmere"), age: "70", [BIRTH_KEY]: "154-3-3",
    personality: L("Ворчлива, добра", "Grumpy, kind"),
    backstory: L("Принимала роды у Леди Миры. Знает, что у Астры на плече – родимое пятно Вирен.", "Delivered Lady Mira's children. Knows Astra bears the Viren birthmark on her shoulder.") });
  person("demo-c-soren", "Сорен Кейл", "Soren Keil", "#3e6a7a", "male", "Второстепенный, Трикстер, Жив", {
    role: L("Глава Синдиката Тени", "Head of the Shade Syndicate"), age: "55", [BIRTH_KEY]: "169-10-30",
    appearance: L("Золотой зуб, перстни на каждом пальце", "A gold tooth, a ring on every finger"),
    personality: L("Вежлив, как удав", "As polite as a python"),
    motivation: L("Деньги и порядок в порту", "Money and order in the harbour"),
    goal: L("Продать клинок тому, кто больше заплатит", "Sell the blade to the highest bidder"),
    backstory: L("Взял Нессу в ученицы, когда та умерла бы от голода.", "Took Nessa on as an apprentice when she would have starved otherwise.") });
  person("demo-c-brannock", "Сир Бранок", "Ser Brannock", "#6b6b6b", "male", "Пропал без вести, Массовка", {
    role: L("Рыцарь Раскола, брат по оружию Каэля", "Knight of the Sundering, Kael's brother-in-arms"), age: "?", [BIRTH_KEY]: "175-2-14",
    backstory: L("Ушёл в Пепельные топи за Каэлем в 205 году и не вернулся.", "Followed Kael into the Ash Marshes in 205 and never came back.") });
  person("demo-c-ulv", "Хронист Ульв", "Ulv the Chronicler", "#8a8170", "male", "Рассказчик, Массовка, Жив", {
    role: L("Летописец, ведёт пролог и интерлюдии", "Chronicler, narrates the prologue and interludes"), age: "81", [BIRTH_KEY]: "143-12-1",
    personality: L("Ироничен, многословен", "Wry, long-winded"),
    backstory: L("Записывал правление трёх королей и одного узурпатора.", "Chronicled the reigns of three kings and one usurper.") });

  // Родство: четыре поколения Вирен, два рода (Варн отдельно), все виды
  // пар, приёмный (Ренар → Лия) и предполагаемый (Эдвин → Несса) родитель.
  const pair = (a, b, kind) => {
    for (const [x, y] of [[a, b], [b, a]]) {
      (x.partnerIds ||= []).push(y.id);
      if (kind) (x.partnerKinds ||= {})[y.id] = kind;
    }
  };
  pair(C.aldric, C.ingrid);
  pair(C.father, C.mother);
  pair(C.father, C["edwin-first-wife"]);
  pair(C.father, C.ada, "lover");
  pair(C.iris, C.renar);
  pair(C.iris, C.damian, "divorced");
  pair(C.varn, C.elaine);
  pair(C.varn, C.rowena, "betrothed");
  // Астра и Тейн — тайная любовь только в «Отношениях»: пара в родстве
  // слила бы Дом Вирен и Дом Варн в один род в Родословной.
  C.father.parentIds = [C.aldric.id, C.ingrid.id];
  C.aster.parentIds = [C.father.id, C.mother.id];
  C.iris.parentIds = [C.father.id, C.mother.id];
  C.nessa.parentIds = [C.ada.id, C.father.id];
  C.nessa.uncertainParentIds = [C.father.id];
  C.lia.parentIds = [C.iris.id, C.damian.id, C.renar.id];
  C.lia.adoptiveParentIds = [C.renar.id];
  C.varn.parentIds = [C["varn-father"].id];
  C.thane.parentIds = [C.varn.id, C.elaine.id];

  // ── Локации ──────────────────────────────
  const locations = [];
  const Lc = {};
  const place = (id, ru, en, type, parentId, desc, notes, tags, extra = {}) => {
    const l = { id, name: L(ru, en), type, description: desc, notes, tags, parentId, templateId: "default", images: [], ...extra };
    locations.push(l);
    Lc[id.replace(/^demo-l-/, "")] = l;
    return l;
  };
  place("demo-l-erdan", "Королевство Эрдан", "Kingdom of Erdan", "other", null,
    L("Королевство между Горами Раскола и Морем Тишины", "A kingdom between the Sundering Mountains and the Sea of Silence"),
    L("Весь мир книги 1", "The whole world of book 1"), L("королевство", "kingdom"));
  place("demo-l-mountains", "Горы Раскола", "Sundering Mountains", "danger", "demo-l-erdan",
    L("Хребет, расколотый, по легенде, ударом клинка", "A range split, legend says, by a single stroke of the blade"),
    L("Перевалы закрыты с Туманника до Капельника", "Passes are closed from Mistmoon to Thawmoon"), L("горы, опасно", "mountains, dangerous"));
  place("demo-l-fortress", "Крепость Раскола", "Fortress of the Sundering", "dungeon", "demo-l-mountains",
    L("Полуразрушенный орденский замок в горах", "A half-ruined order castle in the mountains"),
    L("Здесь хранится клинок", "The blade is kept here"), L("орден, руины", "order, ruins"));
  place("demo-l-gate", "Северные ворота", "North Gate", "other", "demo-l-fortress",
    L("Единственный вход в крепость", "The only way into the fortress"), L("Обрушены наполовину", "Half collapsed"), L("ворота", "gate"));
  place("demo-l-crypt", "Склеп клинка", "Crypt of the Blade", "dungeon", "demo-l-fortress",
    L("Подземный зал под крепостью", "An underground hall beneath the fortress"), "", L("склеп", "crypt"));
  place("demo-l-blade", "Раскольный клинок", "The Sundering Blade", "treasure", "demo-l-crypt",
    L("Артефакт, легитимизирующий притязания на трон", "An artifact that legitimizes a claim to the throne"),
    L("Спрятан в крепости", "Hidden in the fortress"), L("артефакт", "artifact") + ", Проклятие, Пророчество");
  place("demo-l-monastery", "Монастырь Тихих", "Monastery of the Silent", "other", "demo-l-mountains",
    L("Монастырь, где Каэль прятал Астру первые годы", "The monastery where Kael hid Astra in the early years"),
    L("Монахи дали обет молчания", "The monks are sworn to silence"), L("убежище", "refuge"));
  place("demo-l-capital", "Сольвейн", "Solveign", "settlement", "demo-l-erdan",
    L("Столица, захваченная Домом Варн", "The capital, seized by House Varn"),
    L("Резиденция узурпатора", "The usurper's residence"), L("столица", "capital"),
    { templateId: "demo-tpl-settlement", population: L("около 40 000", "about 40,000"), ruler: L("Лорд Варн (узурпатор)", "Lord Varn (usurper)"), founded: "12-3-1" });
  place("demo-l-palace", "Дворец Солнца", "Palace of the Sun", "settlement", "demo-l-capital",
    L("Бывшая резиденция Вирен, ныне – Варна", "Once the Virens' residence, now Varn's"),
    L("Тронный зал, сад, тайный ход из библиотеки", "Throne room, garden, a secret passage from the library"), L("дворец", "palace"));
  place("demo-l-temple", "Храм Пепла", "Temple of Ash", "dungeon", "demo-l-capital",
    L("Храм Культа Пепельного огня на месте королевской часовни", "The Cult of the Ashen Fire's temple, built over the royal chapel"),
    L("Под храмом – катакомбы", "Catacombs lie beneath the temple"), L("культ", "cult") + ", Проклятие");
  place("demo-l-harbor", "Портовый квартал Тень", "Shade Docks", "danger", "demo-l-capital",
    L("Трущобы и контрабандные причалы", "Slums and smugglers' wharves"),
    L("Владения Нессы", "Nessa's territory"), L("порт, опасно", "port, dangerous"),
    { templateId: "demo-tpl-settlement", population: L("никто не считал", "nobody has counted"), ruler: L("Сорен Кейл (неофициально)", "Soren Keil (unofficially)") });
  place("demo-l-gull", "Таверна «Серая чайка»", "The Grey Gull tavern", "settlement", "demo-l-harbor",
    L("Таверна, где пела Ада", "The tavern where Ada used to sing"), L("Хозяин помнит Эдвина", "The landlord remembers Edwin"), L("таверна", "tavern"));
  place("demo-l-willowmere", "Ивняк", "Willowmere", "settlement", "demo-l-erdan",
    L("Деревня у Зеркального озера", "A village by the Mirror Lake"), L("Здесь живёт Вельда", "Velda lives here"), L("деревня", "village"),
    { templateId: "demo-tpl-settlement", population: L("300 душ", "300 souls"), ruler: L("староста Мик", "Headman Mick"), founded: "150-5-1" });
  place("demo-l-mill", "Старая мельница", "The Old Mill", "other", "demo-l-willowmere",
    L("Заброшенная мельница у ручья", "An abandoned mill by the brook"), L("Тайник Каэля", "Kael's cache"), "Заброшено");
  place("demo-l-lake", "Зеркальное озеро", "Mirror Lake", "other", "demo-l-erdan",
    L("Озеро, в котором, говорят, видно прошлое", "A lake said to show the past"), "", L("озеро", "lake") + ", Пророчество");
  place("demo-l-marshes", "Пепельные топи", "Ash Marshes", "danger", "demo-l-erdan",
    L("Выжженные болота, где пропал Сир Бранок", "Scorched marshes where Ser Brannock vanished"),
    L("Владения Культа", "Cult territory"), L("болота, опасно", "marshes, dangerous"));
  place("demo-l-barrow", "Курган Первых королей", "Barrow of the First Kings", "treasure", "demo-l-erdan",
    L("Древние захоронения Вирен", "Ancient Viren burial grounds"), L("Ключ Ингрид открывает и его", "Ingrid's key opens it too"), L("гробница", "tomb") + ", Наследие");
  place("demo-l-keil", "Остров Кейл", "Keil Isle", "settlement", null,
    L("Вольный остров контрабандистов вне власти Эрдана", "A free smugglers' isle beyond Erdan's reach"),
    L("Штаб Синдиката Тени", "Shade Syndicate headquarters"), L("остров, порт", "island, port"),
    { templateId: "demo-tpl-settlement", population: "2 000", ruler: L("Сорен Кейл", "Soren Keil"), founded: "190-1-1" });

  // ── Фракции ──────────────────────────────
  const factions = [];
  const faction = (id, ru, en, type, desc, leaderId, headquartersId, memberIds, tags, extra = {}) => {
    const f = { id, name: L(ru, en), type, description: desc, notes: "", tags, leaderId, headquartersId, memberIds,
      templateId: "default", images: [], relations: {}, ...extra };
    factions.push(f);
    return f;
  };
  faction("demo-f-vieren", "Дом Вирен", "House Viren", "monarchy",
    L("Свергнутый правящий род, единственная законная наследница – Астра", "The deposed ruling house – its only legitimate heir is Astra"),
    C.aster.id, Lc.fortress.id, [C.aster.id, C.kael.id, C.iris.id, C.renar.id, C.lia.id, C.velda.id],
    L("изгнанники", "exiles") + ", Наследие", { notes: L("Девиз: «Свет не просит разрешения»", "Motto: \"Light asks no leave\"") });
  faction("demo-f-legion", "Легион Варна", "Varn's Legion", "military",
    L("Военная сила, которой держится узурпация", "The military force propping up the usurpation"),
    C.varn.id, Lc.capital.id, [C.varn.id, C.garrett.id, C.damian.id, C.thane.id], L("антагонисты", "antagonists"),
    { notes: L("Пять тысяч мечей, половина – наёмники", "Five thousand swords, half of them mercenaries") });
  faction("demo-f-order", "Орден Раскола", "Order of the Sundering", "order",
    L("Рыцари-хранители клинка. Верят, что трон принадлежит тому, кого признает клинок", "Knight-keepers of the blade. They hold that the throne belongs to whomever the blade accepts"),
    C.osten.id, Lc.fortress.id, [C.osten.id, C.brannock.id], L("орден", "order") + ", Пророчество",
    { templateId: "demo-tpl-order", motto: L("Клинок помнит", "The blade remembers"), founded: "1-1-1",
      notes: L("Каэль – бывший рыцарь, числится предателем", "Kael is a former knight, listed as a traitor") });
  faction("demo-f-cult", "Культ Пепельного огня", "Cult of the Ashen Fire", "cult",
    L("Жрецы древнего огня. Помогли Варну взять столицу", "Priests of an ancient fire. They helped Varn take the capital"),
    C.meira.id, Lc.temple.id, [C.meira.id], L("культ", "cult") + ", Договор с силой",
    { templateId: "demo-tpl-order", motto: L("Всё станет пеплом", "All becomes ash"), founded: "203-2-9" });
  faction("demo-f-syndicate", "Синдикат Тени", "Shade Syndicate", "syndicate",
    L("Контрабандисты побережья. Платят Легиону и потому живут", "Coastal smugglers. They pay the Legion and so they live"),
    C.soren.id, Lc.keil.id, [C.soren.id, C.nessa.id, C.yorick.id], L("контрабанда", "smuggling"));
  faction("demo-f-court", "Совет Сольвейна", "Council of Solveign", "monarchy",
    L("Двор узурпатора – лорды, присягнувшие Варну", "The usurper's court – lords sworn to Varn"),
    C.varn.id, Lc.palace.id, [C.varn.id, C.rowena.id, C.damian.id], L("двор", "court"));
  faction("demo-f-villages", "Вольные деревни", "Free Villages", "other",
    L("Деревни у Зеркального озера, не признавшие ни Варна, ни Культ", "Villages by the Mirror Lake that bow to neither Varn nor the Cult"),
    null, Lc.willowmere.id, [C.velda.id], L("крестьяне", "peasants"));
  const F = Object.fromEntries(factions.map((f) => [f.id.replace(/^demo-f-/, ""), f]));
  const relate = (a, b, status) => { F[a].relations[F[b].id] = status; F[b].relations[F[a].id] = status; };
  relate("vieren", "legion", "enemies");
  relate("vieren", "order", "allies");
  relate("vieren", "syndicate", "neutral");
  relate("vieren", "villages", "allies");
  relate("legion", "cult", "allies");
  relate("legion", "syndicate", L("платят дань", "pays tribute"));
  relate("legion", "court", L("вассалы", "vassals"));
  relate("order", "cult", "enemies");
  relate("cult", "villages", "enemies");
  relate("syndicate", "court", L("платят дань", "pays tribute"));

  // ── Отношения ──────────────────────────────
  let rn = 0;
  const rel = (a, b, ru, en, score, noteRu = "", noteEn = "") =>
    ({ id: `demo-r-${++rn}`, charA: C[a].id, charB: C[b].id, label: L(ru, en), score, note: L(noteRu, noteEn) });
  const relationships = [
    rel("kael", "aster", "наставник", "mentor", 70, "Учит её десять лет", "Has taught her for ten years"),
    rel("aster", "varn", "вражда", "feud", -90, "Он убил её семью", "He killed her family"),
    rel("aster", "nessa", "хрупкий союз", "fragile alliance", 20, "Пока платит – помогает", "Helps as long as she's paid"),
    rel("thane", "aster", "тайная любовь", "secret love", 75, "Встречаются ночами в библиотеке дворца", "They meet at night in the palace library"),
    rel("varn", "thane", "отец и сын", "father and son", -30, "Варн видит в сыне слабость", "Varn sees weakness in his son"),
    rel("rowena", "varn", "холодный расчёт", "cold calculation", -60, "Она улыбается ему и ведёт счёт", "She smiles at him and keeps score"),
    rel("kael", "osten", "ученик-отступник", "renegade pupil", -40, "Остен не простил ухода", "Osten never forgave his leaving"),
    rel("kael", "brannock", "братья по оружию", "brothers-in-arms", 85, "Каэль винит себя в его пропаже", "Kael blames himself for his disappearance"),
    rel("nessa", "soren", "учитель", "teacher", 40, "Он вырастил её – и держит на долге", "He raised her – and keeps her in debt"),
    rel("nessa", "yorick", "опекунша", "guardian", 60, "Подкармливает и гоняет", "Feeds him and chases him off"),
    rel("aster", "iris", "сёстры", "sisters", 35, "Любят друг друга и спорят обо всём", "Love each other and argue about everything"),
    rel("iris", "damian", "бывший муж", "ex-husband", -75, "Он сдал их убежище людям Варна", "He betrayed their hideout to Varn's men"),
    rel("meira", "varn", "сделка", "bargain", 10, "Союз до первой выгоды", "An alliance until the first profit"),
    rel("garrett", "varn", "присяга", "oath", 15, "Служит, но сомневается", "Serves, but has doubts"),
    rel("garrett", "aster", "долг чести", "debt of honour", 30, "Видел её ребёнком в ночь переворота", "Saw her as a child on the night of the coup"),
    rel("velda", "aster", "повитуха", "midwife", 65, "Принимала её роды", "Delivered her"),
    rel("renar", "lia", "отчим", "stepfather", 90, "Удочерил и учит стрелять", "Adopted her and teaches her archery"),
    rel("meira", "osten", "старые враги", "old enemies", -95, "Сожгла библиотеку ордена", "She burned the order's library"),
    rel("thane", "osten", "переписка", "correspondence", 45, "Тайные письма через голубей", "Secret letters by pigeon"),
    rel("soren", "varn", "деловые отношения", "business", 0, "Платит дань и ненавидит", "Pays tribute and hates it"),
    rel("kael", "nessa", "недоверие", "distrust", -20, "Каэль ждёт удара в спину", "Kael expects a knife in the back"),
    rel("rowena", "thane", "союз против отца", "alliance against his father", 25, "Ещё не знают, что нужны друг другу", "They don't yet know they need each other"),
    rel("ulv", "father", "летописец при дворе", "court chronicler", 50, "Был при Эдвине тридцать лет", "Served Edwin for thirty years"),
  ];

  // ── Рукопись ──────────────────────────────
  // Имена в @упоминаниях — точные name персонажей на текущем языке.
  const N = (k) => C[k].name;
  const M = (k, ru, en) => `@[${N(k)}|${L(ru, en)}]`;
  const B1 = "demo-book-1", B2 = "demo-book-2";
  const chap = (id, ru, en, bookId, folderId, status, synopsis, content, extra = {}) => ({
    id, title: L(ru, en), bookId, folderId, status, synopsis, content,
    characterIds: [], locationIds: [], notes: [], stickies: [], snapshots: [], ...extra,
  });
  const notes = (id, ...texts) => texts.map((text, i) => ({ id: `${id}-n${i + 1}`, text }));

  const chapters = [
    chap("demo-ch-prologue", "Пролог. Хроника Ульва", "Prologue. Ulv's Chronicle", B1, null, "done",
      L("Старый летописец предупреждает: эту историю написали победители, но не те, кого вы ждёте.", "The old chronicler warns: this story was written by the victors, just not the ones you expect."),
      L(P("Меня зовут Ульв, и я пережил трёх королей и одного узурпатора. Это меньше, чем кажется, и больше, чем хотелось бы.",
        "Летописи пишут победители – так говорят юнцы, которые не держали пера. На деле летописи пишут те, кто дожил до утра. Я дожил.",
        `*Раскольный клинок* выковали в год первый, когда горы ещё были целыми. Король ${M("aldric", "Альдрик", "Aldric")} смеялся над клятвой ордена. Его сын ${M("father", "Эдвин", "Edwin")} не смеялся – он просто о ней забыл.`,
        `А ${M("varn", "Варн", "Varn")} не забыл ничего. ==Запомните это==: он никогда ничего не забывал.`),
      P("My name is Ulv, and I have outlived three kings and one usurper. That is fewer than it sounds and more than I would like.",
        "History is written by the victors – so say the young who have never held a pen. In truth it is written by whoever lives to see morning. I did.",
        `*The Sundering Blade* was forged in the year one, when the mountains were still whole. King ${M("aldric", "", "Aldric")} laughed at the order's oath. His son ${M("father", "", "Edwin")} did not laugh – he simply forgot it.`,
        `But ${M("varn", "", "Varn")} forgot nothing. ==Remember that==: he never forgot anything.`)),
      { characterIds: [C.ulv.id], locationIds: [Lc.erdan.id],
        notes: notes("demo-ch-prologue", L("Пролог короткий – не больше двух страниц.", "Keep the prologue short – two pages at most."),
          L("Голос Ульва: ирония, длинные фразы, без пафоса.", "Ulv's voice: irony, long sentences, no pathos.")) }),

    chap("demo-ch-1", "Глава 1. Переворот", "Chapter 1. The Coup", B1, "demo-fold-1", "done",
      L("Ночь Пепла: Варн берёт Сольвейн, гвардия складывает оружие, Вирен гибнут.", "The Night of Ash: Varn takes Solveign, the guard lays down arms, the Virens die."),
      L(P("Сольвейн горел не так, как горят обычные пожары – размеренно, будто по расписанию.",
        `${M("varn", "Варн", "")} стоял на ступенях дворца и смотрел, как гвардейцы Дома Вирен складывают оружие один за другим.`,
        "– Все? – спросил он, не оборачиваясь.",
        `– Все, кто был на стенах, – ответил ${M("garrett", "капитан Хольм", "")}. Голос у него был ровный, слишком ровный. [[note:demo-st-1]]`,
        `Над Храмом Пепла поднимался дым, и жрица ${M("meira", "Мейра", "")} пела на языке, которого никто во дворце не понимал. **Ворота открыли изнутри.** Хольм видел, кто, – и молчал.`,
        `В западном крыле ${M("mother", "леди Мира", "")} успела сделать одно: вытолкнуть младшую дочь в тайный ход за библиотекой. Девочке было четырнадцать. Её звали ${M("aster", "Астра", "")}.`,
        "~~Король умер быстро.~~ Эдвин умер не быстро – и не сказал, где ключ."),
      P("Solveign burned unlike ordinary fires – steady, almost on schedule.",
        `${M("varn", "", "Varn")} stood on the palace steps, watching House Viren's guards lay down their weapons, one after another.`,
        "\"All of them?\" he asked without turning.",
        `"All who were on the walls," ${M("garrett", "", "Captain Holm")} replied. His voice was level – too level. [[note:demo-st-1]]`,
        `Smoke rose over the Temple of Ash, and the priestess ${M("meira", "", "Meira")} sang in a tongue no one in the palace understood. **The gates had been opened from inside.** Holm had seen by whom – and said nothing.`,
        `In the west wing ${M("mother", "", "Lady Mira")} managed one thing: she pushed her younger daughter into the secret passage behind the library. The girl was fourteen. Her name was ${M("aster", "", "Astra")}.`,
        "~~The king died quickly.~~ Edwin did not die quickly – and he never told them where the key was.")),
      { characterIds: [C.meira.id], locationIds: [Lc.capital.id, Lc.palace.id, Lc.temple.id],
        stickies: [{ id: "demo-st-1", text: L("Хольм знает, кто открыл ворота – раскрыть в главе 7", "Holm knows who opened the gates – reveal in chapter 7") }],
        notes: notes("demo-ch-1", L("Показать переворот глазами Варна, не Астры – контраст с главой 3.", "Show the coup through Varn's eyes, not Astra's – contrast with chapter 3.")),
        snapshots: [
          { id: "demo-snap-1", savedAt: "2026-09-08T19:40:00.000Z", content: L("Сольвейн горел не так, как горят обычные пожары.\nВарн смотрел на дворец.", "Solveign burned unlike ordinary fires.\nVarn watched the palace.") },
          { id: "demo-snap-2", savedAt: "2026-09-09T21:12:00.000Z", content: L("Сольвейн горел не так, как горят обычные пожары – размеренно, будто по расписанию.\nВарн стоял на ступенях дворца.", "Solveign burned unlike ordinary fires – steady, almost on schedule.\nVarn stood on the palace steps.") },
        ] }),

    chap("demo-ch-flight", "Глава 2. Бегство", "Chapter 2. The Escape", B1, "demo-fold-1", "done",
      L("Каэль находит Астру в подземном ходе и уводит её через Ивняк в Монастырь Тихих.", "Kael finds Astra in the tunnel and leads her through Willowmere to the Monastery of the Silent."),
      L(P(`Ход пах мокрым камнем и мышами. ${M("aster", "Астра", "")} шла на ощупь, считая шаги, потому что мать научила её считать, когда страшно.`,
        "На четыреста двенадцатом шаге из темноты сказали:",
        "– Не кричи. Я друг твоего отца. Был.",
        `${M("kael", "Каэль", "")} пах вином и гарью. На его левой руке ещё дымилась перчатка. [[note:demo-st-2]]`,
        `До Ивняка они шли три ночи. Травница @${N("velda")} перевязала Каэлю руку, посмотрела на родимое пятно на плече девочки и ничего не сказала.`,
        "*Монастырь Тихих* принял их без вопросов. Там вопросов не задавали в принципе."),
      P(`The passage smelled of wet stone and mice. ${M("aster", "", "Astra")} felt her way along, counting steps, because her mother had taught her to count when she was afraid.`,
        "At step four hundred and twelve, the darkness spoke:",
        "\"Don't scream. I'm a friend of your father's. Was.\"",
        `${M("kael", "", "Kael")} smelled of wine and smoke. The glove on his left hand was still smouldering. [[note:demo-st-2]]`,
        `It took them three nights to reach Willowmere. The herbalist @${N("velda")} bandaged Kael's hand, looked at the birthmark on the girl's shoulder and said nothing.`,
        "*The Monastery of the Silent* took them in without questions. Nobody there asked questions, on principle.")),
      { characterIds: [C.kael.id, C.velda.id], locationIds: [Lc.willowmere.id, Lc.monastery.id],
        stickies: [{ id: "demo-st-2", text: L("Ожог – тот самый, из предыстории Каэля", "The burn – the one from Kael's backstory") }],
        notes: notes("demo-ch-flight", L("Добавить сцену с переправой через озеро?", "Add a scene crossing the lake?")) }),

    chap("demo-ch-2", "Глава 3. Портовый квартал", "Chapter 3. The Docks", B1, "demo-fold-2", "editing",
      L("Десять лет спустя Астра и Каэль возвращаются в Сольвейн и ищут проводника к крепости.", "Ten years later Astra and Kael return to Solveign looking for a guide to the fortress."),
      L(P(`Десять лет спустя запах рыбы и смолы всё ещё казался ${M("aster", "Астре", "")} запахом свободы.`,
        `– Ты платишь вперёд, – сказала @${N("nessa")}, не оборачиваясь. – Так делают все, кому есть что терять.`,
        "– А если мне нечего терять?",
        "– Тогда тебе нечем платить. [[note:demo-st-3]]",
        `Мальчишка @${N("yorick")} уже второй раз пытался срезать кошель у Каэля и второй раз получал по пальцам. ${M("kael", "Каэль", "")} смотрел на Нессу, и взгляд у него был *очень* нехороший.`,
        "В «Серой чайке» пели. Несса сказала, что когда-то здесь пела её мать. <u>Астра почему-то запомнила это лучше, чем цену.</u>"),
      P(`Ten years later, the smell of fish and tar still felt like freedom to ${M("aster", "", "Astra")}.`,
        `"You pay up front," @${N("nessa")} said without turning around. "That's how it's done by anyone with something to lose."`,
        "\"And if I have nothing to lose?\"",
        "\"Then you have nothing to pay with.\" [[note:demo-st-3]]",
        `The boy @${N("yorick")} tried to cut Kael's purse for the second time and got his knuckles rapped for the second time. ${M("kael", "", "Kael")} was watching Nessa, and his look was *very* unfriendly.`,
        "Someone was singing in the Grey Gull. Nessa said her mother used to sing there. <u>For some reason Astra remembered that better than the price.</u>")),
      { characterIds: [C.yorick.id], locationIds: [Lc.harbor.id, Lc.gull.id],
        stickies: [{ id: "demo-st-3", text: L("Повторить эту реплику в финале, когда Несса предаст", "Echo this line in the finale, when Nessa betrays them") }],
        notes: notes("demo-ch-2", L("Нужно больше показать недоверие Каэля к Нессе.", "Need to show more of Kael's distrust of Nessa.")) }),

    chap("demo-ch-deal", "Глава 4. Цена проводника", "Chapter 4. The Guide's Price", B1, "demo-fold-2", "editing",
      L("Сорен Кейл назначает цену – половину клинка. Несса торгуется за себя, а не за Астру.", "Soren Keil names his price – half the blade. Nessa bargains for herself, not for Astra."),
      L(P(`${M("soren", "Сорен", "")} принимал гостей на корме своего корабля, и золотой зуб у него блестел ярче фонаря.`,
        "– Половину, – сказал он. – Клинок не режется пополам? Значит, половину того, что за него дадут.",
        `– Он не продаётся, – отрезала ${M("aster", "Астра", "")}.`,
        `– Всё продаётся, леди. – Он посмотрел на ${M("nessa", "Нессу", "")}. – Правда, девочка?`,
        "Несса улыбнулась. Улыбка была дружелюбная. **Глаза – нет.**",
        "==Сделка заключена на рассвете.== Каэль пил до рассвета."),
      P(`${M("soren", "", "Soren")} received his guests on the stern of his ship, and his gold tooth shone brighter than the lantern.`,
        "\"Half,\" he said. \"The blade can't be cut in two? Then half of whatever it fetches.\"",
        `"It's not for sale," ${M("aster", "", "Astra")} snapped.`,
        `"Everything's for sale, my lady." He looked at ${M("nessa", "", "Nessa")}. "Isn't that right, girl?"`,
        "Nessa smiled. The smile was friendly. **The eyes were not.**",
        "==The deal was struck at dawn.== Kael drank until dawn.")),
      { characterIds: [C.kael.id], locationIds: [Lc.harbor.id],
        notes: notes("demo-ch-deal", L("Слишком быстро соглашается – добавить колебание Астры.", "Agrees too fast – add Astra's hesitation."),
          L("Сорен должен намекнуть, что знает про отца Нессы.", "Soren should hint he knows about Nessa's father.")) }),

    chap("demo-ch-thane", "Глава 5. Сын узурпатора", "Chapter 5. The Usurper's Son", B1, "demo-fold-2", "demo-review",
      L("В библиотеке дворца Астра встречает Тейна Варна – и не убивает его.", "In the palace library Astra meets Thane Varn – and doesn't kill him."),
      L(P("Тайный ход за библиотекой никто так и не нашёл. Варн перестроил полдворца, но книги не трогал – он их не читал.",
        "Зато читал его сын.",
        `${M("thane", "Тейн", "")} сидел на полу между стеллажами, весь в чернилах, и выписывал что-то из хроники Ульва. Когда кинжал коснулся его шеи, он не закричал.`,
        "– Вы Вирен, – сказал он. – У вас её глаза. С портрета в западном крыле.",
        "– Твой отец убил её.",
        "– Я знаю. Он убил и мою. [[note:demo-st-4]]",
        `${M("aster", "Астра", "")} убрала кинжал. Потом долго не могла понять, зачем.`),
      P("No one ever found the secret passage behind the library. Varn rebuilt half the palace but left the books alone – he didn't read them.",
        "His son did.",
        `${M("thane", "", "Thane")} sat on the floor between the shelves, ink-stained, copying something out of Ulv's chronicle. When the dagger touched his throat, he didn't cry out.`,
        "\"You're a Viren,\" he said. \"You have her eyes. From the portrait in the west wing.\"",
        "\"Your father killed her.\"",
        "\"I know. He killed mine too.\" [[note:demo-st-4]]",
        `${M("aster", "", "Astra")} put the dagger away. For a long time afterwards she couldn't work out why.`)),
      { locationIds: [Lc.palace.id],
        stickies: [{ id: "demo-st-4", text: L("Первый намёк на отравление Элейн", "First hint that Elaine was poisoned") }],
        snapshots: [{ id: "demo-snap-3", savedAt: "2026-10-20T10:00:00.000Z", content: L("Тейн сидел в библиотеке. Астра хотела его убить, но не убила.", "Thane sat in the library. Astra meant to kill him, but didn't.") }] }),

    chap("demo-ch-council", "Интерлюдия. Совет у Варна", "Interlude. Varn's Council", B1, "demo-fold-2i", "draft",
      L("Ульв записывает совет: Мейра требует клинок, Ровена предлагает свадьбу раньше срока.", "Ulv records the council: Meira demands the blade, Rowena proposes an earlier wedding."),
      L(P("Записано мною, Ульвом, по памяти, ибо перья на совет приносить запрещено.",
        `${M("meira", "Жрица", "")} сказала, что огонь требует клинка. ${M("rowena", "Леди Ровена", "")} сказала, что свадьбу стоит сыграть до Солнцеворота. ${M("varn", "Лорд Варн", "")} не сказал ничего – и это было хуже всего.`,
        `${M("damian", "Дамиан", "")} принёс весть: младшая Вирен в городе.`),
      P("Set down by me, Ulv, from memory, since quills are forbidden at council.",
        `${M("meira", "", "The priestess")} said the fire demands the blade. ${M("rowena", "", "Lady Rowena")} said the wedding should be held before Sunturn. ${M("varn", "", "Lord Varn")} said nothing – and that was the worst of it.`,
        `${M("damian", "", "Damian")} brought word: the younger Viren is in the city.`)),
      { characterIds: [C.ulv.id], locationIds: [Lc.palace.id] }),

    chap("demo-ch-mountains", "Глава 6. Горы Раскола", "Chapter 6. The Sundering Mountains", B1, "demo-fold-3", "draft",
      L("Переход через перевал. Каэль рассказывает о Сире Бранке.", "Crossing the pass. Kael talks about Ser Brannock."),
      L(P("На перевале ветер выл так, что слова приходилось кричать.",
        `– Здесь мы с Бранком в последний раз… – начал ${M("kael", "Каэль", "")} и не закончил.`,
        `@${N("nessa")} шла последней и всё время оглядывалась. ~~Слишком часто.~~`),
      P("On the pass the wind howled so hard they had to shout.",
        `"This is where Brannock and I last…" ${M("kael", "", "Kael")} began, and didn't finish.`,
        `@${N("nessa")} walked last and kept looking back. ~~Too often.~~`)),
      { characterIds: [C.aster.id, C.brannock.id], locationIds: [Lc.mountains.id, Lc.monastery.id],
        notes: notes("demo-ch-mountains", L("Нужна сцена с лавиной или нет? Решить до правки.", "Avalanche scene or not? Decide before revising.")) }),

    chap("demo-ch-fortress", "Глава 7. Крепость", "Chapter 7. The Fortress", B1, "demo-fold-3", "draft",
      L("Магистр Остен встречает их у Северных ворот. Хольм догоняет отряд.", "Master Osten meets them at the North Gate. Holm catches up with the party."),
      L(P(`${M("osten", "Остен", "")} был слеп, но повернулся к Астре раньше, чем она заговорила.`,
        "– Клинок тебя ждал, – сказал он. – Я – нет.",
        `За спиной у них, на тропе, показались красные плащи. Впереди шёл ${M("garrett", "Хольм", "")}.`),
      P(`${M("osten", "", "Osten")} was blind, yet he turned to Astra before she spoke.`,
        "\"The blade has been waiting for you,\" he said. \"I have not.\"",
        `Behind them, red cloaks appeared on the trail. ${M("garrett", "", "Holm")} was at their head.`)),
      { characterIds: [C.aster.id, C.kael.id, C.nessa.id], locationIds: [Lc.fortress.id, Lc.gate.id] }),

    chap("demo-ch-blade", "Глава 8. Клинок", "Chapter 8. The Blade", B1, "demo-fold-3", "demo-idea",
      L("Склеп. Клинок признаёт Астру – или Нессу? Предательство Нессы.", "The crypt. The blade accepts Astra – or Nessa? Nessa's betrayal."), "",
      { characterIds: [C.aster.id, C.nessa.id, C.osten.id, C.garrett.id], locationIds: [Lc.crypt.id, Lc.blade.id],
        notes: notes("demo-ch-blade", L("Главный вопрос книги: кого признает клинок, если Несса – тоже дочь Эдвина?", "The book's central question: whom will the blade accept if Nessa is Edwin's daughter too?")) }),

    chap("demo-b2-ch1", "Глава 1. Возвращение в Сольвейн", "Chapter 1. Return to Solveign", B2, "demo-fold-b2", "draft",
      L("Весна 225. Астра входит в столицу с клинком – и видит на троне не Варна.", "Spring 225. Astra enters the capital with the blade – and finds someone other than Varn on the throne."),
      L(P("Весной Сольвейн пах не гарью, а сиренью, и это было почти оскорбительно.",
        `На троне сидела ${M("rowena", "Ровена", "")}. Корона была ей велика.`),
      P("In spring Solveign smelled not of smoke but of lilac, which was almost an insult.",
        `${M("rowena", "", "Rowena")} sat on the throne. The crown was too big for her.`)),
      { characterIds: [C.aster.id], locationIds: [Lc.capital.id, Lc.palace.id] }),
    chap("demo-b2-ch2", "Глава 2. Культ", "Chapter 2. The Cult", B2, "demo-fold-b2", "demo-idea",
      L("Мейра готовит обряд в катакомбах под Храмом Пепла.", "Meira prepares the rite in the catacombs beneath the Temple of Ash."), "",
      { characterIds: [C.meira.id], locationIds: [Lc.temple.id] }),
    chap("demo-b2-notes", "Заметки к книге", "Notes for the book", B2, null, "draft",
      L("Черновые мысли – не для печати.", "Rough thoughts – not for print."),
      L(P(`- ${M("thane", "Тейн", "")} должен выбрать сторону к середине книги.`, `- @${N("lia")} рисует карту катакомб.`),
        P(`- ${M("thane", "", "Thane")} must choose a side by the middle of the book.`, `- @${N("lia")} draws a map of the catacombs.`)),
      { characterIds: [C.thane.id, C.lia.id] }),
  ];

  const manuscript = {
    books: [
      { id: B1, title: L("Раскольный клинок", "The Sundering Blade"), goal: 80000, lastChapterId: "demo-ch-deal" },
      { id: B2, title: L("Пепельная королева", "The Ashen Queen"), goal: 100000, lastChapterId: "demo-b2-ch1" },
    ],
    activeBookId: B1,
    folders: [
      { id: "demo-fold-1", name: L("Часть I. Пепел", "Part I. Ash"), bookId: B1, parentId: null, status: "done", collapsed: false },
      { id: "demo-fold-2", name: L("Часть II. Тень", "Part II. Shade"), bookId: B1, parentId: null, status: "editing", collapsed: false },
      { id: "demo-fold-2i", name: L("Интерлюдии", "Interludes"), bookId: B1, parentId: "demo-fold-2", status: "draft", collapsed: true },
      { id: "demo-fold-3", name: L("Часть III. Крепость", "Part III. The Fortress"), bookId: B1, parentId: null, status: "draft", collapsed: false },
      { id: "demo-fold-b2", name: L("Часть I. Коронация без короны", "Part I. A Coronation Without a Crown"), bookId: B2, parentId: null, status: "demo-idea", collapsed: false },
    ],
    chapters,
    activeChapterId: "demo-ch-deal",
  };

  // ── Таймлайн ──────────────────────────────
  // Точные даты (dateYear/dateMonth с 0/dateDay) — для календаря мира,
  // у части событий только год и сезон в тексте даты.
  const ev = (id, ru, en, titleRu, titleEn, descRu, descEn, chars, locs, ymd) => ({
    id, date: L(ru, en), title: L(titleRu, titleEn), description: L(descRu, descEn),
    characterIds: chars.map((k) => C[k].id), locationIds: locs.map((k) => Lc[k].id),
    ...(ymd ? { dateYear: ymd[0], dateMonth: ymd[1], dateDay: ymd[2] } : {}),
  });
  const timeline = [
    ev("demo-t-founding", "год 1", "year 1", "Основание Ордена Раскола", "The Order of the Sundering is founded", "Клинок выкован, горы расколоты", "The blade is forged, the mountains split", ["ulv"], ["mountains", "fortress"], [1, 0, 1]),
    ev("demo-t-aldric", "год 168, весна", "year 168, spring", "Коронация Альдрика", "Aldric's coronation", "Альдрик запрещает ордену вмешиваться в дела трона", "Aldric forbids the order to meddle in matters of the throne", ["aldric", "ingrid"], ["palace"], [168, 3, 1]),
    ev("demo-t-tessa", "год 190", "year 190", "Свадьба Эдвина и Тессы", "Edwin weds Tessa", "Династический брак", "A dynastic marriage", ["father", "edwin-first-wife"], ["palace"]),
    ev("demo-t-nessa-born", "год 195, весна", "year 195, spring", "Рождение Нессы", "Nessa is born", "Ада рожает дочь в Портовом квартале и не называет отца", "Ada gives birth to a daughter in the docks and won't name the father", ["ada", "nessa"], ["harbor"], [195, 2, 5]),
    ev("demo-t-tessa-death", "год 195, зима", "year 195, winter", "Смерть Тессы", "Tessa dies", "Тесса умирает бездетной", "Tessa dies childless", ["edwin-first-wife", "father"], ["palace"]),
    ev("demo-t-mira", "год 196, лето", "year 196, summer", "Свадьба Эдвина и Миры", "Edwin weds Mira", "Сыграна в Солнцеворот", "Held on Sunturn", ["father", "mother"], ["palace"], [196, 5, 21]),
    ev("demo-t-iris-born", "год 197, осень", "year 197, autumn", "Рождение Ирис", "Iris is born", "", "", ["iris"], ["palace"], [197, 9, 8]),
    ev("demo-t-astra-born", "год 200, весна", "year 200, spring", "Рождение Астры", "Astra is born", "Роды принимает Вельда", "Velda delivers her", ["aster", "velda", "mother"], ["palace"], [200, 3, 14]),
    ev("demo-t-kael-leaves", "год 205", "year 205", "Каэль покидает орден", "Kael leaves the order", "Сир Бранок уходит за ним в Пепельные топи и пропадает", "Ser Brannock follows him into the Ash Marshes and vanishes", ["kael", "brannock", "osten"], ["marshes", "fortress"]),
    ev("demo-t-1", "год 214, весна", "year 214, spring", "Переворот", "The Coup", "Варн захватывает Сольвейн, семья Астры гибнет", "Varn seizes Solveign, Astra's family dies", ["varn", "aster", "garrett", "meira", "father", "mother"], ["capital", "palace"], [214, 2, 9]),
    ev("demo-t-2", "год 214, лето", "year 214, summer", "Бегство", "The Escape", "Каэль вывозит юную Астру из столицы", "Kael smuggles young Astra out of the capital", ["kael", "aster", "velda"], ["capital", "willowmere", "monastery"]),
    ev("demo-t-iris-exile", "год 214, лето", "year 214, summer", "Изгнание Ирис", "Iris goes into exile", "Ирис с Дамианом бегут на Остров Кейл", "Iris and Damian flee to Keil Isle", ["iris", "damian"], ["keil"]),
    ev("demo-t-lia-born", "год 215, зима", "year 215, winter", "Рождение Лии", "Lia is born", "", "", ["lia", "iris", "damian"], ["keil"], [215, 0, 17]),
    ev("demo-t-divorce", "год 217", "year 217", "Дамиан предаёт Ирис", "Damian betrays Iris", "Сдаёт убежище людям Варна, Ирис разводится с ним", "He betrays their hideout to Varn's men; Iris divorces him", ["iris", "damian"], ["keil"]),
    ev("demo-t-renar", "год 218, лето", "year 218, summer", "Свадьба Ирис и Ренара", "Iris weds Renar", "Ренар удочеряет Лию", "Renar adopts Lia", ["iris", "renar", "lia"], ["keil"], [218, 6, 15]),
    ev("demo-t-elaine", "год 220, зима", "year 220, winter", "Смерть Элейн Варн", "Elaine Varn dies", "Официально – лихорадка", "Officially – a fever", ["elaine", "thane", "varn"], ["palace"], [220, 11, 3]),
    ev("demo-t-betrothal", "год 224, весна", "year 224, spring", "Помолвка Варна и Ровены", "Varn and Rowena are betrothed", "", "", ["varn", "rowena"], ["palace"], [224, 4, 1]),
    ev("demo-t-3", "год 224, осень", "year 224, autumn", "Возвращение", "The Return", "Астра и Каэль прибывают в портовый квартал", "Astra and Kael arrive at the docks", ["aster", "kael", "nessa", "yorick"], ["harbor", "gull"], [224, 7, 20]),
    ev("demo-t-4", "год 224, осень", "year 224, autumn", "Сделка с Нессой", "The Deal with Nessa", "Несса соглашается провести их к крепости – за долю от находки", "Nessa agrees to guide them to the fortress – for a cut of what they find", ["aster", "nessa", "soren"], ["harbor"], [224, 7, 22]),
    ev("demo-t-library", "год 224, осень", "year 224, autumn", "Встреча в библиотеке", "Meeting in the library", "Астра находит Тейна в библиотеке дворца", "Astra finds Thane in the palace library", ["aster", "thane"], ["palace"], [224, 7, 28]),
    ev("demo-t-council", "год 224, осень", "year 224, autumn", "Совет у Варна", "Varn's council", "Мейра требует клинок, Дамиан приносит весть об Астре", "Meira demands the blade, Damian brings word of Astra", ["varn", "meira", "rowena", "damian", "ulv"], ["palace"], [224, 8, 1]),
    ev("demo-t-5", "год 224, осень", "year 224, autumn", "Крепость Раскола", "Fortress of the Sundering", "Отряд достигает крепости в поисках клинка", "The party reaches the fortress in search of the blade", ["aster", "kael", "nessa", "osten", "garrett"], ["fortress", "blade", "gate"], [224, 8, 10]),
    ev("demo-t-blade", "год 224, осень", "year 224, autumn", "Клинок пробуждается", "The blade awakens", "Кого признает клинок – ещё не решено", "Whom the blade will accept is not yet decided", ["aster", "nessa"], ["crypt"]),
    ev("demo-t-return", "год 225, весна", "year 225, spring", "Возвращение в Сольвейн", "Return to Solveign", "Начало книги 2", "Book 2 begins", ["aster", "rowena"], ["capital"]),
  ].map((e, i) => ({ ...e, order: i + 1 }));

  // ── Доски ──────────────────────────────
  // Все типы карточек, участники, место, глава, фракция, свой цвет и
  // чек-листы; вторая доска — чтобы было видно переключатель досок.
  const card = (id, titleRu, titleEn, type, o = {}) => ({
    id, title: L(titleRu, titleEn), type, notes: o.notes || "",
    characterIds: (o.chars || []).map((k) => C[k].id), factionId: o.faction || null,
    locationId: o.loc ? Lc[o.loc].id : null, chapterId: o.chapter || null, labelColor: o.color || null,
    checklist: (o.checklist || []).map(([ru, en, done], i) => ({ id: `${id}-c${i + 1}`, text: L(ru, en), done })),
  });
  const sceneCards = [
    card("demo-card-1", "Сцена предательства Нессы?", "Nessa's betrayal scene?", "mystery", {
      notes: L("Когда она решится – до склепа или в нём?", "When does she decide – before the crypt or inside it?"),
      chars: ["nessa", "soren"], faction: "demo-f-syndicate", loc: "crypt", chapter: "demo-ch-blade",
      checklist: [["Решить мотив", "Settle the motive", true], ["Подвести через главы 4 и 6", "Set it up in chapters 4 and 6", false], ["Разговор с Сореном", "Talk with Soren", false]] }),
    card("demo-card-2", "Прописать бегство из столицы", "Write out the escape from the capital", "scene", {
      chars: ["kael", "aster", "velda"], loc: "willowmere", chapter: "demo-ch-flight",
      checklist: [["Тайный ход", "The secret passage", true], ["Ивняк", "Willowmere", true], ["Монастырь", "The monastery", true]] }),
    card("demo-card-3", "Переворот – глава 1", "The coup – chapter 1", "scene", {
      notes: L("Готово, только вычитать", "Done, just proofread"), chars: ["varn", "garrett"], faction: "demo-f-legion", loc: "capital", chapter: "demo-ch-1" }),
    card("demo-card-4", "Тейн и Астра в библиотеке", "Thane and Astra in the library", "scene", {
      notes: L("Напряжение, а не романтика – пока", "Tension, not romance – for now"), chars: ["thane", "aster"], loc: "palace", chapter: "demo-ch-thane", color: "#c06c84",
      checklist: [["Первая реплика Тейна", "Thane's first line", true], ["Убрать лишнее про портрет", "Cut the extra bit about the portrait", false]] }),
    card("demo-card-5", "Сон Астры о родителях", "Astra's dream about her parents", "idea", {
      notes: L("Между главами 3 и 4", "Between chapters 3 and 4"), chars: ["aster", "mother", "father"] }),
    card("demo-card-6", "Сократить торг с Сореном", "Trim the haggling with Soren", "edit", {
      notes: L("Сцена тянется на 3 страницы", "The scene drags on for 3 pages"), chars: ["soren"], faction: "demo-f-syndicate", loc: "harbor", chapter: "demo-ch-deal",
      checklist: [["Вырезать пересказ легенды", "Cut the retold legend", true], ["Оставить зуб", "Keep the tooth", true], ["Ужать финал", "Tighten the ending", false]] }),
    card("demo-card-7", "Перевал: лавина или засада?", "The pass: avalanche or ambush?", "idea", {
      chars: ["kael", "nessa"], loc: "mountains", chapter: "demo-ch-mountains" }),
    card("demo-card-8", "Хольм догоняет отряд", "Holm catches up with the party", "scene", {
      chars: ["garrett"], faction: "demo-f-legion", loc: "gate", chapter: "demo-ch-fortress" }),
    card("demo-card-9", "Пролог: проверить даты", "Prologue: check the dates", "edit", {
      chars: ["ulv"], chapter: "demo-ch-prologue",
      checklist: [["Год основания ордена", "The order's founding year", true], ["Годы правления Альдрика", "Aldric's reign", true]] }),
  ];
  const worldCards = [
    card("demo-card-r1", "Как устроены перевалы зимой", "How mountain passes work in winter", "research", {
      notes: L("Почитать про горные переходы XIX века", "Read up on 19th-century mountain crossings"), faction: "demo-f-order", loc: "mountains",
      checklist: [["Снаряжение", "Gear", true], ["Сколько идти в день", "Distance per day", false], ["Обморожения", "Frostbite", false]] }),
    card("demo-card-r2", "Кто открыл ворота в Ночь Пепла?", "Who opened the gates on the Night of Ash?", "mystery", {
      notes: L("Дамиан? Мейра? Сам Эдвин?", "Damian? Meira? Edwin himself?"), chars: ["garrett", "damian", "meira"], faction: "demo-f-legion", loc: "palace", chapter: "demo-ch-1", color: "#a4483c" }),
    card("demo-card-r3", "Отравили ли Элейн?", "Was Elaine poisoned?", "mystery", {
      chars: ["elaine", "thane", "meira"], faction: "demo-f-cult", loc: "palace",
      checklist: [["Яд из топей", "Poison from the marshes", false], ["Свидетель – Ульв?", "Ulv as a witness?", false]] }),
    card("demo-card-r4", "Обряды Культа", "The Cult's rites", "research", {
      notes: L("Огонь, пепел, молчание", "Fire, ash, silence"), chars: ["meira"], faction: "demo-f-cult", loc: "temple" }),
    card("demo-card-r5", "Где Сир Бранок?", "Where is Ser Brannock?", "mystery", {
      notes: L("Жив? В плену у культа?", "Alive? A prisoner of the cult?"), chars: ["brannock", "kael"], faction: "demo-f-order", loc: "marshes" }),
    card("demo-card-r6", "Лия рисует карты", "Lia draws maps", "idea", {
      notes: L("Сквозной мотив для книги 2", "A running motif for book 2"), chars: ["lia"] }),
    card("demo-card-r7", "Календарь мира", "The world calendar", "research", {
      notes: L("Праздники и сезоны уже в Таймлайне", "Holidays and seasons are already in the Timeline"), color: "#5a8a5f",
      checklist: [["Месяцы", "Months", true], ["Праздники", "Holidays", true], ["Дни недели", "Weekdays", true]] }),
  ];
  const byId = (list) => Object.fromEntries(list.map((c) => [c.id, c]));
  const board = {
    boards: [
      {
        id: "demo-board-1", name: L("Книга 1 – сцены", "Book 1 – scenes"),
        columns: [
          { id: "demo-col-ideas", title: L("Задумано", "Planned") },
          { id: "demo-col-progress", title: L("В работе", "In progress") },
          { id: "demo-col-review", title: L("На правке", "Revising") },
          { id: "demo-col-done", title: L("Готово", "Done") },
        ],
        cards: byId(sceneCards),
        cardOrder: {
          "demo-col-ideas": ["demo-card-5", "demo-card-7", "demo-card-1"],
          "demo-col-progress": ["demo-card-8", "demo-card-4"],
          "demo-col-review": ["demo-card-6"],
          "demo-col-done": ["demo-card-3", "demo-card-2", "demo-card-9"],
        },
      },
      {
        id: "demo-board-2", name: L("Мир и тайны", "World and mysteries"),
        columns: [
          { id: "demo-col-q", title: L("Вопросы", "Questions") },
          { id: "demo-col-dig", title: L("Исследую", "Researching") },
          { id: "demo-col-solved", title: L("Решено", "Solved") },
        ],
        cards: byId(worldCards),
        cardOrder: {
          "demo-col-q": ["demo-card-r2", "demo-card-r3", "demo-card-r5"],
          "demo-col-dig": ["demo-card-r1", "demo-card-r4", "demo-card-r6"],
          "demo-col-solved": ["demo-card-r7"],
        },
      },
    ],
    activeBoardId: "demo-board-1",
  };

  // ── Карты ──────────────────────────────
  // «Эрдан» нарисован с нуля (все виды фигур и границ), «Побережье» и
  // «Сольвейн» — рисунок поверх картинки-заглушки, «План крепости» —
  // вложенная карта без картинки, в rootIds её нет: попасть — по меткам.
  const coastTitle = L("Побережье Раскола", "Sundering Coast");
  const capitalTitle = L("Сольвейн", "Solveign");
  const [{ path: coastImagePath }, { path: capitalImagePath }] = await Promise.all([
    apiPost("/api/map/image", { data: buildDemoMapImage(coastTitle), ext: "jpg" }),
    apiPost("/api/map/image", { data: buildDemoMapImage(capitalTitle, "#7d6a9e"), ext: "jpg" }),
  ]);
  const pin = (id, x, y, label, note = "", o = {}) => ({ id, x, y, label, note,
    characterId: o.char ? C[o.char].id : null, locationId: o.loc ? Lc[o.loc].id : null, linkedMapId: o.map || null });
  const W = 1600, H = 1000;
  const pc = (px, py) => [Math.round((px / W) * 10000) / 100, Math.round((py / H) * 10000) / 100];
  const stamp = (id, icon, x, y, size) => ({ id, kind: "stamp", icon, x, y, ...(size ? { size } : {}) });
  const label = (id, text, style, x, y, size) => ({ id, kind: "label", text, style, x, y, ...(size ? { size } : {}) });

  const map = {
    rootIds: ["demo-map-erdan", "demo-map-coast", "demo-map-capital"],
    maps: {
      "demo-map-erdan": {
        id: "demo-map-erdan", name: Lc.erdan.name, imageRelPath: null,
        drawing: { width: W, height: H, style: "atlas", shapes: [
          { id: "demo-ms-land", kind: "land", points: [[120, 140], [420, 80], [800, 110], [1180, 70], [1480, 180], [1520, 460], [1400, 700], [1100, 820], [700, 860], [360, 800], [160, 620], [90, 380]] },
          { id: "demo-ms-island", kind: "land", points: [[1250, 830], [1340, 800], [1420, 840], [1390, 910], [1280, 915]] },
          { id: "demo-ms-lake", kind: "water", points: [[620, 380], [700, 350], [780, 380], [770, 450], [680, 470], [610, 430]] },
          { id: "demo-ms-bay", kind: "water", points: [[760, 860], [830, 780], [940, 790], [1000, 850], [900, 880]] },
          { id: "demo-ms-river1", kind: "river", points: [[960, 200], [880, 260], [790, 330], [720, 365]], width: 4 },
          { id: "demo-ms-river2", kind: "river", points: [[690, 468], [720, 580], [800, 700], [860, 790]], width: 5 },
          { id: "demo-ms-road1", kind: "road", points: [[500, 600], [620, 680], [760, 740], [840, 770]] },
          { id: "demo-ms-road2", kind: "road", points: [[500, 600], [440, 520], [380, 420]] },
          { id: "demo-ms-road3", kind: "road", points: [[500, 600], [700, 540], [900, 400], [1050, 240]], width: 3 },
          { id: "demo-ms-b-legion", kind: "border", points: [[160, 430], [600, 420], [900, 560], [880, 830], [360, 790], [180, 620]], color: "#a4483c", factionId: "demo-f-legion", fill: 0.15 },
          { id: "demo-ms-b-order", kind: "border", points: [[880, 95], [1260, 90], [1300, 320], [950, 340]], color: "#4f7d74", factionId: "demo-f-order", line: "solid" },
          { id: "demo-ms-b-cult", kind: "border", points: [[1150, 450], [1490, 460], [1400, 700], [1150, 680]], color: "#9c3d54", factionId: "demo-f-cult", fill: 0.22 },
          { id: "demo-ms-b-free", kind: "border", points: [[300, 300], [560, 300], [600, 470], [300, 470]], color: "#5f8a5f", factionId: "demo-f-villages", fill: 0.1 },
          { id: "demo-ms-b-disputed", kind: "border", points: [[420, 120], [760, 130], [740, 280], [430, 280]], color: "#9a9250", name: L("Спорные земли", "Disputed lands"), fill: 0.06 },
          stamp("demo-ms-m1", "mountain", 980, 170, 48), stamp("demo-ms-m2", "mountain", 1070, 150, 56),
          stamp("demo-ms-m3", "mountain", 1160, 190, 48), stamp("demo-ms-m4", "mountain", 1220, 260, 40),
          stamp("demo-ms-f1", "forest", 260, 300), stamp("demo-ms-f2", "forest", 320, 250), stamp("demo-ms-f3", "forest", 220, 380),
          stamp("demo-ms-c1", "city", 500, 600, 44), stamp("demo-ms-c2", "city", 840, 770), stamp("demo-ms-c3", "city", 1330, 855),
          stamp("demo-ms-k1", "castle", 1050, 235, 44), stamp("demo-ms-k2", "castle", 1300, 400),
          stamp("demo-ms-v1", "village", 380, 420), stamp("demo-ms-v2", "village", 1290, 580),
          label("demo-ms-l-title", Lc.erdan.name, "title", 800, 40),
          label("demo-ms-l-mount", Lc.mountains.name, "region", 1100, 110),
          label("demo-ms-l-marsh", Lc.marshes.name, "region", 1300, 520),
          label("demo-ms-l-sea", L("Море Тишины", "Sea of Silence"), "sea", 520, 940, 30),
          label("demo-ms-l-lake", Lc.lake.name, "place", 695, 500),
          label("demo-ms-l-sol", Lc.capital.name, "place", 500, 645, 22),
          label("demo-ms-l-will", Lc.willowmere.name, "place", 380, 455),
          label("demo-ms-l-shade", L("Тень", "The Shade"), "place", 840, 805),
          label("demo-ms-l-fort", Lc.fortress.name, "place", 1050, 278),
          label("demo-ms-l-keil", Lc.keil.name, "place", 1335, 945),
        ] },
        pins: [
          pin("demo-pin-e-sol", ...pc(500, 600), Lc.capital.name, L("Открыть план столицы", "Open the city map"), { loc: "capital", map: "demo-map-capital" }),
          pin("demo-pin-e-fort", ...pc(1050, 235), Lc.fortress.name, L("План крепости", "Fortress plan"), { loc: "fortress", map: "demo-map-fortress" }),
          pin("demo-pin-e-shade", ...pc(840, 770), Lc.harbor.name, "", { loc: "harbor" }),
          pin("demo-pin-e-will", ...pc(380, 420), Lc.willowmere.name, L("Здесь живёт Вельда", "Velda lives here"), { loc: "willowmere" }),
          pin("demo-pin-e-keil", ...pc(1330, 855), Lc.keil.name, "", { loc: "keil" }),
          pin("demo-pin-e-mon", ...pc(1300, 400), Lc.monastery.name, "", { loc: "monastery" }),
          pin("demo-pin-e-marsh", ...pc(1290, 580), Lc.marshes.name, L("Здесь пропал Бранок", "Brannock vanished here"), { loc: "marshes" }),
          pin("demo-pin-e-lake", ...pc(695, 410), Lc.lake.name, "", { loc: "lake" }),
          pin("demo-pin-e-barrow", ...pc(250, 520), Lc.barrow.name, "", { loc: "barrow" }),
          pin("demo-pin-e-camp", ...pc(940, 330), L("Лагерь Астры", "Astra's camp"), L("Последняя ночёвка перед перевалом", "The last night before the pass"), { char: "aster" }),
          pin("demo-pin-e-coast", ...pc(640, 820), L("Побережье", "The coast"), L("Подробная карта побережья", "Detailed map of the coast"), { map: "demo-map-coast" }),
        ],
      },
      "demo-map-coast": {
        id: "demo-map-coast", name: coastTitle, imageRelPath: coastImagePath,
        drawing: { width: 1200, height: 800, underlay: 0.7, shapes: [
          { id: "demo-cs-sea", kind: "water", points: [[120, 620], [400, 610], [600, 600], [800, 625], [1120, 600], [1180, 780], [20, 780], [20, 640]] },
          { id: "demo-cs-road1", kind: "road", points: [[336, 304], [450, 450], [552, 576]] },
          { id: "demo-cs-road2", kind: "road", points: [[336, 304], [600, 260], [888, 176]] },
          { id: "demo-cs-river", kind: "river", points: [[700, 120], [680, 300], [720, 450], [760, 615]] },
          stamp("demo-cs-m1", "mountain", 840, 140), stamp("demo-cs-m2", "mountain", 950, 150),
          stamp("demo-cs-k", "castle", 888, 190), stamp("demo-cs-c", "city", 336, 320),
          stamp("demo-cs-v", "village", 552, 560), stamp("demo-cs-f", "forest", 200, 450),
          label("demo-cs-sea-l", L("Море Тишины", "Sea of Silence"), "sea", 600, 720),
        ] },
        pins: [
          pin("demo-pin-fortress", 74, 22, Lc.fortress.name, "", { loc: "fortress", map: "demo-map-fortress" }),
          pin("demo-pin-capital", 28, 38, Lc.capital.name, L("Открыть план города", "Open the city map"), { loc: "capital", map: "demo-map-capital" }),
          pin("demo-pin-harbor", 46, 72, Lc.harbor.name, "", { loc: "harbor" }),
          pin("demo-pin-nessa", 50, 66, L("Причал Нессы", "Nessa's pier"), L("Лодка без названия", "A boat with no name"), { char: "nessa" }),
        ],
      },
      "demo-map-capital": {
        id: "demo-map-capital", name: capitalTitle, imageRelPath: capitalImagePath,
        drawing: { width: 1200, height: 800, style: "ink", underlay: 0.4, shapes: [
          { id: "demo-ps-1", kind: "road", points: [[600, 180], [600, 400], [480, 640]], width: 4 },
          { id: "demo-ps-2", kind: "road", points: [[200, 400], [600, 400], [860, 360]] },
          { id: "demo-ps-3", kind: "river", points: [[0, 700], [400, 690], [800, 720], [1200, 700]] },
          stamp("demo-ps-4", "castle", 600, 180, 48),
          label("demo-ps-5", L("Площадь Пепла", "Ash Square"), "place", 600, 430),
          label("demo-ps-6", L("Тень", "The Shade"), "region", 480, 660),
          { id: "demo-ps-7", kind: "border", points: [[300, 560], [700, 560], [700, 690], [300, 690]], color: "#3e6a7a", factionId: "demo-f-syndicate", fill: 0.18 },
        ] },
        pins: [
          pin("demo-pin-palace", 50, 30, L("Дворец", "Palace"), L("Резиденция Варна после переворота", "Varn's residence after the coup"), { char: "varn" }),
          pin("demo-pin-c-palace", 50, 22, Lc.palace.name, "", { loc: "palace" }),
          pin("demo-pin-c-temple", 72, 45, Lc.temple.name, "", { loc: "temple" }),
          pin("demo-pin-c-gull", 40, 80, Lc.gull.name, "", { loc: "gull" }),
          pin("demo-pin-c-thane", 46, 26, L("Библиотека", "The library"), L("Где Астра встретила Тейна", "Where Astra met Thane"), { char: "thane" }),
        ],
      },
      "demo-map-fortress": {
        id: "demo-map-fortress", name: L("Крепость Раскола – план", "Fortress of the Sundering – plan"), imageRelPath: null,
        drawing: { width: 900, height: 600, style: "ink", shapes: [
          { id: "demo-fs-1", kind: "land", points: [[150, 100], [750, 100], [780, 500], [120, 500]] },
          { id: "demo-fs-2", kind: "water", points: [[600, 380], [700, 380], [700, 460], [600, 460]] },
          { id: "demo-fs-3", kind: "road", points: [[450, 600], [450, 500], [450, 300], [300, 200]], width: 3 },
          stamp("demo-fs-4", "castle", 450, 240, 60), stamp("demo-fs-5", "mountain", 100, 80), stamp("demo-fs-6", "mountain", 820, 90),
          label("demo-fs-7", Lc.fortress.name, "title", 450, 40),
          label("demo-fs-8", Lc.gate.name, "place", 450, 530),
          label("demo-fs-9", L("Цистерна", "Cistern"), "place", 650, 480),
        ] },
        pins: [
          pin("demo-pin-f-gate", 50, 85, Lc.gate.name, L("Наполовину обрушены", "Half collapsed"), { loc: "gate" }),
          pin("demo-pin-f-crypt", 50, 40, Lc.crypt.name, L("Вход – под алтарём", "The entrance is under the altar"), { loc: "crypt" }),
          pin("demo-pin-f-blade", 52, 34, Lc.blade.name, "", { loc: "blade" }),
          pin("demo-pin-f-osten", 30, 30, L("Башня Магистра", "The Master's tower"), L("Остен ждёт здесь", "Osten waits here"), { char: "osten" }),
        ],
      },
    },
  };

  // ── Холсты ──────────────────────────────
  const cc = (id, x, y, w, h, title, text, chapterId = null, color = null, entity) =>
    ({ id, x, y, w, h, title, text, chapterId, color, ...(entity ? { entity } : {}) });
  const ent = (type, id) => ({ type, id });
  const canvas = {
    order: ["demo-canvas-plot", "demo-canvas-plot2", "demo-canvas-cast"],
    canvases: {
      "demo-canvas-plot": {
        id: "demo-canvas-plot", name: L("Карта сюжета", "Plot map"),
        cards: [
          cc("demo-cc-1", 140, 160, 220, 130, L("Переворот", "The Coup"), L("Варн захватывает Сольвейн, семья Астры гибнет", "Varn seizes Solveign, Astra's family dies"), "demo-ch-1"),
          cc("demo-cc-2", 380, 160, 220, 130, L("Бегство", "The Escape"), L("Каэль вывозит юную Астру из столицы", "Kael smuggles young Astra out of the capital"), "demo-ch-flight"),
          cc("demo-cc-3", 620, 160, 220, 130, L("Возвращение", "The Return"), L("Астра и Каэль прибывают в портовый квартал десять лет спустя", "Astra and Kael arrive at the docks, ten years later"), "demo-ch-2"),
          cc("demo-cc-4", 620, 340, 220, 130, L("Сделка с Нессой", "The Deal with Nessa"), L("Несса соглашается провести их к крепости – за долю от находки", "Nessa agrees to guide them to the fortress – for a cut of what they find"), "demo-ch-deal", "#7d6a9e"),
          cc("demo-cc-5", 860, 340, 220, 130, L("Крепость Раскола", "Fortress of the Sundering"), L("Отряд достигает крепости в поисках клинка", "The party reaches the fortress in search of the blade"), "demo-ch-fortress", "#a4483c"),
          cc("demo-cc-6", 860, 160, 220, 130, L("Библиотека", "The library"), L("Астра щадит Тейна", "Astra spares Thane"), "demo-ch-thane", "#c06c84"),
          cc("demo-cc-7", 1100, 340, 220, 130, L("Клинок", "The blade"), L("Кого он признает?", "Whom will it accept?"), "demo-ch-blade", "#c9944a"),
          cc("demo-cc-8", 860, 560, 220, 110, "", L("Несса может оказаться дочерью Эдвина", "Nessa may turn out to be Edwin's daughter"), null, null, ent("character", C.nessa.id)),
          cc("demo-cc-note", 140, 420, 220, 130, "", L("Идея: показать сон Астры о родителях – может, где-то между главой 3 и 4?", "Idea: Astra's dream about her parents – maybe somewhere between chapter 3 and 4?")),
        ],
        edges: [
          { id: "demo-ce-1", fromId: "demo-cc-1", toId: "demo-cc-2", label: L("вынуждает бежать", "forces them to flee") },
          { id: "demo-ce-2", fromId: "demo-cc-2", toId: "demo-cc-3", label: L("десять лет спустя", "ten years later") },
          { id: "demo-ce-3", fromId: "demo-cc-3", toId: "demo-cc-4", label: L("нужен проводник", "needs a guide") },
          { id: "demo-ce-4", fromId: "demo-cc-4", toId: "demo-cc-5", label: L("ведёт к цели", "leads to the goal") },
          { id: "demo-ce-5", fromId: "demo-cc-3", toId: "demo-cc-6", label: L("во дворец", "into the palace") },
          { id: "demo-ce-6", fromId: "demo-cc-5", toId: "demo-cc-7", label: L("склеп", "the crypt") },
          { id: "demo-ce-7", fromId: "demo-cc-8", toId: "demo-cc-7", label: L("право крови?", "blood right?") },
        ],
        groups: [
          { id: "demo-cg-1", x: 120, y: 120, w: 500, h: 200, title: manuscript.folders[0].name, color: "#a4483c" },
          { id: "demo-cg-2", x: 600, y: 120, w: 740, h: 380, title: L("Части II–III", "Parts II–III"), color: "#4f7d74" },
        ],
        shapes: [],
      },
      // «От руки»: все виды фигур — прямоугольник, ромб, эллипс, линия,
      // стрелка, карандаш, надписи тремя шрифтами, картинка.
      "demo-canvas-plot2": {
        id: "demo-canvas-plot2", name: L("Заговор Варна", "Varn's conspiracy"), style: "hand",
        cards: [
          cc("demo-k-varn", 420, 80, 200, 100, "", L("Мозг заговора", "The mind behind the plot"), null, "#a4483c", ent("character", C.varn.id)),
          cc("demo-k-meira", 120, 300, 200, 100, "", L("Обещан храм", "Promised a temple"), null, "#9c3d54", ent("character", C.meira.id)),
          cc("demo-k-damian", 720, 300, 200, 100, "", L("Шпион среди изгнанников", "A spy among the exiles"), null, null, ent("character", C.damian.id)),
          cc("demo-k-gate", 420, 470, 200, 100, L("Кто открыл ворота?", "Who opened the gates?"), L("Главная тайна части I", "The central mystery of part I"), "demo-ch-1", "#c9944a"),
          cc("demo-k-cult", 120, 620, 200, 90, "", "", null, null, ent("faction", "demo-f-cult")),
          cc("demo-k-temple", 720, 620, 200, 90, "", L("Там хранится ключ?", "Is the key kept there?"), null, null, ent("location", Lc.temple.id)),
        ],
        edges: [
          { id: "demo-ke-1", fromId: "demo-k-varn", toId: "demo-k-meira", label: L("сделка", "bargain") },
          { id: "demo-ke-2", fromId: "demo-k-varn", toId: "demo-k-damian", label: L("платит", "pays") },
          { id: "demo-ke-3", fromId: "demo-k-meira", toId: "demo-k-gate", label: "?" },
          { id: "demo-ke-4", fromId: "demo-k-damian", toId: "demo-k-gate", label: "?" },
          { id: "demo-ke-5", fromId: "demo-k-meira", toId: "demo-k-cult", label: L("ведёт", "leads") },
        ],
        groups: [{ id: "demo-kg-1", x: 90, y: 270, w: 860, h: 160, title: L("Подозреваемые", "Suspects"), color: "#c9944a" }],
        shapes: [
          { id: "demo-ks-1", kind: "rect", x: 1000, y: 60, w: 260, h: 160, stroke: "#a4483c", strokeWidth: 2, roughness: 1, fill: "#a4483c" },
          { id: "demo-ks-2", kind: "text", x: 1020, y: 80, text: L("Улики:\n– ожог Каэля\n– перчатка Хольма\n– пепел на воротах", "Clues:\n– Kael's burn\n– Holm's glove\n– ash on the gates"), fontSize: 20, font: "hand" },
          { id: "demo-ks-3", kind: "diamond", x: 1040, y: 300, w: 180, h: 120, stroke: "#4f7d74", strokeWidth: 2, roughness: 2, fill: "#4f7d74", fillStyle: "cross" },
          { id: "demo-ks-4", kind: "text", x: 1075, y: 345, text: L("Эдвин сам?", "Edwin himself?"), fontSize: 22, font: "hand" },
          { id: "demo-ks-5", kind: "ellipse", x: 380, y: 440, w: 280, h: 160, stroke: "#c9944a", strokeWidth: 4, roughness: 1 },
          { id: "demo-ks-6", kind: "arrow", points: [[1040, 360], [640, 510]], stroke: "#4f7d74", strokeWidth: 2, roughness: 1 },
          { id: "demo-ks-7", kind: "line", points: [[90, 460], [950, 460]], strokeWidth: 1, roughness: 2 },
          { id: "demo-ks-8", kind: "pen", points: [[980, 470], [1000, 455], [1030, 470], [1060, 450], [1090, 475], [1120, 455], [1150, 470]], stroke: "#a4483c", strokeWidth: 2 },
          { id: "demo-ks-9", kind: "image", src: capitalImagePath, x: 1000, y: 540, w: 300, h: 200 },
          { id: "demo-ks-10", kind: "text", x: 1000, y: 750, text: L("План Сольвейна – где ворота", "Solveign plan – where the gates are"), fontSize: 16, font: "ui" },
          { id: "demo-ks-11", kind: "rect", x: 380, y: 750, w: 280, h: 60, fill: "#5a8a5f", fillStyle: "solid", roughness: 0 },
          { id: "demo-ks-12", kind: "text", x: 400, y: 765, text: L("Ответ – в главе 7", "The answer is in chapter 7"), fontSize: 20, font: "book" },
        ],
      },
      // Карточки из мира всех четырёх видов.
      "demo-canvas-cast": {
        id: "demo-canvas-cast", name: L("Ансамбль книги 1", "Book 1 cast"),
        cards: [
          cc("demo-a-1", 100, 100, 220, 110, "", L("Хочет трон, боится его", "Wants the throne, fears it"), null, null, ent("character", C.aster.id)),
          cc("demo-a-2", 400, 100, 220, 110, "", "", null, null, ent("character", C.kael.id)),
          cc("demo-a-3", 700, 100, 220, 110, "", L("Тайная дочь?", "A secret daughter?"), null, null, ent("character", C.nessa.id)),
          cc("demo-a-4", 100, 320, 220, 110, "", "", null, null, ent("faction", "demo-f-vieren")),
          cc("demo-a-5", 400, 320, 220, 110, "", L("Финал книги", "The book's finale"), null, null, ent("location", Lc.fortress.id)),
          cc("demo-a-6", 700, 320, 220, 110, "", L("Кульминация", "The climax"), null, "#c9944a", ent("chapter", "demo-ch-blade")),
        ],
        edges: [
          { id: "demo-ae-1", fromId: "demo-a-2", toId: "demo-a-1", label: L("учит", "teaches") },
          { id: "demo-ae-2", fromId: "demo-a-3", toId: "demo-a-1", label: L("ведёт", "guides") },
          { id: "demo-ae-3", fromId: "demo-a-1", toId: "demo-a-4", label: L("наследница", "heir") },
          { id: "demo-ae-4", fromId: "demo-a-1", toId: "demo-a-5", label: L("цель", "goal") },
          { id: "demo-ae-5", fromId: "demo-a-5", toId: "demo-a-6", label: L("здесь", "here") },
        ],
        groups: [],
        shapes: [],
      },
    },
  };

  // ── Знания ──────────────────────────────
  const fact = (id, ru, en, noteRu, noteEn, entries) => ({ id, label: L(ru, en), note: L(noteRu, noteEn),
    entries: Object.fromEntries(Object.entries(entries).map(([k, ch]) => [C[k].id, ch || KNOWS_FROM_START])) });
  const knowledge = {
    facts: [
      fact("demo-k-1", "Где спрятан Раскольный клинок", "Where the Sundering Blade is hidden", "Артефакт, легитимизирующий притязания на трон", "An artifact that legitimizes a claim to the throne",
        { aster: "demo-ch-2", kael: null, osten: null, nessa: "demo-ch-mountains", meira: "demo-ch-council" }),
      fact("demo-k-2", "Кто отдал приказ убить Дом Вирен", "Who ordered House Viren's death", "", "",
        { aster: null, varn: null, garrett: null, meira: null, nessa: "demo-ch-2", thane: "demo-ch-thane" }),
      fact("demo-k-3", "Несса – возможно, дочь Эдвина", "Nessa may be Edwin's daughter", "Наверняка не знает даже сама Несса", "Not even Nessa knows for sure",
        { ada: null, ulv: null, soren: "demo-ch-deal", nessa: "demo-ch-deal" }),
      fact("demo-k-4", "Кто открыл ворота в Ночь Пепла", "Who opened the gates on the Night of Ash", "Ответ в главе 7", "Answered in chapter 7",
        { garrett: null, damian: null, aster: "demo-ch-fortress" }),
      fact("demo-k-5", "Астра в Сольвейне", "Astra is in Solveign", "", "",
        { nessa: "demo-ch-2", thane: "demo-ch-thane", damian: "demo-ch-council", varn: "demo-ch-council" }),
      fact("demo-k-6", "Элейн отравили", "Elaine was poisoned", "Подозрение Тейна", "Thane's suspicion",
        { thane: null, meira: null, aster: "demo-ch-thane" }),
      fact("demo-k-7", "Тайный ход за библиотекой", "The secret passage behind the library", "", "",
        { aster: null, mother: null, thane: "demo-ch-thane" }),
      fact("demo-k-8", "Ровена хочет править сама", "Rowena wants to rule alone", "", "",
        { rowena: null, ulv: "demo-ch-council" }),
    ],
  };

  return { characters, locations, relationships, factions, timeline, board, map, manuscript, canvas, knowledge };
}
