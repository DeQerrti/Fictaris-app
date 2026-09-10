// Связный тестовый сюжет для кнопки «Заполнить примером» — по духу
// демо из брифа ("Хроники Раскола Троп"): персонажи, локации, связи,
// фракции, таймлайн, доска, карта (карты — во множественном числе, см.
// ниже), карта сюжета, знания и пара глав рукописи, всё ссылается друг
// на друга. Карта — асинхронно: рисует холст-заглушку и заливает его
// через /api/map/image, как обычная загрузка картинки пользователем, а
// map.json ссылается на полученный путь.
//
// Язык контента — по текущему языку интерфейса (i18n.js, currentLang):
// L(ru, en) ниже просто выбирает нужную половину для каждого текстового
// поля. Структура (id, связи между сущностями, координаты, цвета) одна
// на оба языка — переведено только то, что видно человеку; так тексты
// не могут разъехаться с самими связями сюжета при правке одного языка.
import { apiPost } from "./api.js";
import { KNOWS_FROM_START } from "./knowledge.js";
import { currentLang } from "./i18n.js";

// Простая карта-заглушка, нарисованная на <canvas> — тот же приём, что
// в image-compress.js: рисуем, берём dataURL, отрезаем префикс до base64.
// Реального изображения-подложки не нужно: смысл демо-карты в метках,
// а не в художественной ценности фона. title/accent — чтобы вторую
// карту (Сольвейн) не рисовать копипастой той же функции с одной
// заменённой строкой: демо нарочно заводит две карты, не одну — иначе
// не было бы видно, что «Карта» вообще умеет несколько штук разом
// (переключатель карт в map.js для одной карты просто не появляется).
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

export async function buildDemoBundle() {
  const en = currentLang() === "en";
  const L = (ru, enText) => (en ? enText : ru);

  const aster = { id: "demo-c-aster", name: L("Астра Вирен", "Astra Viren"), color: "#c9944a",
    role: L("Изгнанная наследница", "Exiled heir"), age: "24",
    appearance: L("Шрам через бровь, серебряная прядь в чёрных волосах", "A scar through one eyebrow, a streak of silver in black hair"),
    personality: L("Упряма, скрытна, верна немногим", "Stubborn, guarded, loyal to few"),
    motivation: L("Вернуть себе Дом Вирен", "Reclaim House Viren"),
    goal: L("Найти Раскольный клинок", "Find the Sundering Blade"),
    flaws: L("Не умеет просить о помощи", "Can't ask for help"),
    backstory: L("Изгнана после переворота десять лет назад", "Exiled after the coup ten years ago"),
    tags: L("протагонист, изгнанница", "protagonist, exile") };
  const kael = { id: "demo-c-kael", name: L("Каэль Дорн", "Kael Dorn"), color: "#4f7d74",
    role: L("Наставник-отступник", "Renegade mentor"), age: "51",
    appearance: L("Седая борода, ожог на левой руке", "Grey beard, a burn scar on his left arm"),
    personality: L("Циничен, но заботлив", "Cynical but caring"),
    motivation: L("Искупить старую ошибку", "Atone for an old mistake"),
    goal: L("Уберечь Астру от своей же судьбы", "Keep Astra from his own fate"),
    flaws: L("Пьёт, когда страшно", "Drinks when he's afraid"),
    backstory: L("Бывший рыцарь Раскола, предал орден", "Former Knight of the Sundering, betrayed the order"),
    tags: L("наставник", "mentor") };
  const varn = { id: "demo-c-varn", name: L("Лорд Варн", "Lord Varn"), color: "#a4483c",
    role: L("Узурпатор", "Usurper"), age: "47",
    appearance: L("Безупречно одет, холодный взгляд", "Impeccably dressed, a cold stare"),
    personality: L("Расчётлив, обаятелен на публике", "Calculating, charming in public"),
    motivation: L("Удержать власть любой ценой", "Hold power at any cost"),
    goal: L("Уничтожить всех наследников Дома Вирен", "Destroy every heir of House Viren"),
    flaws: L("Недооценивает тех, кого считает слабыми", "Underestimates those he thinks weak"),
    backstory: L("Организовал переворот против Дома Вирен", "Orchestrated the coup against House Viren"),
    tags: L("антагонист", "antagonist") };
  const nessa = { id: "demo-c-nessa", name: L("Несса", "Nessa"), color: "#7d6a9e",
    role: L("Контрабандистка", "Smuggler"), age: "29",
    appearance: L("Татуировки-карты портов по предплечьям", "Tattooed port maps running up her forearms"),
    personality: L("Дружелюбна с виду, торгуется до последнего", "Friendly on the surface, haggles to the last coin"),
    motivation: L("Разбогатеть и уплыть подальше", "Get rich and sail far away"),
    goal: L("Вывезти Астру из города", "Get Astra out of the city"),
    flaws: L("Продаст кого угодно, если цена достаточно высока", "Will sell out anyone for the right price"),
    backstory: L("Знает все контрабандные тропы побережья", "Knows every smuggling route along the coast"),
    tags: L("союзница, ненадёжная", "ally, unreliable") };

  // Родители Астры (и ниже — отец Варна) — только для родословной
  // (family-tree.js читает character.parentIds), сами не появляются
  // больше нигде в сюжете: без них вкладка «Родословная» у демо-проекта
  // оставалась бы пустой, а без второго, отдельного рода не было бы
  // видно, что дерево умеет показывать несколько родов разом.
  const father = { id: "demo-c-father", name: L("Лорд Эдвин Вирен", "Lord Edwin Viren"), color: "#9a9250",
    role: L("Прежний глава Дома Вирен", "Former head of House Viren"), age: "†",
    appearance: L("Известен только по портретам", "Known only from portraits"),
    personality: "", motivation: "", goal: "", flaws: "",
    backstory: L("Убит во время переворота Варна", "Killed during Varn's coup"), tags: L("погиб", "deceased") };
  const mother = { id: "demo-c-mother", name: L("Леди Мира Вирен", "Lady Mira Viren"), color: "#6a8fae",
    role: L("Прежняя глава Дома Вирен", "Former head of House Viren"), age: "†",
    appearance: L("Известна только по портретам", "Known only from portraits"),
    personality: "", motivation: "", goal: "", flaws: "",
    backstory: L("Убита во время переворота Варна", "Killed during Varn's coup"), tags: L("погиб", "deceased") };
  aster.parentIds = [father.id, mother.id];

  // Отец Варна — второй, отдельный род: не связан родителями ни с кем
  // из Дома Вирен выше, поэтому родословная показывает два разных рода
  // отдельными карточками, а не один смешанный список.
  const varnFather = { id: "demo-c-varn-father", name: L("Старый Дом Варн", "Old House Varn"), color: "#9a9250",
    role: L("Основатель Дома Варн", "Founder of House Varn"), age: "†", appearance: "",
    personality: "", motivation: "", goal: "", flaws: "",
    backstory: L("Заложил притязания Дома Варн на трон", "Laid House Varn's claim to the throne"), tags: L("погиб", "deceased") };
  varn.parentIds = [varnFather.id];

  const characters = [aster, kael, varn, nessa, father, mother, varnFather];

  const fortress = { id: "demo-l-fortress", name: L("Крепость Раскола", "Fortress of the Sundering"), type: "dungeon",
    description: L("Полуразрушенный орденский замок в горах", "A half-ruined order castle in the mountains"),
    notes: L("Здесь хранится клинок", "The blade is kept here"), tags: L("орден, руины", "order, ruins") };
  const capital = { id: "demo-l-capital", name: L("Сольвейн", "Solveign"), type: "settlement",
    description: L("Столица, захваченная Домом Варн", "The capital, seized by House Varn"),
    notes: L("Резиденция узурпатора", "The usurper's residence"), tags: L("столица", "capital") };
  const harbor = { id: "demo-l-harbor", name: L("Портовый квартал Тень", "Shade Docks"), type: "danger",
    description: L("Трущобы и контрабандные причалы", "Slums and smuggler's wharves"),
    notes: L("Владения Нессы", "Nessa's territory"), tags: L("порт, опасно", "port, dangerous") };
  const blade = { id: "demo-l-blade", name: L("Раскольный клинок", "The Sundering Blade"), type: "treasure",
    description: L("Артефакт, легитимизирующий притязания на трон", "An artifact that legitimizes a claim to the throne"),
    notes: L("Спрятан в крепости", "Hidden in the fortress"), tags: L("артефакт", "artifact") };

  const locations = [fortress, capital, harbor, blade];

  const factions = [
    { id: "demo-f-vieren", name: L("Дом Вирен", "House Viren"), type: "monarchy",
      description: L("Свергнутый правящий род, единственная законная наследница – Астра", "The deposed ruling house — its only legitimate heir is Astra"),
      notes: "", tags: L("изгнанники", "exiles"), leaderId: aster.id, headquartersId: fortress.id,
      memberIds: [aster.id, kael.id] },
    { id: "demo-f-legion", name: L("Легион Варна", "Varn's Legion"), type: "military",
      description: L("Военная сила, которой держится узурпация", "The military force propping up the usurpation"),
      notes: "", tags: L("антагонисты", "antagonists"), leaderId: varn.id, headquartersId: capital.id,
      memberIds: [varn.id] },
  ];

  const relationships = [
    { id: "demo-r-1", charA: kael.id, charB: aster.id, label: L("наставник", "mentor"), score: 70, note: L("Учит её десять лет", "Has taught her for ten years") },
    { id: "demo-r-2", charA: aster.id, charB: varn.id, label: L("вражда", "feud"), score: -90, note: L("Он убил её семью", "He killed her family") },
    { id: "demo-r-3", charA: aster.id, charB: nessa.id, label: L("хрупкий союз", "fragile alliance"), score: 20, note: L("Пока платит – помогает", "Helps as long as she's paid") },
  ];

  const timeline = [
    { id: "demo-t-1", order: 1, date: L("год 214, весна", "year 214, spring"), title: L("Переворот", "The Coup"),
      description: L("Варн захватывает Сольвейн, семья Астры гибнет", "Varn seizes Solveign, Astra's family dies"),
      characterIds: [varn.id, aster.id], locationIds: [capital.id] },
    { id: "demo-t-2", order: 2, date: L("год 214, лето", "year 214, summer"), title: L("Бегство", "The Escape"),
      description: L("Каэль вывозит юную Астру из столицы", "Kael smuggles young Astra out of the capital"), characterIds: [kael.id, aster.id], locationIds: [capital.id] },
    { id: "demo-t-3", order: 3, date: L("год 224", "year 224"), title: L("Возвращение", "The Return"),
      description: L("Астра и Каэль прибывают в портовый квартал", "Astra and Kael arrive at the docks"), characterIds: [aster.id, kael.id, nessa.id], locationIds: [harbor.id] },
    { id: "demo-t-4", order: 4, date: L("год 224", "year 224"), title: L("Сделка с Нессой", "The Deal with Nessa"),
      description: L("Несса соглашается провести их к крепости – за долю от находки", "Nessa agrees to guide them to the fortress — for a cut of what they find"),
      characterIds: [aster.id, nessa.id], locationIds: [harbor.id] },
    { id: "demo-t-5", order: 5, date: L("год 224", "year 224"), title: L("Крепость Раскола", "Fortress of the Sundering"),
      description: L("Отряд достигает крепости в поисках клинка", "The party reaches the fortress in search of the blade"),
      characterIds: [aster.id, kael.id], locationIds: [fortress.id, blade.id] },
  ];

  const colIdeas = "demo-col-ideas", colProgress = "demo-col-progress", colDone = "demo-col-done";
  const board = {
    columns: [
      { id: colIdeas, title: L("Задумано", "Planned") },
      { id: colProgress, title: L("В работе", "In progress") },
      { id: colDone, title: L("Готово", "Done") },
    ],
    cards: {
      "demo-card-1": { id: "demo-card-1", title: L("Сцена предательства Нессы?", "Nessa's betrayal scene?"), characterId: nessa.id },
      "demo-card-2": { id: "demo-card-2", title: L("Прописать бегство из столицы", "Write out the escape from the capital"), characterId: kael.id },
      "demo-card-3": { id: "demo-card-3", title: L("Переворот – глава 1", "The coup — chapter 1"), characterId: varn.id },
    },
    cardOrder: {
      [colIdeas]: ["demo-card-1"],
      [colProgress]: ["demo-card-2"],
      [colDone]: ["demo-card-3"],
    },
  };

  const manuscript = {
    chapters: [
      {
        id: "demo-ch-1", title: L("Глава 1. Переворот", "Chapter 1. The Coup"), status: "done",
        content: L(
          "Сольвейн горел не так, как горят обычные пожары – размеренно, будто по расписанию.\n\n" +
          "Варн стоял на ступенях дворца и смотрел, как гвардейцы Дома Вирен складывают оружие один за другим.",
          "Solveign burned unlike ordinary fires — steady, almost on schedule.\n\n" +
          "Varn stood on the palace steps, watching House Viren's guards lay down their weapons, one after another."
        ),
        authorNotes: L("Показать переворот глазами Варна, не Астры – контраст с главой 3.", "Show the coup through Varn's eyes, not Astra's — contrast with chapter 3."),
      },
      {
        id: "demo-ch-2", title: L("Глава 2. Портовый квартал", "Chapter 2. The Docks"), status: "editing",
        content: L(
          "Десять лет спустя запах рыбы и смолы всё ещё казался Астре запахом свободы.\n\n" +
          "– Ты платишь вперёд, – сказала Несса, не оборачиваясь. – Так делают все, кому есть что терять.",
          "Ten years later, the smell of fish and tar still felt like freedom to Astra.\n\n" +
          "\"You pay up front,\" Nessa said without turning around. \"That's how it's done by anyone with something to lose.\""
        ),
        authorNotes: L("Нужно больше показать недоверие Каэля к Нессе.", "Need to show more of Kael's distrust of Nessa."),
      },
    ],
    activeChapterId: "demo-ch-1",
  };

  // Две карты, не одна — иначе не видно, что «Карта» вообще умеет
  // несколько штук разом (переключатель списка карт для одной-единственной
  // просто не появляется). Метка столицы на первой карте вдобавок
  // ссылается на вторую через linkedMapId — тот же переход "открыть
  // план города", каким обычно и пользуются: metка ведёт на карту
  // помельче, а не всё держат одним изображением.
  const coastTitle = L("Побережье Раскола", "Sundering Coast");
  const capitalTitle = L("Сольвейн", "Solveign");
  const [{ path: coastImagePath }, { path: capitalImagePath }] = await Promise.all([
    apiPost("/api/map/image", { data: buildDemoMapImage(coastTitle), ext: "jpg" }),
    apiPost("/api/map/image", { data: buildDemoMapImage(capitalTitle, "#7d6a9e"), ext: "jpg" }),
  ]);
  const map = {
    rootIds: ["demo-map-coast", "demo-map-capital"],
    maps: {
      "demo-map-coast": {
        id: "demo-map-coast",
        name: coastTitle,
        imageRelPath: coastImagePath,
        pins: [
          { id: "demo-pin-fortress", x: 74, y: 22, label: fortress.name, note: "", characterId: null, locationId: fortress.id, linkedMapId: null },
          { id: "demo-pin-capital", x: 28, y: 38, label: capital.name, note: L("Открыть план города", "Open the city map"), characterId: null, locationId: capital.id, linkedMapId: "demo-map-capital" },
          { id: "demo-pin-harbor", x: 46, y: 72, label: harbor.name, note: "", characterId: null, locationId: harbor.id, linkedMapId: null },
        ],
      },
      "demo-map-capital": {
        id: "demo-map-capital",
        name: capitalTitle,
        imageRelPath: capitalImagePath,
        pins: [
          { id: "demo-pin-palace", x: 50, y: 30, label: L("Дворец", "Palace"), note: L("Резиденция Варна после переворота", "Varn's residence after the coup"), characterId: varn.id, locationId: null, linkedMapId: null },
        ],
      },
    },
  };

  // Карта сюжета — те же пять сюжетных точек, что и в таймлайне выше,
  // просто как узлы с направленными связями между ними; не одна точка,
  // а цепочка, иначе не видно, что связи вообще для чего-то нужны.
  const chapter1Label = L("Глава 1", "Chapter 1");
  const chapter2Label = L("Глава 2", "Chapter 2");
  const plot = {
    nodes: [
      { id: "demo-p-1", title: L("Переворот", "The Coup"), note: L("Варн захватывает Сольвейн, семья Астры гибнет", "Varn seizes Solveign, Astra's family dies"), chapterLabel: chapter1Label, x: 140, y: 160 },
      { id: "demo-p-2", title: L("Бегство", "The Escape"), note: L("Каэль вывозит юную Астру из столицы", "Kael smuggles young Astra out of the capital"), chapterLabel: chapter1Label, x: 380, y: 160 },
      { id: "demo-p-3", title: L("Возвращение", "The Return"), note: L("Астра и Каэль прибывают в портовый квартал десять лет спустя", "Astra and Kael arrive at the docks, ten years later"), chapterLabel: chapter2Label, x: 620, y: 160 },
      { id: "demo-p-4", title: L("Сделка с Нессой", "The Deal with Nessa"), note: L("Несса соглашается провести их к крепости – за долю от находки", "Nessa agrees to guide them to the fortress — for a cut of what they find"), chapterLabel: "", x: 620, y: 340 },
      { id: "demo-p-5", title: L("Крепость Раскола", "Fortress of the Sundering"), note: L("Отряд достигает крепости в поисках клинка", "The party reaches the fortress in search of the blade"), chapterLabel: "", x: 860, y: 340 },
    ],
    edges: [
      { id: "demo-pe-1", from: "demo-p-1", to: "demo-p-2", label: L("вынуждает бежать", "forces them to flee") },
      { id: "demo-pe-2", from: "demo-p-2", to: "demo-p-3", label: L("десять лет спустя", "ten years later") },
      { id: "demo-pe-3", from: "demo-p-3", to: "demo-p-4", label: L("нужен проводник", "needs a guide") },
      { id: "demo-pe-4", from: "demo-p-4", to: "demo-p-5", label: L("ведёт к цели", "leads to the goal") },
    ],
  };

  // Знания — два факта, у каждого несколько персонажей на разных
  // главах (а не один факт с одним персонажем — тогда было бы не
  // видно, зачем вообще заводить несколько строк в одном факте).
  const knowledge = {
    facts: [
      {
        id: "demo-k-1",
        label: L("Где спрятан Раскольный клинок", "Where the Sundering Blade is hidden"),
        note: L("Артефакт, легитимизирующий притязания на трон", "An artifact that legitimizes a claim to the throne"),
        entries: { [aster.id]: "demo-ch-2", [kael.id]: KNOWS_FROM_START },
      },
      {
        id: "demo-k-2",
        label: L("Кто отдал приказ убить Дом Вирен", "Who ordered House Viren's death"),
        note: "",
        entries: { [aster.id]: KNOWS_FROM_START, [varn.id]: KNOWS_FROM_START, [nessa.id]: "demo-ch-2" },
      },
    ],
  };

  return { characters, locations, relationships, factions, timeline, board, map, manuscript, plot, knowledge };
}
