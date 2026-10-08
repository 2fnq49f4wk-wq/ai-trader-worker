/* [V33.525] 사용량 한도는 ★Cloudflare 실측 CPU★ 로 — 추정(크론 벽시계 × 0.01)은 실제의 ~9배라 85% 자동 셧다운이 헛돈다.
 *   ① 판정식: 실측 + (그 뒤 추정 증가분) · 실측이 없거나 36시간+ 묵었거나 달이 다르면 종전 추정(안전 쪽)
 *   ② 한도를 재는 곳(셧다운·부가조회 중단·alt 슬리브·화면)이 전부 같은 식을 쓴다 — 추정을 직접 나누는 곳이 남지 않는다
 *   ③ 넣는 길은 TRAIN_KEY 만(페이지·익명 거절) · 추정 기록(usage:yyyymm)은 건드리지 않는다
 *   ④ 동기화 스크립트: 행 합산 · 행이 0 이면 넣지 않는다(0 을 실측으로 오인 금지) · 워치독이 실패해도 막히지 않는다 */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const WD = readFileSync(new URL("../.github/workflows/modal-watchdog.yml", import.meta.url), "utf8");
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };
const M = await import("../src/index.js");
const now = Date.now(), mk = new Date().getUTCFullYear() * 100 + new Date().getUTCMonth() + 1;
const est = { mk, data: { cpuMs: 9000000 } };
chk(M._usageCpu(est) === 9000000, "실측 없음 → 추정 그대로");
chk(M._usageCpu(Object.assign({}, est, { actual: { mk, cpuMs: 1000000, at: now - 3600000, estAtSync: 8800000 } })) === 1200000,
  "실측 1.0M + 동기화 뒤 추정 증가 0.2M = 1.2M");
chk(M._usageCpu(Object.assign({}, est, { actual: { mk, cpuMs: 1000000, at: now - 37 * 3600000, estAtSync: 8800000 } })) === 9000000, "36시간 넘게 묵은 실측 → 추정(안전 쪽)");
chk(M._usageCpu(Object.assign({}, est, { actual: { mk: mk - 1, cpuMs: 1000000, at: now, estAtSync: 0 } })) === 9000000, "지난달 실측 → 추정");
chk(!/\(u(sageState|s)?\.data\.cpuMs \|\| 0\) \/ Math\.max\(1, lim\.monthlyCpuMs\)|\(u\.data\.cpuMs\|\|0\)\/Math\.max/.test(S),
  "한도 비율을 추정으로 직접 나누는 곳이 없다(전부 _usageCpu)");
chk((S.match(/_usageCpu\(/g) || []).length >= 10, "셧다운·부가조회·alt·화면·진단 모두 _usageCpu", String((S.match(/_usageCpu\(/g) || []).length));
const ep = S.slice(S.indexOf('if (path === "/api/usage/actual" && request.method === "POST")'), S.indexOf('if (path === "/api/usage/reset")'));
chk(/!env\.TRAIN_KEY \|\| !_safeEq\(k, env\.TRAIN_KEY\)\) return Response\.json\(\{ error: "forbidden" \}, \{ status: 403/.test(ep), "넣는 길은 TRAIN_KEY 만(키 없는 같은 출처 페이지도 거절)");
chk(/setState\(env\.DB, "usage_actual:" \+ mk, rec\)/.test(ep) && !/setState\(env\.DB, "usage:"/.test(ep), "실측은 따로 저장 · 추정 기록은 안 건드린다");
chk(/mk !== u\.mk/.test(ep), "다른 달 값은 거절");
// 행동: 키 없는 POST → 403 (실제 fetch 처리기)
{
  const stmt = () => ({ bind: () => stmt(), all: async () => ({ results: [] }), first: async () => null, run: async () => ({}), raw: async () => [] });
  const DB = { prepare: () => stmt(), batch: async (a) => a.map(() => ({ results: [] })), exec: async () => ({}) };
  const r = await M.default.fetch(new Request("https://x.test/api/usage/actual", { method: "POST", headers: { "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify({ mk, cpuMs: 1 }) }), { DB, TRAIN_KEY: "k" }, { waitUntil() {} });
  chk(r.status === 403, "같은 출처 페이지라도 키 없으면 403", String(r.status));
}
const U = await import("./usage-sync.mjs");
const s = U.sumRows({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: [{ sum: { cpuTimeUs: 1500000, requests: 10 } }, { sum: { cpuTimeUs: 500000, requests: 5 } }] }] } } });
chk(s.rows === 2 && s.cpuMs === 2000 && s.requests === 15, "GraphQL 행 합산(µs → ms)", JSON.stringify(s));
chk(U.sumRows({ data: {} }).rows === 0, "빈 응답은 0행");
const US = readFileSync(new URL("./usage-sync.mjs", import.meta.url), "utf8");
chk(/if \(!s\.rows\) \{ out\("skip"/.test(US), "0행이면 넣지 않는다(0 을 실측으로 오인 금지)");
chk(/scriptName: "\$\{script\}"/.test(U.buildQuery("a", "ai-trader-app", "s", "e")) || /scriptName: "ai-trader-app"/.test(U.buildQuery("a", "ai-trader-app", "s", "e")), "이 워커 스크립트만 센다");
chk(/실사용량 동기화[\s\S]{0,80}continue-on-error: true[\s\S]{0,400}node tools\/usage-sync\.mjs \|\| true/.test(WD), "워치독: 실패해도 학습 감시를 막지 않는다");
// [V33.527] 크론 단계별 시간 — 단계 경계마다 합산 · sleep 은 뺀다 · usage 레코드의 일 합계(stp)로만 남긴다(추가 쓰기 0)
{
  const realNow = Date.now; let t = 1000; Date.now = () => t;
  const p = M._cronProf();
  t += 300; p.mark("a"); t += 500; p.mark("b"); t += 200; p.mark("a"); t += 100; p.mark("end");
  Date.now = realNow;
  chk(p.acc.pre === 300 && p.acc.a === 600 && p.acc.b === 200, "단계별 합산(같은 이름은 더한다)", JSON.stringify(p.acc));
  const marks = (S.match(/__prof\.mark\("[\w.]+"\)/g) || []).length;
  chk(marks >= 25 && /const __prof = _cronProf\(\);/.test(S) && /tickUsage\(env\.DB, __cronStart, __usageCalib, __fetchBudget\.used \|\| 0, __prof\.acc(, __pbNow)?\)/.test(S),
    "크론 경계 " + marks + "곳 · 끝에서 usage 기록과 함께 한 번에 쓴다", String(marks));
  chk(/const d = Math\.max\(0, \(now - p\.t\) - Math\.max\(0, sl - p\.sl\)\);/.test(S), "서브틱 sleep 은 단계 시간에서 뺀다");
}
if (fails) { console.log("\n✗ 실측 사용량 계약 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 실측 사용량 계약 통과");
