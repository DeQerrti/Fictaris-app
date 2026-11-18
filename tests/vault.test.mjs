// Запись проекта на диск (electron/vault.js — без Electron, чистый Node).
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Vault } from "../electron/vault.js";

async function tempVault() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fictaris-test-"));
  return { root, vault: new Vault(root), cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

const versions = async (root, name) => (await fs.readdir(path.join(root, ".history", name)).catch(() => [])).length;

test("история: одинаковое не копируется, частые правки — одна копия, восстановление — всегда", async () => {
  const { root, vault, cleanup } = await tempVault();
  try {
    await vault.writeJson("characters.json", [{ id: "a", name: "A" }]);
    assert.equal(await versions(root, "characters.json"), 0);
    await vault.writeJson("characters.json", [{ id: "a", name: "A" }]);
    assert.equal(await versions(root, "characters.json"), 0, "то же содержимое — без копии");
    for (let i = 0; i < 10; i++) await vault.writeJson("characters.json", [{ id: "a", name: "B" + i }]);
    assert.equal(await versions(root, "characters.json"), 1, "не чаще раза в 2 минуты");
    await vault.writeJson("characters.json", [{ id: "a", name: "R" }], { forceArchive: true });
    assert.equal(await versions(root, "characters.json"), 2);
    const disk = JSON.parse(await fs.readFile(path.join(root, "characters.json"), "utf8"));
    assert.equal(disk[0].name, "R");
  } finally {
    await cleanup();
  }
});

test("битый JSON не превращается в пустое значение", async () => {
  const { root, vault, cleanup } = await tempVault();
  try {
    await vault.ensure();
    await fs.writeFile(path.join(root, "board.json"), "{ сломано", "utf8");
    await assert.rejects(() => vault.readJson("board.json", { columns: [] }), /испорчен/);
    assert.deepEqual(await vault.readJson("timeline.json", []), [], "отсутствующий файл — значение по умолчанию");
  } finally {
    await cleanup();
  }
});

test("maps/: только картинки, без выхода из папки и без символических ссылок", async () => {
  const { root, vault, cleanup } = await tempVault();
  try {
    await vault.writeImage("maps/a.png", Buffer.from("x").toString("base64"));
    await assert.rejects(() => vault.writeImage("maps/x.exe", "AAAA"));
    await assert.rejects(() => vault.writeImage("maps/../x.png", "AAAA"));
    assert.deepEqual(await vault.listImages(), ["maps/a.png"]);
    const secret = path.join(root, "secret.txt");
    await fs.writeFile(secret, "secret");
    let linked = true;
    await fs.symlink(secret, path.join(root, "maps", "link.png")).catch(() => (linked = false));
    if (linked) await assert.rejects(() => vault.readImage("maps/link.png"), /Ссылка/);
  } finally {
    await cleanup();
  }
});
