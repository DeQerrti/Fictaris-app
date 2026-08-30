// Связный тестовый сюжет для кнопки «Заполнить примером» — по духу
// демо из брифа ("Хроники Раскола Троп"): персонажи, локации, связи,
// фракции, таймлайн, доска, карта и пара глав рукописи, всё ссылается
// друг на друга. Раньше карта сюда не входила (заполняла все вкладки,
// кроме неё) — теперь функция асинхронная: рисует холст-заглушку и
// заливает его через /api/map/image, как обычная загрузка картинки
// пользователем, а map.json ссылается на полученный путь.
import { apiPost } from "./api.js";

// Простая карта-заглушка, нарисованная на <canvas> — тот же приём, что
// в image-compress.js: рисуем, берём dataURL, отрезаем префикс до base64.
// Реального изображения-подложки не нужно: смысл демо-карты в метках,
// а не в художественной ценности фона.
function buildDemoMapImage() {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 800;
  const ctx = canvas.getContext("2d");

  const grad = ctx.createLinearGradient(0, 0, 1200, 800);
  grad.addColorStop(0, "#e8d9b5");
  grad.addColorStop(1, "#cdb583");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1200, 800);

  ctx.strokeStyle = "#6b5636";
  ctx.lineWidth = 10;
  ctx.strokeRect(16, 16, 1168, 768);

  ctx.fillStyle = "#4a3b22";
  ctx.font = "bold 42px serif";
  ctx.textAlign = "center";
  ctx.fillText("Побережье Раскола", 600, 90);

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

  const characters = [aster, kael, varn, nessa];

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

  const { path: mapImagePath } = await apiPost("/api/map/image", { data: buildDemoMapImage(), ext: "jpg" });
  const map = {
    rootIds: ["demo-map-coast"],
    maps: {
      "demo-map-coast": {
        id: "demo-map-coast",
        name: "Побережье Раскола",
        imageRelPath: mapImagePath,
        pins: [
          { id: "demo-pin-fortress", x: 74, y: 22, label: fortress.name, note: "", characterId: null, locationId: fortress.id, linkedMapId: null },
          { id: "demo-pin-capital", x: 28, y: 38, label: capital.name, note: "", characterId: null, locationId: capital.id, linkedMapId: null },
          { id: "demo-pin-harbor", x: 46, y: 72, label: harbor.name, note: "", characterId: null, locationId: harbor.id, linkedMapId: null },
        ],
      },
    },
  };

  return { characters, locations, relationships, factions, timeline, board, map, manuscript };
}
