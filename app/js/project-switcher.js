import { apiGet, apiPost } from "./api.js";

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

async function openMenu() {
  const info = await apiGet("/api/app/info");
  menu.innerHTML = "";

  for (const v of info.vaults || []) {
    const row = document.createElement("div");
    row.className = "project-row" + (v.id === info.currentVaultId ? " active" : "");

    const nameBtn = document.createElement("button");
    nameBtn.className = "project-row-name";
    nameBtn.textContent = v.name;
    nameBtn.title = v.path;
    nameBtn.addEventListener("click", async () => {
      if (v.id === info.currentVaultId) return;
      await apiPost("/api/app/switch-vault", { id: v.id });
      location.reload();
    });
    row.appendChild(nameBtn);

    if ((info.vaults || []).length > 1) {
      const delBtn = document.createElement("button");
      delBtn.className = "project-row-del";
      delBtn.textContent = "✕";
      delBtn.title = "Убрать из списка (файлы на диске не трогает)";
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const res = await apiPost("/api/app/remove-vault", { id: v.id });
        if (res.error) {
          alert(res.error);
          return;
        }
        openMenu();
      });
      row.appendChild(delBtn);
    }

    menu.appendChild(row);
  }

  const divider = document.createElement("div");
  divider.className = "project-menu-divider";
  menu.appendChild(divider);

  const addBtn = document.createElement("button");
  addBtn.className = "project-row-name";
  addBtn.textContent = "+ Другой проект…";
  addBtn.addEventListener("click", pickAndUse);
  menu.appendChild(addBtn);

  menu.style.display = "block";
}

export async function initProjectSwitcher() {
  const info = await apiGet("/api/app/info").catch(() => ({ vaults: [], currentVaultId: null }));
  const current = (info.vaults || []).find((v) => v.id === info.currentVaultId);
  btn.textContent = current ? current.name : "Проект";

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu.style.display === "block") closeMenu();
    else openMenu();
  });
  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target) && e.target !== btn) closeMenu();
  });
}
