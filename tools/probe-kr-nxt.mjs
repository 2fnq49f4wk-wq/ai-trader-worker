/* [V33.512] ★한국 장후(15:40~20:00 KST · 넥스트레이드 애프터마켓)에 우리 시세가 REGULAR 로 찍힌다★
   운영(10/07 17:41 KST): mstate_kr {REGULAR 418, POST 28} · 시세 나이 0.6분(계속 갱신) · 네이버 폴링 ms "OPEN".
   정규장(15:30) 이 끝났는데 네이버 polling 이 ms=OPEN · nv=넥스트레이드 체결가를 주는지, 그때 어떤 필드가 세션을 말하는지 본다.
   우리 /api/state 의 그 종목 quote 와 나란히. 사용법: node tools/probe-kr-nxt.mjs <url> */
const BASE = (process.argv[2] || "").replace(/\/$/, "");
const out = (k, v) => console.log("NXT " + k + " " + (typeof v === "string" ? v : JSON.stringify(v)));
const H = { headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://finance.naver.com" } };
const codes = ["005930", "000660", "027410", "035720", "247540", "069500"];
out("utc", new Date().toISOString());
try {
  const r = await fetch("https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:" + codes.join(","), H);
  const j = await r.json();
  const datas = (j && j.result && j.result.areas && j.result.areas[0] && j.result.areas[0].datas) || [];
  out("poll_http", { http: r.status, n: datas.length, time: j && j.result && j.result.time });
  for (const d of datas) {
    const slim = {};
    for (const [k, v] of Object.entries(d)) slim[k] = (v && typeof v === "object") ? JSON.stringify(v).slice(0, 600) : v;
    out("poll_" + d.cd, slim);
  }
} catch (e) { out("poll_err", String(e.message || e)); }
for (const c of ["005930", "027410"]) {
  for (const p of ["/api/stock/" + c + "/basic", "/api/stock/" + c + "/integration"]) {
    try {
      const r = await fetch("https://m.stock.naver.com" + p, H);
      const t = await r.text();
      out("m" + p.replace(/\//g, "_"), t.slice(0, 1800));
    } catch (e) { out("m_err" + p, String(e.message || e)); }
  }
}
if (BASE) {
  try {
    const r = await fetch(BASE + "/api/state", { headers: { "cache-control": "no-cache" } });
    const j = await r.json();
    const qs = j.quotes || j.quote || {};
    for (const c of codes) {
      const s = Object.keys(qs).find((k) => k.startsWith(c + "."));
      if (s) out("ours_" + s, qs[s]);
    }
  } catch (e) { out("ours_err", String(e.message || e)); }
}
