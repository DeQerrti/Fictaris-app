export async function apiGet(path) {
  const res = await fetch(path);
  return res.json();
}

// После записи — событие: сайдбар (sidebar-overview.js) пересчитывает
// счётчики, не зная, какой модуль что сохранил.
export async function apiPost(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  document.dispatchEvent(new CustomEvent("fictaris:data-changed", { detail: { path } }));
  return data;
}

export function uid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
