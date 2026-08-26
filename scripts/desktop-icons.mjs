// Иконки для десктопа и браузерной вкладки из resources/icon.png.
//
// Запускают руками, когда меняется логотип:
//   node scripts/desktop-icons.mjs
// Результат кладётся в app/icons и коммитится.
//
// .ico собирается вручную: формат ICO допускает хранить внутри обычный
// PNG (а не только BMP), достаточно правильно оформить заголовок —
// тянуть ImageMagick или sharp ради одного файла не стоит.

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const SOURCE = join(ROOT, "resources/icon.png");
const OUT_DIR = join(ROOT, "app/icons");
mkdirSync(OUT_DIR, { recursive: true });

const source = "data:image/png;base64," + readFileSync(SOURCE).toString("base64");
const SIZES = [16, 32, 180, 512];

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();

const shots = await page.evaluate(
  async ({ source, sizes }) => {
    const img = new Image();
    img.src = source;
    await img.decode();
    const out = {};
    for (const size of sizes) {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      c.getContext("2d").drawImage(img, 0, 0, size, size);
      out[size] = c.toDataURL("image/png");
    }
    return out;
  },
  { source, sizes: SIZES }
);
await browser.close();

const png = (size) => Buffer.from(shots[size].split(",")[1], "base64");

writeFileSync(join(OUT_DIR, "favicon-16x16.png"), png(16));
writeFileSync(join(OUT_DIR, "favicon-32x32.png"), png(32));
writeFileSync(join(OUT_DIR, "apple-touch-icon.png"), png(180));
writeFileSync(join(OUT_DIR, "icon-512.png"), png(512));

// ICO: заголовок (6 байт) + одна запись каталога (16 байт) + PNG-данные.
// Формат допускает хранить кадр как есть в PNG, если ширина/высота в
// заголовке кадра выставлены в 0 (значит "256 и больше").
function buildIco(pngBuffer, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // image count

  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0); // width
  entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
  entry.writeUInt8(0, 2); // palette
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(pngBuffer.length, 8); // data size
  entry.writeUInt32LE(header.length + entry.length, 12); // data offset

  return Buffer.concat([header, entry, pngBuffer]);
}

writeFileSync(join(OUT_DIR, "favicon.ico"), buildIco(png(32), 32));

console.log("иконки для десктопа готовы");
