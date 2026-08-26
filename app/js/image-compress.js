// Сжатие загружаемого изображения через <canvas> перед отправкой на
// диск (масштаб + JPEG quality) — тот же приём, что в брифе описан для
// исходного браузерного прототипа, только результат уезжает файлом на
// диск, а не base64-строкой в JSON (см. комментарий в vault.js).

export function compressImage(file, maxWidth = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Не удалось прочитать изображение"));
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
