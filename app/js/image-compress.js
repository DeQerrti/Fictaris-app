// Сжатие загружаемого изображения через <canvas> перед отправкой на
// диск (масштаб + JPEG quality) — тот же приём, что в брифе описан для
// исходного браузерного прототипа, только результат уезжает файлом на
// диск, а не base64-строкой в JSON (см. комментарий в vault.js).

import { i18n } from "./i18n.js";

export function compressImage(file, maxWidth = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(i18n("Не удалось прочитать файл")));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error(i18n("Не удалось прочитать изображение")));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Карта — не аватарка: мелкие подписи и детали должны пережить загрузку.
// Картинку до 4096 пикселей по ширине кладём как есть, байт в байт;
// крупнее — уменьшаем, но PNG остаётся PNG (без потерь), остальное —
// JPEG высокого качества. ext — расширение для /api/map/image.
const MAP_MAX_WIDTH = 4096;
// Чуть меньше предела /api/map/image (core/api.js, 28 МБ base64).
const MAP_MAX_BASE64 = 26 * 1024 * 1024;

export function prepareMapImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(i18n("Не удалось прочитать файл")));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error(i18n("Не удалось прочитать изображение")));
      img.onload = () => {
        const isPng = /png/i.test(file.type);
        const original = reader.result.slice(reader.result.indexOf(",") + 1);
        const originalExt = isPng ? "png" : /webp/i.test(file.type) ? "webp" : "jpg";
        if (img.width <= MAP_MAX_WIDTH && original.length <= MAP_MAX_BASE64) {
          resolve({ base64: original, ext: originalExt });
          return;
        }
        const scale = Math.min(1, MAP_MAX_WIDTH / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        let dataUrl = isPng ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.92);
        let ext = isPng ? "png" : "jpg";
        // PNG даже после уменьшения бывает больше, чем примет сервер, —
        // тогда уже JPEG.
        if (dataUrl.length > MAP_MAX_BASE64) {
          dataUrl = canvas.toDataURL("image/jpeg", 0.9);
          ext = "jpg";
        }
        resolve({ base64: dataUrl.slice(dataUrl.indexOf(",") + 1), ext });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
