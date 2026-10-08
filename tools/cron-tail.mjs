/* [V33.536] ★크론 단계별 '진짜 CPU' 를 가른다★ (CI: ui-probe tail=true · 워커에 쓰지 않는다)
 * 워커 안 Date.now 는 계산 중 멈춰 단계 시간(_cronProf)은 CPU 가 아니다. 그러나 wrangler tail 은 호출마다 Cloudflare 가 잰
 * cpuTime 을 준다. 크론은 끝에 "CRONPROF {s: 단계별 활성ms, f: fetch 수}" 한 줄을 남긴다 → 같은 호출의 CPU 와 짝짓는다.
 * 단계는 저마다 주기가 달라(라벨링 30분 · 수집기 회전 …) 호출마다 도는 조합이 바뀐다 → 단계가 '돈 호출' vs '안 돈 호출' 의 CPU 차이
 * 와 최소제곱(단계 활성 여부 → CPU)로 단계별 CPU 를 추정한다. 요청(fetch) 호출은 경로별 CPU 합계.
 * 사용법: CLOUDFLARE_API_TOKEN=… node tools/cron-tail.mjs <scriptName> <초> */
import { spawn } from "node:child_process";
const SCRIPT = process.argv[2] || "ai-trader-app";
const SECS = +(process.argv[3] || 900);
const out = (k, v) => console.log("TAIL " + k + " " + (typeof v === "string" ? v : JSON.stringify(v)));
const ev = [];
let buf = "", sample = null;
const p = spawn("npx", ["-y", "wrangler@3", "tail", SCRIPT, "--format", "json"], { stdio: ["ignore", "pipe", "pipe"], env: process.env });
p.stderr.on("data", (d) => { const t = String(d); if (/error|fail/i.test(t)) out("stderr", t.slice(0, 300)); });
p.stdout.on("data", (d) => {
  buf += String(d);
  // wrangler 은 이벤트마다 여러 줄 JSON 을 낸다 — 중괄호 균형으로 자른다
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") { if (depth === 0) start = i; depth++; }
    else if (c === "}") { depth--; if (depth === 0 && start >= 0) {
      try { const o = JSON.parse(buf.slice(start, i + 1)); ev.push(o); if (!sample) sample = o; } catch (e) {}
      buf = buf.slice(i + 1); i = -1; start = -1; } }
  }
});
await new Promise((r) => setTimeout(r, SECS * 1000));
p.kill("SIGINT");
await new Promise((r) => setTimeout(r, 3000));

if (sample) out("sample_keys", Object.keys(sample).concat(sample.event ? ["event:" + Object.keys(sample.event).join("|")] : []));
const cpuOf = (o) => { for (const k of ["cpuTime", "cpuTimeMs", "cpu_time"]) if (typeof o[k] === "number") return o[k]; return null; };
const wallOf = (o) => { for (const k of ["wallTime", "wallTimeMs"]) if (typeof o[k] === "number") return o[k]; return null; };
const crons = [], reqs = {};
for (const o of ev) {
  const cpu = cpuOf(o);
  const e = o.event || {};
  if (e.cron || e.scheduledTime) {
    let prof = null;
    for (const l of (o.logs || [])) { const m = [].concat(l.message || []).join(" "); const i = m.indexOf("CRONPROF "); if (i >= 0) { try { prof = JSON.parse(m.slice(i + 9)); } catch (x) {} } }
    crons.push({ cpu, wall: wallOf(o), prof, outcome: o.outcome });
  } else if (e.request) {
    let path = "?"; try { path = new URL(e.request.url).pathname.replace(/\/[0-9A-Za-z.\-_^=%]{12,}$/, "/*"); } catch (x) {}
    const r = reqs[path] || (reqs[path] = { n: 0, cpu: 0 }); r.n++; r.cpu += cpu || 0;
  }
}
out("events", { total: ev.length, crons: crons.length, withCpu: crons.filter((c) => c.cpu != null).length, withProf: crons.filter((c) => c.prof).length });
const C = crons.filter((c) => c.cpu != null && c.prof);
if (!C.length) { out("note", "CPU 시간 또는 CRONPROF 가 없다 — sample_keys 확인"); process.exit(0); }
const tot = C.reduce((a, c) => a + c.cpu, 0);
out("cron_cpu", { n: C.length, meanMs: Math.round(tot / C.length), p50: C.map((c) => c.cpu).sort((a, b) => a - b)[Math.floor(C.length / 2)], max: Math.max(...C.map((c) => c.cpu)) });
for (const c of C.slice(0, 40)) out("cron", c.cpu + "ms wall=" + c.wall + " f=" + c.prof.f + " " + Object.entries(c.prof.s).filter(([, v]) => v >= 200).map(([k, v]) => k + ":" + v).join(" "));
// 단계별: 돈(활성 ≥200ms) 호출 vs 안 돈 호출의 평균 CPU 차
const steps = [...new Set(C.flatMap((c) => Object.keys(c.prof.s)))];
const rows = [];
for (const s of steps) {
  const on = C.filter((c) => (c.prof.s[s] || 0) >= 200), off = C.filter((c) => (c.prof.s[s] || 0) < 200);
  if (on.length < 2 || off.length < 2) continue;
  const m = (a) => a.reduce((x, c) => x + c.cpu, 0) / a.length;
  rows.push([s, on.length, off.length, Math.round(m(on) - m(off))]);
}
rows.sort((a, b) => b[3] - a[3]);
out("step_delta", rows.slice(0, 25).map((r) => r[0] + " 돈" + r[1] + "/안돈" + r[2] + " ΔCPU " + r[3] + "ms"));
// 최소제곱: cpu ≈ b0 + Σ b_s · [s 활성] + Σ b_k · 작업량_k (능선 0.1 — 표본이 적어도 터지지 않게)
//   [V33.537] 작업량(c): ev 평가 종목 · sc 단타 스캔 · mb 분봉 조회 · ai AI 후보 · cand 진입 후보 — 단위당 CPU(ms)를 준다
const CK = ["ev", "sc", "mb", "ai", "cand"].filter((k) => C.some((c) => c.prof.c && (c.prof.c[k] || 0) > 0));
if (CK.length) out("work", C.slice(0, 30).map((c) => c.cpu + "ms " + CK.map((k) => k + "=" + ((c.prof.c || {})[k] || 0)).join(",")));
const S = rows.map((r) => r[0]).slice(0, 12);
if ((S.length || CK.length) && C.length > S.length + CK.length + 5) {
  const X = C.map((c) => [1].concat(S.map((s) => ((c.prof.s[s] || 0) >= 200 ? 1 : 0)), CK.map((k) => (c.prof.c || {})[k] || 0))), y = C.map((c) => c.cpu);
  const k = S.length + CK.length + 1, A = Array.from({ length: k }, () => new Array(k).fill(0)), b = new Array(k).fill(0);
  for (let i = 0; i < X.length; i++) for (let a = 0; a < k; a++) { b[a] += X[i][a] * y[i]; for (let c2 = 0; c2 < k; c2++) A[a][c2] += X[i][a] * X[i][c2]; }
  for (let a = 1; a < k; a++) A[a][a] += 0.1;
  for (let col = 0; col < k; col++) { let piv = col; for (let r2 = col + 1; r2 < k; r2++) if (Math.abs(A[r2][col]) > Math.abs(A[piv][col])) piv = r2;
    [A[col], A[piv]] = [A[piv], A[col]]; [b[col], b[piv]] = [b[piv], b[col]];
    for (let r2 = 0; r2 < k; r2++) if (r2 !== col) { const f = A[r2][col] / (A[col][col] || 1e-9); for (let c2 = col; c2 < k; c2++) A[r2][c2] -= f * A[col][c2]; b[r2] -= f * b[col]; } }
  const beta = b.map((v, i) => v / (A[i][i] || 1e-9));
  const share = S.map((s, i) => [s, Math.round(beta[i + 1]), C.filter((c) => (c.prof.s[s] || 0) >= 200).length]);
  out("ols", "기저(매분 공통) " + Math.round(beta[0]) + "ms · " + share.sort((a, b2) => b2[1] - a[1]).map((r) => r[0] + " " + r[1] + "ms×" + r[2]).join(" · "));
  if (CK.length) out("ols_work", CK.map((kk, i) => kk + " " + beta[S.length + 1 + i].toFixed(2) + "ms/개").join(" · "));
}
out("fetch_paths", Object.entries(reqs).sort((a, b) => b[1].cpu - a[1].cpu).slice(0, 15).map(([k, v]) => k + " n" + v.n + " cpu" + Math.round(v.cpu) + "ms"));
