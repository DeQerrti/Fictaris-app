import { apiPost } from "./api.js";
import { compressImage } from "./image-compress.js";
import { i18n } from "./i18n.js";

// ══════════════════════════════════════════════
//  АВАТАРКИ
//
//  Общий виджет для персонажей/локаций/фракций — раньше на карточке был
//  только цветовой индикатор, теперь можно приложить сколько угодно
//  изображений (первое становится аватаркой на лицевой стороне
//  карточки, остальные — просто галерея в дровере). Файлы уезжают на
//  диск тем же путём, что и картинки карты (POST /api/map/image →
//  vault.saveImage) — эндпоинт назван по карте исторически, но ничего
//  специфичного для карты не делает, просто кладёт файл в vault и
//  возвращает путь; sущность хранит только относительный путь
//  (entity.images: string[]), не сам файл.
// ══════════════════════════════════════════════

export function firstImage(entity) {
  return Array.isArray(entity.images) && entity.images[0] ? entity.images[0] : null;
}

// fallbackHtml — то, что рисовалось на аватарке раньше (инициалы,
// иконка типа) — используется, пока изображений нет ни одного.
export function avatarInnerHtml(entity, fallbackHtml) {
  const src = firstImage(entity);
  return src ? `<img class="char-avatar-img" src="/${src}" alt="">` : fallbackHtml;
}

async function uploadOne(file) {
  const base64 = await compressImage(file);
  const ext = /png/i.test(file.type) ? "png" : "jpg";
  const { path } = await apiPost("/api/map/image", { data: base64, ext });
  return path;
}

// onChange зовётся после каждого добавления/удаления — обычно persist()
// + draw() у вызывающей стороны, как и у остальных полей дровера.
export function buildAvatarsField(entity, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "field avatars-field";
  const label = document.createElement("label");
  label.textContent = i18n("Изображения");
  wrap.appendChild(label);

  const grid = document.createElement("div");
  grid.className = "avatar-grid";
  wrap.appendChild(grid);

  function renderGrid() {
    grid.innerHTML = "";
    for (const [i, src] of (entity.images || []).entries()) {
      const item = document.createElement("div");
      item.className = "avatar-thumb";
      const img = document.createElement("img");
      img.src = `/${src}`;
      img.alt = "";
      item.appendChild(img);

      const del = document.createElement("button");
      del.type = "button";
      del.className = "avatar-thumb-del";
      del.textContent = "×";
      del.title = i18n("Удалить изображение");
      del.addEventListener("click", () => {
        entity.images.splice(i, 1);
        renderGrid();
        onChange();
      });
      item.appendChild(del);
      grid.appendChild(item);
    }

    const addLabel = document.createElement("label");
    addLabel.className = "avatar-thumb avatar-thumb-add";
    addLabel.title = i18n("Добавить изображение");
    addLabel.textContent = "+";
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.hidden = true;
    input.addEventListener("change", async () => {
      const files = Array.from(input.files || []);
      input.value = "";
      if (!files.length) return;
      entity.images = entity.images || [];
      for (const file of files) {
        entity.images.push(await uploadOne(file));
      }
      renderGrid();
      onChange();
    });
    addLabel.appendChild(input);
    grid.appendChild(addLabel);
  }
  renderGrid();

  return wrap;
}
