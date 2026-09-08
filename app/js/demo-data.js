// Связный тестовый сюжет для кнопки «Заполнить примером» — по духу
// демо из брифа ("Хроники Раскола Троп"): персонажи, локации, связи,
// фракции, таймлайн, доска, карта (карты — во множественном числе, см.
// ниже), карта сюжета, знания и пара глав рукописи, всё ссылается друг
// на друга. Карта — асинхронно: рисует холст-заглушку и заливает его
// через /api/map/image, как обычная загрузка картинки пользователем, а
// map.json ссылается на полученный путь.
import { apiPost } from "./api.js";
import { KNOWS_FROM_START } from "./knowledge.js";

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
  const aster = { id: "demo-c-aster", name: "Астра Вирен", color: "#c9944a",
    role: "Изгнанная наследница", age: "24", appearance: "Шрам через бровь, серебряная прядь в чёрных волосах",
    personality: "Упряма, скрытна, верна немногим", motivation: "Вернуть себе Дом Вирен",
    goal: "Найти Раскольный клинок", flaws: "Не умеет просить о помощи", backstory: "Изгнана после переворота десять лет назад",
    tags: "протагонист, изгнанница" };
  const kael = { id: "demo-c-kael", name: "Каэль Дорн", color: "#4f7d74",
    role: "Наставник-отступник", age: "51", appearance: "Седая борода, ожог на левой руке",
    personality: "Циничен, но заботлив", motivation: "Искупить старую ошибку",
    goal: "Уберечь Астру от своей же судьбы", flaws: "Пьёт, когда страшно", backstory: "Бывший рыцарь Раскола, предал орден",
    tags: "наставник" };
  const varn = { id: "demo-c-varn", name: "Лорд Варн", color: "#a4483c",
    role: "Узурпатор", age: "47", appearance: "Безупречно одет, холодный взгляд",
    personality: "Расчётлив, обаятелен на публике", motivation: "Удержать власть любой ценой",
    goal: "Уничтожить всех наследников Дома Вирен", flaws: "Недооценивает тех, кого считает слабыми",
    backstory: "Организовал переворот против Дома Вирен", tags: "антагонист" };
  const nessa = { id: "demo-c-nessa", name: "Несса", color: "#7d6a9e",
    role: "Контрабандистка", age: "29", appearance: "Татуировки-карты портов по предплечьям",
    personality: "Дружелюбна с виду, торгуется до последнего", motivation: "Разбогатеть и уплыть подальше",
    goal: "Вывезти Астру из города", flaws: "Продаст кого угодно, если цена достаточно высока",
    backstory: "Знает все контрабандные тропы побережья", tags: "союзница, ненадёжная" };

  // Родители Астры (и ниже — отец Варна) — только для родословной
  // (family-tree.js читает character.parentIds), сами не появляются
  // больше нигде в сюжете: без них вкладка «Родословная» у демо-проекта
  // оставалась бы пустой, а без второго, отдельного рода не было бы
  // видно, что дерево умеет показывать несколько родов разом.
  const father = { id: "demo-c-father", name: "Лорд Эдвин Вирен", color: "#9a9250",
    role: "Прежний глава Дома Вирен", age: "†", appearance: "Известен только по портретам",
    personality: "", motivation: "", goal: "", flaws: "", backstory: "Убит во время переворота Варна", tags: "погиб" };
  const mother = { id: "demo-c-mother", name: "Леди Мира Вирен", color: "#6a8fae",
    role: "Прежняя глава Дома Вирен", age: "†", appearance: "Известна только по портретам",
    personality: "", motivation: "", goal: "", flaws: "", backstory: "Убита во время переворота Варна", tags: "погиб" };
  aster.parentIds = [father.id, mother.id];

  // Отец Варна — второй, отдельный род: не связан родителями ни с кем
  // из Дома Вирен выше, поэтому родословная показывает два разных рода
  // отдельными карточками, а не один смешанный список.
  const varnFather = { id: "demo-c-varn-father", name: "Старый Дом Варн", color: "#9a9250",
    role: "Основатель Дома Варн", age: "†", appearance: "",
    personality: "", motivation: "", goal: "", flaws: "", backstory: "Заложил притязания Дома Варн на трон", tags: "погиб" };
  varn.parentIds = [varnFather.id];

  const characters = [aster, kael, varn, nessa, father, mother, varnFather];

  const fortress = { id: "demo-l-fortress", name: "Крепость Раскола", type: "dungeon",
    description: "Полуразрушенный орденский замок в горах", notes: "Здесь хранится клинок", tags: "орден, руины" };
  const capital = { id: "demo-l-capital", name: "Сольвейн", type: "settlement",
    description: "Столица, захваченная Домом Варн", notes: "Резиденция узурпатора", tags: "столица" };
  const harbor = { id: "demo-l-harbor", name: "Портовый квартал Тень", type: "danger",
    description: "Трущобы и контрабандные причалы", notes: "Владения Нессы", tags: "порт, опасно" };
  const blade = { id: "demo-l-blade", name: "Раскольный клинок", type: "treasure",
    description: "Артефакт, легитимизирующий притязания на трон", notes: "Спрятан в крепости", tags: "артефакт" };

  const locations = [fortress, capital, harbor, blade];

  const factions = [
    { id: "demo-f-vieren", name: "Дом Вирен", type: "monarchy",
      description: "Свергнутый правящий род, единственная законная наследница — Астра",
      notes: "", tags: "изгнанники", leaderId: aster.id, headquartersId: fortress.id,
      memberIds: [aster.id, kael.id] },
    { id: "demo-f-legion", name: "Легион Варна", type: "military",
      description: "Военная сила, которой держится узурпация",
      notes: "", tags: "антагонисты", leaderId: varn.id, headquartersId: capital.id,
      memberIds: [varn.id] },
  ];

  const relationships = [
    { id: "demo-r-1", charA: kael.id, charB: aster.id, label: "наставник", score: 70, note: "Учит её десять лет" },
    { id: "demo-r-2", charA: aster.id, charB: varn.id, label: "вражда", score: -90, note: "Он убил её семью" },
    { id: "demo-r-3", charA: aster.id, charB: nessa.id, label: "хрупкий союз", score: 20, note: "Пока платит — помогает" },
  ];

  const timeline = [
    { id: "demo-t-1", order: 1, date: "год 214, весна", title: "Переворот",
      description: "Варн захватывает Сольвейн, семья Астры гибнет",
      characterIds: [varn.id, aster.id], locationIds: [capital.id] },
    { id: "demo-t-2", order: 2, date: "год 214, лето", title: "Бегство",
      description: "Каэль вывозит юную Астру из столицы", characterIds: [kael.id, aster.id], locationIds: [capital.id] },
    { id: "demo-t-3", order: 3, date: "год 224", title: "Возвращение",
      description: "Астра и Каэль прибывают в портовый квартал", characterIds: [aster.id, kael.id, nessa.id], locationIds: [harbor.id] },
    { id: "demo-t-4", order: 4, date: "год 224", title: "Сделка с Нессой",
      description: "Несса соглашается провести их к крепости — за долю от находки",
      characterIds: [aster.id, nessa.id], locationIds: [harbor.id] },
    { id: "demo-t-5", order: 5, date: "год 224", title: "Крепость Раскола",
      description: "Отряд достигает крепости в поисках клинка",
      characterIds: [aster.id, kael.id], locationIds: [fortress.id, blade.id] },
  ];

  const colIdeas = "demo-col-ideas", colProgress = "demo-col-progress", colDone = "demo-col-done";
  const board = {
    columns: [
      { id: colIdeas, title: "Задумано" },
      { id: colProgress, title: "В работе" },
      { id: colDone, title: "Готово" },
    ],
    cards: {
      "demo-card-1": { id: "demo-card-1", title: "Сцена предательства Нессы?", characterId: nessa.id },
      "demo-card-2": { id: "demo-card-2", title: "Прописать бегство из столицы", characterId: kael.id },
      "demo-card-3": { id: "demo-card-3", title: "Переворот — глава 1", characterId: varn.id },
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
        id: "demo-ch-1", title: "Глава 1. Переворот", status: "done",
        content:
          "Сольвейн горел не так, как горят обычные пожары — размеренно, будто по расписанию.\n\n" +
          "Варн стоял на ступенях дворца и смотрел, как гвардейцы Дома Вирен складывают оружие один за другим.",
        authorNotes: "Показать переворот глазами Варна, не Астры — контраст с главой 3.",
      },
      {
        id: "demo-ch-2", title: "Глава 2. Портовый квартал", status: "editing",
        content:
          "Десять лет спустя запах рыбы и смолы всё ещё казался Астре запахом свободы.\n\n" +
          "— Ты платишь вперёд, — сказала Несса, не оборачиваясь. — Так делают все, кому есть что терять.",
        authorNotes: "Нужно больше показать недоверие Каэля к Нессе.",
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
  const [{ path: coastImagePath }, { path: capitalImagePath }] = await Promise.all([
    apiPost("/api/map/image", { data: buildDemoMapImage("Побережье Раскола"), ext: "jpg" }),
    apiPost("/api/map/image", { data: buildDemoMapImage("Сольвейн", "#7d6a9e"), ext: "jpg" }),
  ]);
  const map = {
    rootIds: ["demo-map-coast", "demo-map-capital"],
    maps: {
      "demo-map-coast": {
        id: "demo-map-coast",
        name: "Побережье Раскола",
        imageRelPath: coastImagePath,
        pins: [
          { id: "demo-pin-fortress", x: 74, y: 22, label: fortress.name, note: "", characterId: null, locationId: fortress.id, linkedMapId: null },
          { id: "demo-pin-capital", x: 28, y: 38, label: capital.name, note: "Открыть план города", characterId: null, locationId: capital.id, linkedMapId: "demo-map-capital" },
          { id: "demo-pin-harbor", x: 46, y: 72, label: harbor.name, note: "", characterId: null, locationId: harbor.id, linkedMapId: null },
        ],
      },
      "demo-map-capital": {
        id: "demo-map-capital",
        name: "Сольвейн",
        imageRelPath: capitalImagePath,
        pins: [
          { id: "demo-pin-palace", x: 50, y: 30, label: "Дворец", note: "Резиденция Варна после переворота", characterId: varn.id, locationId: null, linkedMapId: null },
        ],
      },
    },
  };

  // Карта сюжета — те же пять сюжетных точек, что и в таймлайне выше,
  // просто как узлы с направленными связями между ними; не одна точка,
  // а цепочка, иначе не видно, что связи вообще для чего-то нужны.
  const plot = {
    nodes: [
      { id: "demo-p-1", title: "Переворот", note: "Варн захватывает Сольвейн, семья Астры гибнет", chapterLabel: "Глава 1", x: 140, y: 160 },
      { id: "demo-p-2", title: "Бегство", note: "Каэль вывозит юную Астру из столицы", chapterLabel: "Глава 1", x: 380, y: 160 },
      { id: "demo-p-3", title: "Возвращение", note: "Астра и Каэль прибывают в портовый квартал десять лет спустя", chapterLabel: "Глава 2", x: 620, y: 160 },
      { id: "demo-p-4", title: "Сделка с Нессой", note: "Несса соглашается провести их к крепости — за долю от находки", chapterLabel: "", x: 620, y: 340 },
      { id: "demo-p-5", title: "Крепость Раскола", note: "Отряд достигает крепости в поисках клинка", chapterLabel: "", x: 860, y: 340 },
    ],
    edges: [
      { id: "demo-pe-1", from: "demo-p-1", to: "demo-p-2", label: "вынуждает бежать" },
      { id: "demo-pe-2", from: "demo-p-2", to: "demo-p-3", label: "десять лет спустя" },
      { id: "demo-pe-3", from: "demo-p-3", to: "demo-p-4", label: "нужен проводник" },
      { id: "demo-pe-4", from: "demo-p-4", to: "demo-p-5", label: "ведёт к цели" },
    ],
  };

  // Знания — два факта, у каждого несколько персонажей на разных
  // главах (а не один факт с одним персонажем — тогда было бы не
  // видно, зачем вообще заводить несколько строк в одном факте).
  const knowledge = {
    facts: [
      {
        id: "demo-k-1",
        label: "Где спрятан Раскольный клинок",
        note: "Артефакт, легитимизирующий притязания на трон",
        entries: { [aster.id]: "demo-ch-2", [kael.id]: KNOWS_FROM_START },
      },
      {
        id: "demo-k-2",
        label: "Кто отдал приказ убить Дом Вирен",
        note: "",
        entries: { [aster.id]: KNOWS_FROM_START, [varn.id]: KNOWS_FROM_START, [nessa.id]: "demo-ch-2" },
      },
    ],
  };

  return { characters, locations, relationships, factions, timeline, board, map, manuscript, plot, knowledge };
}
