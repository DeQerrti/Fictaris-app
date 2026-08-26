import { apiGet } from "./api.js";
import { renderManuscript } from "./manuscript.js";
import { renderCharacters } from "./characters.js";

const MODULES = {
  manuscript: renderManuscript,
  characters: renderCharacters,
};

const content = document.getElementById("content");
const navItems = document.querySelectorAll(".nav-item");

async function openModule(name) {
  navItems.forEach((btn) => btn.classList.toggle("active", btn.dataset.module === name));
  content.innerHTML = "";
  await MODULES[name](content);
}

navItems.forEach((btn) => {
  btn.addEventListener("click", () => openModule(btn.dataset.module));
});

async function boot() {
  const info = await apiGet("/api/app/info").catch(() => ({ vaultPath: null }));
  if (!info.vaultPath) {
    location.href = "/welcome";
    return;
  }
  openModule("manuscript");
}

boot();
