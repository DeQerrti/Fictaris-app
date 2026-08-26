// Иконки приложения для Android из resources/icon.png, resources/icon-foreground.png
// и resources/icon-background.png.
//
// Запускают руками, когда меняется логотип:
//   node scripts/android-icons.mjs
// Результат кладётся в android/app/src/main/res и коммитится — сборке
// APK ни этот скрипт, ни браузер не нужны.
//
// Рисует Chromium из playwright: другого способа изменить размер
// картинки в этом проекте нет (ни sharp, ни ImageMagick в зависимостях
// нет и тянуть их ради нескольких файлов не стоит).
//
// icon-foreground.png уже нарисован прозрачным и вписан в безопасную
// зону адаптивной иконки (см. resources/icon-foreground.html), поэтому
// его не нужно ни обрезать по яркости, ни ужимать — только промасштабировать
// под каждую плотность экрана. Фон адаптивной иконки — сплошной цвет,
// он задан в android/app/src/main/res/values/ic_launcher_background.xml.

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = (() => {
  try {
    return require("playwright");
  } catch {
    return require(join(execFileSync("npm", ["root", "-g"]).toString().trim(), "playwright"));
  }
})();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RES = join(ROOT, "android/app/src/main/res");
const ICON = join(ROOT, "resources/icon.png");
const FOREGROUND = join(ROOT, "resources/icon-foreground.png");

// Плотности экрана Android: mdpi — базовая, дальше кратно.
const DENSITY = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const LAUNCHER = 48; // dp
const ADAPTIVE = 108; // dp — размер холста адаптивной иконки, включая обрезаемые поля

const icon = "data:image/png;base64," + readFileSync(ICON).toString("base64");
const foreground = "data:image/png;base64," + readFileSync(FOREGROUND).toString("base64");

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();

const shots = await page.evaluate(
  async ({ icon, foreground, densities, launcher, adaptive }) => {
    const load = async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      return img;
    };
    const [iconImg, fgImg] = await Promise.all([load(icon), load(foreground)]);

    const canvas = (size) => {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      return [c, c.getContext("2d")];
    };

    const out = {};
    for (const [name, k] of Object.entries(densities)) {
      const size = Math.round(launcher * k);

      const [square, sq] = canvas(size);
      sq.drawImage(iconImg, 0, 0, size, size);
      out[`mipmap-${name}/ic_launcher.png`] = square.toDataURL("image/png");

      const [round, rd] = canvas(size);
      rd.beginPath();
      rd.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      rd.clip();
      rd.drawImage(iconImg, 0, 0, size, size);
      out[`mipmap-${name}/ic_launcher_round.png`] = round.toDataURL("image/png");

      const big = Math.round(adaptive * k);
      const [fore, fg] = canvas(big);
      fg.drawImage(fgImg, 0, 0, big, big);
      out[`mipmap-${name}/ic_launcher_foreground.png`] = fore.toDataURL("image/png");
    }
    return out;
  },
  { icon, foreground, densities: DENSITY, launcher: LAUNCHER, adaptive: ADAPTIVE }
);

for (const [path, data] of Object.entries(shots)) {
  writeFileSync(join(RES, path), Buffer.from(data.split(",")[1], "base64"));
  console.log("  " + path);
}

await browser.close();
console.log("иконки готовы");
