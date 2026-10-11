/* [V33.545] /api/state 무게 분해 — 첫 방문 5.3s 중 state(800KB)가 무엇으로 찼나. 최상위 키별 JSON 바이트(큰 순) · 2단계 큰 키도. 읽기만 한다. */
const BASE = (process.argv[2] || "").replace(/\/$/, "");
const r = await fetch(BASE + "/api/state");
const j = await r.json();
const sz = (v) => JSON.stringify(v === undefined ? null : v).length;
const tot = sz(j);
console.log("STATE total " + (tot / 1024).toFixed(0) + "KB · keys " + Object.keys(j).length);
const top = Object.entries(j).map(([k, v]) => [k, sz(v)]).sort((a, b) => b[1] - a[1]).slice(0, 15);
for (const [k, n] of top) {
  const v = j[k];
  let sub = "";
  if (v && typeof v === "object") {
    const it = Array.isArray(v) ? v.slice(0, 1).map((x) => ["[0]", x]) : Object.entries(v);
    sub = it.map(([a, b]) => [a, sz(b)]).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([a, b]) => a + " " + (b / 1024).toFixed(1) + "KB").join(" · ");
    if (Array.isArray(v)) sub = "배열 " + v.length + "개 · 1개당 ~" + (n / Math.max(1, v.length) / 1024).toFixed(2) + "KB · 예: " + sub;
  }
  console.log("STATE key " + k + " " + (n / 1024).toFixed(1) + "KB (" + (n / tot * 100).toFixed(0) + "%) " + sub);
}
