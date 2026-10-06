/* [V33.504] ★MEMO 성능이 계속 안 나온다 · 모델 신뢰도★(사용자) — 운영 위원 표(/api/nn-viz?model=overview)와
   최근 로그의 학습·신뢰 줄을 읽어 원인 후보를 고른다(읽기 전용 GET). 사용법: node tools/probe-models.mjs <url> */
const BASE = (process.argv[2] || "").replace(/\/$/, "");
if (!BASE) { console.error("usage: node tools/probe-models.mjs <url>"); process.exit(2); }
const out = (k, v) => console.log("MDL " + k + " " + (typeof v === "string" ? v : JSON.stringify(v)));
const get = async (p) => { const r = await fetch(BASE + p, { headers: { "cache-control": "no-cache" } }); if (!r.ok) throw new Error(p + " HTTP " + r.status); return r.json(); };
try {
  const ov = await get("/api/nn-viz?model=overview");
  for (const e of (ov.experts || [])) out("expert", e);
  const rest = Object.assign({}, ov); delete rest.experts;
  out("overview_keys", Object.keys(rest));
  for (const k of Object.keys(rest)) { const s = JSON.stringify(rest[k]); if (s && s.length < 1500) out("ov." + k, rest[k]); else out("ov." + k, (s || "").slice(0, 1500)); }
} catch (e) { out("overview_err", String(e.message || e)); }
try {
  const logs = await get("/api/logs?limit=3000");
  const pick = (re, n) => logs.filter((l) => re.test(l.message || "")).slice(0, n).map((l) => new Date(l.ts).toISOString().slice(5, 16) + " " + l.level + " " + String(l.message).slice(0, 420));
  for (const [tag, re, n] of [["memo", /\[MEMO/, 14], ["seq", /\[SEQ/, 6], ["gbdt", /\[GBDT|GBDT/, 6], ["boost", /\[XGB|\[LGB|\[CAT|BOOST/, 6], ["mind", /\[MIND|위원장/, 6],
    ["trust", /신뢰|trust/i, 10], ["perf", /\[PERF|성과게이트|perf gate/i, 10], ["night", /야간|NIGHT/, 8], ["admit", /admit|입회|퇴출/, 8]]) {
    for (const l of pick(re, n)) out(tag, l);
  }
} catch (e) { out("logs_err", String(e.message || e)); }
