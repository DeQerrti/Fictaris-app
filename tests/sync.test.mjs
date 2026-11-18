// Синхронизация (app/js/sync.js) на имитации GitHub API в памяти.
import { test } from "node:test";
import assert from "node:assert/strict";

const b64 = (t) => Buffer.from(t, "utf8").toString("base64");
const repo = new Map(); // путь → { sha, content }
let shaN = 0;
const put = (p, content) => {
  const sha = "sha" + ++shaN;
  repo.set(p, { sha, content });
  return sha;
};
let backup = null;
const calls = [];

globalThis.fetch = async (url, init = {}) => {
  const u = typeof url === "string" ? url : url.url;
  const method = (init.method || "GET").toUpperCase();
  calls.push(`${method} ${u}`);
  const json = (data, status = 200) => ({ ok: status < 300, status, json: async () => data });
  let m;
  if (u === "/api/export-backup") return json(backup);
  if (/\/repos\/o\/r$/.test(u)) return json({ default_branch: "main" });
  if (/\/git\/trees\//.test(u)) return json({ tree: [...repo].map(([p, v]) => ({ path: p, sha: v.sha, type: "blob" })) });
  if ((m = /\/git\/blobs\/(\w+)$/.exec(u))) {
    const e = [...repo.values()].find((v) => v.sha === m[1]);
    return json({ content: e.content.replace(/(.{60})/g, "$1\n"), encoding: "base64" });
  }
  if ((m = /\/contents\/(.+)$/.exec(u)) && method === "PUT") {
    const p = decodeURIComponent(m[1]);
    const body = JSON.parse(init.body);
    const cur = repo.get(p);
    if (cur && body.sha !== cur.sha) return json({ message: "sha mismatch" }, 409);
    return json({ content: { sha: put(p, body.content) } });
  }
  if ((m = /\/contents\/(.+)$/.exec(u)) && method === "DELETE") {
    const p = decodeURIComponent(m[1]);
    const cur = repo.get(p);
    if (!cur) return json({ message: "Not Found" }, 404);
    if (JSON.parse(init.body).sha !== cur.sha) return json({ message: "sha mismatch" }, 409);
    repo.delete(p);
    return json({ commit: {} });
  }
  return json({}, 404);
};

const sync = await import("../app/js/sync.js");
sync.setSyncVault("v1", 1);
const cfg = { token: "t", owner: "o", repo: "r" };
const file = (v) => b64(JSON.stringify(v, null, 2));

test("синхронизация: большие файлы, картинки с другого устройства, конфликт", async () => {
  const big = "x".repeat(2_000_000);
  backup = { files: { "manuscript.json": { chapters: [{ content: big }] }, "characters.json": [{ id: "a" }] }, images: { "maps/a.png": b64("A") } };
  let r = await sync.runSync(cfg);
  assert.equal(r.pushed, 3);

  put("maps/b.png", b64("B"));
  put("characters.json", file([{ id: "a" }, { id: "b" }]));
  r = await sync.runSync(cfg);
  assert.deepEqual(Object.keys(r.pulledFiles), ["characters.json"]);
  assert.deepEqual(Object.keys(r.pulledImages), ["maps/b.png"]);

  backup.files["characters.json"] = [{ id: "a" }, { id: "b" }];
  backup.images["maps/b.png"] = b64("B");
  backup.files["manuscript.json"] = { chapters: [{ content: big + "LOCAL" }] };
  put("manuscript.json", file({ chapters: [{ content: big + "REMOTE" }] }));
  r = await sync.runSync(cfg);
  assert.deepEqual(r.conflicts.map((c) => c.path), ["manuscript.json"]);
  assert.ok(Buffer.from(r.conflicts[0].remote.base64, "base64").toString().includes("REMOTE"), "содержимое большого файла пришло целиком");

  await sync.resolveConflict(cfg, r.conflicts[0], "remote");
  backup.files["manuscript.json"] = { chapters: [{ content: big + "REMOTE" }] };
  calls.length = 0;
  r = await sync.runSync(cfg);
  assert.equal(r.conflicts.length, 0);
  assert.equal(calls.filter((c) => /blobs/.test(c)).length, 0, "без изменений — без скачивания содержимого");
});

test("синхронизация: настройки своего проекта, чужие не видны", () => {
  sync.saveSyncConfig({ token: "A", owner: "o", repo: "a" });
  sync.setSyncVault("v2", 2);
  assert.equal(sync.getSyncConfig(), null);
  sync.setSyncVault("v1", 2);
  assert.equal(sync.getSyncConfig().repo, "a");
});

test("синхронизация: удаление картинки переносится в обе стороны, правка важнее удаления", async () => {
  sync.setSyncVault("v3", 3);
  sync.saveSyncConfig(cfg);
  repo.clear();
  backup = { files: {}, images: { "maps/x.png": b64("X"), "maps/y.png": b64("Y"), "maps/z.png": b64("Z") } };
  await sync.runSync(cfg);
  assert.ok(repo.has("maps/x.png"));

  // Здесь удалили x — удаляется и в репозитории.
  delete backup.images["maps/x.png"];
  // В репозитории удалили y — удаляется здесь.
  repo.delete("maps/y.png");
  // В репозитории удалили z, а здесь его изменили — правка остаётся и уходит обратно.
  backup.images["maps/z.png"] = b64("Z2");
  let r = await sync.runSync(cfg);
  assert.equal(repo.has("maps/x.png"), false, "удалено в репозитории");
  assert.deepEqual(r.deletedImages, ["maps/y.png"]);
  assert.ok(repo.has("maps/z.png"), "изменённая картинка вернулась в репозиторий");
  assert.equal(sync.hasPulled(r), true);

  // Повторная синхронизация: ничего не возвращается и не удаляется снова.
  delete backup.images["maps/y.png"];
  r = await sync.runSync(cfg);
  assert.deepEqual(r.deletedImages, []);
  assert.equal(Object.keys(r.pulledImages).length, 0);
  assert.equal(repo.has("maps/x.png"), false);
});
