// ══════════════════════════════════════════════
//  ЭКСПОРТ ЭКРАНА В PNG
//
//  По образцу TasteID (app/js/config.js — loadHtml2Canvas, app/js/
//  tierlist.js — сам экспорт): рисуем DOM-узел на <canvas> через
//  html2canvas-pro и скачиваем как картинку. Библиотека — тот же
//  самостоятельный файл (app/js/vendor/html2canvas-pro.min.js, MIT), не
//  CDN: приложение работает без интернета, а скачивание картинки доски
//  не должно от него зависеть. Грузится лениво — тянуть 220КБ ради
//  кнопки, которую нажмут не на каждом открытии, незачем.
// ══════════════════════════════════════════════

let html2canvasPromise = null;
function loadHtml2Canvas() {
  if (typeof html2canvas !== "undefined") return Promise.resolve();
  if (html2canvasPromise) return html2canvasPromise;
  html2canvasPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/js/vendor/html2canvas-pro.min.js";
    script.onload = () => resolve();
    script.onerror = () => {
      html2canvasPromise = null; // даём шанс повторить попытку при следующем клике
      reject(new Error("Не удалось загрузить html2canvas"));
    };
    document.head.appendChild(script);
  });
  return html2canvasPromise;
}

async function exportElementAsPng(element, filename, backgroundColor) {
  await loadHtml2Canvas();
  const canvas = await html2canvas(element, {
    backgroundColor: backgroundColor || getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#14110d",
    scale: 2,
    useCORS: true,
    logging: false,
  });
  const link = document.createElement("a");
  link.download = filename;
  link.href = canvas.toDataURL("image/png");
  // В документ обязательно — на телефоне клик по неприсоединённой
  // ссылке всплывать некуда, и перехват (если он есть) не сработает.
  document.body.appendChild(link);
  link.click();
  link.remove();
}

// getElement — функция, а не сам узел: DOM модуля перерисовывается на
// каждое действие (persist+draw), и узел, пойманный в момент создания
// кнопки, к моменту клика может быть уже отсоединён.
export function buildExportPngButton(getElement, filenameBase) {
  const btn = document.createElement("button");
  btn.className = "btn export-png-btn";
  btn.textContent = "Экспорт в PNG";
  btn.addEventListener("click", async () => {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Готовим…";
    try {
      const el = getElement();
      if (!el) throw new Error("Нечего экспортировать");
      const safeName = filenameBase.replace(/[^a-zA-Zа-яА-Я0-9_\- ]/g, "").trim() || "fictaris";
      await exportElementAsPng(el, `${safeName}.png`);
    } catch (e) {
      alert(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });
  return btn;
}
