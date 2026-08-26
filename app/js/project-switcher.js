import { apiGet, apiPost } from "./api.js";
import { i18n } from "./i18n.js";

const btn = document.getElementById("projectBtn");
const menu = document.getElementById("projectMenu");

function closeMenu() {
  menu.style.display = "none";
  menu.innerHTML = "";
}

async function pickAndUse() {
  const picked = await apiPost("/api/app/pick-vault", {});
  if (!picked.path) return;
  const used = await apiPost("/api/app/use-vault", { path: picked.path });
  if (used.error) {
    alert(used.error);
    return;
  }
  location.reload();
}

// На телефоне нечего выбирать, кроме названия — своего проводника нет
// (см. mobile/src/main.js, appRoutes/"add-vault").
function promptForNameRow(onCreate) {
  const row = document.createElement("div");
  row.className = "project-row";
  const input = document.createElement("input");
  input.className = "project-row-input";
  input.placeholder = i18n("Название проекта");
  const create = document.createElement("button");
  create.className = "project-row-del";
  create.textContent = "✓";
  create.title = i18n("Создать");
  create.addEventListener("click", (e) => {
    e.stopPropagation();
    if (input.value.trim()) onCreate(input.value.trim());
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && input.value.trim()) onCreate(input.value.trim());
  });
  row.append(input, create);
  return { row, input };
}

function renameRow(v, onDone) {
  const input = document.createElement("input");
  input.className = "project-row-input";
  input.value = v.name;
  const finish = async () => {
    const name = input.value.trim();
    if (name && name !== v.name) await apiPost("/api/app/rename-vault", { id: v.id, name });
    onDone();
  };
  input.addEventListener("blur", finish);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
  });
  return input;
}

async function openMenu() {
  const info = await apiGet("/api/app/info");
  menu.innerHTML = "";

  for (const v of info.vaults || []) {
    const row = document.createElement("div");
    row.className = "project-row" + (v.id === info.currentVaultId ? " active" : "");

    const nameBtn = document.createElement("button");
    nameBtn.className = "project-row-name";
    nameBtn.textContent = v.name;
    if (v.path) nameBtn.title = v.path;
    nameBtn.addEventListener("click", async () => {
      if (v.id === info.currentVaultId) return;
      await apiPost("/api/app/switch-vault", { id: v.id });
      location.reload();
    });
    row.appendChild(nameBtn);

    const renameBtn = document.createElement("button");
    renameBtn.className = "project-row-del";
    renameBtn.textContent = "✎";
    renameBtn.title = i18n("Переименовать");
    renameBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const input = renameRow(v, openMenu);
      nameBtn.replaceWith(input);
      input.focus();
      input.select();
    });
    row.appendChild(renameBtn);

    if ((info.vaults || []).length > 1) {
      const delBtn = document.createElement("button");
      delBtn.className = "project-row-del";
      delBtn.textContent = "✕";
      delBtn.title = info.mobile
        ? i18n("Удалить проект вместе с файлами — это необратимо")
        : i18n("Убрать из списка (файлы на диске не трогает)");
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (delBtn.dataset.confirm === "1") {
          const res = await apiPost("/api/app/remove-vault", { id: v.id });
          if (res.error) {
            alert(res.error);
            return;
          }
          openMenu();
          return;
        }
        delBtn.dataset.confirm = "1";
        delBtn.textContent = "?";
        setTimeout(() => {
          delBtn.dataset.confirm = "";
          delBtn.textContent = "✕";
        }, 3000);
      });
      row.appendChild(delBtn);
    }

    menu.appendChild(row);
  }

  const divider = document.createElement("div");
  divider.className = "project-menu-divider";
  menu.appendChild(divider);

  if (info.mobile) {
    const addBtn = document.createElement("button");
    addBtn.className = "project-row-name";
    addBtn.textContent = i18n("+ Новый проект…");
    addBtn.addEventListener("click", () => {
      const { row, input } = promptForNameRow(async (name) => {
        const res = await apiPost("/api/app/add-vault", { name });
        if (res.error) {
          alert(res.error);
          return;
        }
        location.reload();
      });
      addBtn.replaceWith(row);
      input.focus();
    });
    menu.appendChild(addBtn);
  } else {
    const addBtn = document.createElement("button");
    addBtn.className = "project-row-name";
    addBtn.textContent = i18n("+ Другой проект…");
    addBtn.addEventListener("click", pickAndUse);
    menu.appendChild(addBtn);
  }

  menu.style.display = "block";
}

export async function initProjectSwitcher() {
  const info = await apiGet("/api/app/info").catch(() => ({ vaults: [], currentVaultId: null }));
  const current = (info.vaults || []).find((v) => v.id === info.currentVaultId);
  btn.textContent = current ? current.name : i18n("Проект");

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu.style.display === "block") closeMenu();
    else openMenu();
  });
  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target) && e.target !== btn) closeMenu();
  });
}
