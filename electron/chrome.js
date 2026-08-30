// ══════════════════════════════════════════════
//  РАМКА ОКНА
//
//  Системная рамка со своим заголовком и значком выглядела чужой поверх
//  тёмной страницы: полоса Windows в её собственных цветах и шрифте, а
//  под ней — тема Fictaris, да ещё название и иконка приложения
//  дублировали то, что уже красиво нарисовано в самом интерфейсе (см.
//  .brand в сайдбаре). TasteID решает это своей рамкой (electron/chrome.js
//  у него) — берём тот же приём.
//
//  Как: titleBarStyle "hidden" убирает системный заголовок целиком (в
//  т.ч. значок и подпись), а titleBarOverlay возвращает три кнопки
//  свернуть/развернуть/закрыть — их рисует сама система, но уже в цветах
//  темы. На macOS кнопки («светофоры») рисует система сама везде —
//  прячем только полосу заголовка над ними, hiddenInset.
//
//  Взамен окно нужно чем-то таскать: у безрамочного окна нет полосы, за
//  которую его двигают мышью. Отсюда titleBarCss() ниже — пустая полоса
//  сверху с -webkit-app-region: drag.
// ══════════════════════════════════════════════

// Высота полосы. 36 — чуть выше стандартных кнопок Windows (32px), чтобы
// не жались вплотную к краю.
export const TITLEBAR_HEIGHT = 36;

export function titleBarOptions(platform, colors) {
  if (platform === "darwin") {
    return { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: 11 } };
  }
  return {
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: colors.bg,
      symbolColor: colors.symbol,
      height: TITLEBAR_HEIGHT,
    },
  };
}

// Цвета по умолчанию — ровно то, что лежит в :root и [data-skin="light"]
// в app/style.css. Используются до первой отрисовки страницы (когда ещё
// не с чем сверяться) и на экране приветствия, у которого своя, всегда
// тёмная, разметка без CSS-переменных. Живые цвета после загрузки
// страницы берутся уже из её собственных вычисленных --bg/--text-dim —
// см. applyTitleBarColors в electron/main.js — так рамка совпадает и с
// акцентом, который человек мог перекрасить вручную.
export function overlayColors(skin) {
  return skin === "light" ? { bg: "#f3ead9", symbol: "#5c4d34" } : { bg: "#14110d", symbol: "#a99977" };
}

export function titleBarCss() {
  return `
    :root { --app-titlebar: ${TITLEBAR_HEIGHT}px; }

    /* Полоса, за которую окно таскают мышью. Фон совпадает со страницей,
       поэтому системная рамка и сама тема выглядят единым целым — а не
       чужой полосой над контентом. Фолбэк на #14110d — для экрана
       приветствия (electron/ui/welcome.html), у него своя разметка без
       переменной --bg. */
    html::before {
      content: "";
      position: fixed;
      top: 0; left: 0; right: 0;
      height: var(--app-titlebar);
      background: var(--bg, #14110d);
      -webkit-app-region: drag;
      z-index: 10000;
      pointer-events: auto;
    }

    /* #app — flex-контейнер на всю высоту окна (см. app/style.css) — не
       трогаем через body/padding: у него фиксированная высота 100vh, и
       обычный padding-top на body просто обрезал бы низ окна на высоту
       полосы. Сдвигаем и ужимаем сам #app — так низ остаётся на месте. */
    #app {
      height: calc(100vh - var(--app-titlebar)) !important;
      margin-top: var(--app-titlebar);
    }

    /* Оверлей поиска перекрывает и полосу тоже — иначе её верхний край
       мог бы просвечивать поверх него. */
    .search-overlay { z-index: 10001; }
  `;
}
