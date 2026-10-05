/* [V33.486] 미국 실적 서프라이즈 이력 수집기 검사 — 가짜 나스닥 · 가짜 D1 · 가짜 R2 로 ★실행해서★ 본다.
   ① 파서: 유니버스만 · 실제·예상 둘 다 · 괄호 음수 · BRK.B→BRK-B  ② 병합: 같은 (종목·날짜) 한 번 · 오름차순
   ③ 수집: 최근 며칠 + 과거 커서 · 실패한 과거 날에서 멈춤(건너뛰지 않음) · 못 읽으면 안 씀  ④ 배선 */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
console.log("① 파서");
const want = new Set(["AAPL", "BRK-B", "XOM"]);
const day = { data: { rows: [
  { symbol: "AAPL", eps: "$1.85", epsForecast: "$1.73" }, { symbol: "BRK.B", eps: "($0.12)", epsForecast: "$0.10" },
  { symbol: "XOM", eps: "N/A", epsForecast: "$2.00" }, { symbol: "ZZZ", eps: "$1", epsForecast: "$1" } ] } };
const rows = M._oeParse(day, 20251030, want);
chk(rows.length === 2 && rows[0][0] === "AAPL" && rows[0][2] === 1.85 && rows[1][0] === "BRK-B" && rows[1][2] === -0.12,
  "유니버스만 · 둘 다 있는 행만 · 괄호 음수 · BRK.B→BRK-B", "★파서가 틀렸다★ " + JSON.stringify(rows));
console.log("② 병합");
const E = M._oeMerge({}, [["AAPL", 20251030, 1.8, 1.7], ["AAPL", 20250730, 1.5, 1.4], ["AAPL", 20251030, 1.85, 1.73]]);
chk(E.AAPL.length === 2 && E.AAPL[0][0] === 20250730 && E.AAPL[1][1] === 1.85, "같은 (종목·날짜)는 한 번(나중 값) · 날짜 오름차순", "★병합이 틀렸다★ " + JSON.stringify(E));
chk(M._oePrevWeekday(20251103) === 20251031 && M._oePrevWeekday(20251104) === 20251103, "전 평일(월→금)", "★평일 계산★");
console.log("③ 수집");
function fakeDB(o = {}) { const st = new Map(); const mk = (sql) => { const q = { a: [] }; q.bind = (...a) => { q.a = a; return q; };
  q.first = async () => { if (/SELECT v FROM state/.test(sql)) { if ((o.failRead || []).includes(q.a[0])) throw new Error("D1"); return st.has(q.a[0]) ? { v: st.get(q.a[0]) } : null; } return null; };
  q.run = async () => { if (/INSERT INTO state/.test(sql)) st.set(q.a[0], q.a[1]); return { meta: {} }; }; q.all = async () => ({ results: [] }); return q; };
  return { prepare: mk, batch: async () => [], _get: (k) => (st.has(k) ? JSON.parse(st.get(k)) : undefined) }; }
function fakeR2(o = {}) { const m = new Map(); const puts = [];
  return { get: async (k) => { if (o.failGet) throw new Error("R2"); return m.has(k) ? { text: async () => m.get(k) } : null; }, put: async (k, v) => { puts.push(k); m.set(k, v); }, _puts: puts, _j: (k) => JSON.parse(m.get(k)) }; }
const calls = [];
let failDay = null;
globalThis.fetch = async (u) => { const d = /date=(\d{4})-(\d{2})-(\d{2})/.exec(String(u)); const ymd = +(d[1] + d[2] + d[3]); calls.push(ymd);
  if (ymd === failDay) return { ok: false, status: 503 };
  return { ok: true, status: 200, json: async () => ({ data: { rows: [{ symbol: "AAPL", eps: "$1." + (ymd % 100), epsForecast: "$1.00" }] } }) }; };
{
  const DB = fakeDB(), R2 = fakeR2(); M._setR2ForTest(R2);
  const r1 = await M.omniEarnCollect(DB, { perRun: 5 });
  const ix = DB._get("omniearn_index"), ev = R2._j(M.OMNIEARN.key);
  chk(calls.length === M.OMNIEARN.recentDays + 5 && ix.days === 5 && ev.AAPL.length === calls.length && ix.cur < ix.oldest,
    "최근 " + M.OMNIEARN.recentDays + "일 + 과거 5일 · 커서가 과거로 움직였다", "★수집 범위·커서★ " + r1 + " " + JSON.stringify(ix));
  const cur0 = ix.cur; calls.length = 0; failDay = M._oePrevWeekday(cur0);   // 과거 두 번째 날 실패
  await M.omniEarnCollect(DB, { perRun: 5 });
  const ix2 = DB._get("omniearn_index");
  chk(ix2.cur === failDay && ix2.days === 6, "실패한 과거 날에서 멈춘다 — 다음 회차가 그 날부터(건너뛰지 않음)", "★실패한 날을 건너뛰었다★ " + JSON.stringify(ix2));
}
{
  failDay = null;
  const DB = fakeDB({ failRead: ["omniearn_index"] }), R2 = fakeR2(); M._setR2ForTest(R2);
  const r = await M.omniEarnCollect(DB, {});
  const DB2 = fakeDB(), R2b = fakeR2({ failGet: true }); M._setR2ForTest(R2b);
  const r2 = await M.omniEarnCollect(DB2, {});
  chk(/색인 읽기 실패/.test(r) && R2._puts.length === 0 && /읽기 실패\(R2\)/.test(r2) && R2b._puts.length === 0, "색인·파일을 못 읽으면 아무것도 안 쓴다", "★못 읽었는데 썼다★ " + r + " / " + r2);
}
console.log("④ 배선");
chk(/omniearn_lock/.test(S) && /\["omniearn", function \(DB\)/.test(S) && /_stg\("omniearn"/.test(S), "매 틱(잠금) + 야간 _PIPE + _stg", "★수집기가 안 돈다★");
const tn = readFileSync(new URL("../.github/workflows/train-now.yml", import.meta.url), "utf8");
chk(/options: \[[^\]]*\bomniearn\b/.test(tn), "수동 실행 목록에 omniearn", "★손으로 돌릴 방법이 없다★");
const ep = S.slice(S.indexOf('path === "/api/omni-earn"'), S.indexOf('path === "/api/omni-news"'));
chk(/_trainAuthed\(\)/.test(ep) && /status: 503/.test(ep) && /getState\(env\.DB, "omniearn_index", null, true\)/.test(ep), "학습기 엔드포인트: 인증 · 엄격(503)", "★엔드포인트가 못 읽음을 없음으로 준다★");
console.log("⑤ 학습기");
{
  /* 경로는 ★글자 그대로★ — 앵커 메타검사(check-gate-anchors)가 이 형태로만 읽는 파일을 찾는다. */
  const PY = readFileSync(new URL("../trainer/modal/omni.py", import.meta.url), "utf8");
  const MT = readFileSync(new URL("../trainer/modal/modal_train.py", import.meta.url), "utf8");
  const MD = readFileSync(new URL("../.github/workflows/modal-deploy.yml", import.meta.url), "utf8");
  const ST = readFileSync(new URL("../trainer/modal/omni_selftest.py", import.meta.url), "utf8");
  const RUN = PY.slice(PY.indexOf("def run(BASE"));
  const iE = RUN.indexOf("    if EARN:\n"), iG = RUN.indexOf('    if len(trees) < 2 or not _edge["ok"]:');
  chk(/EARN = os\.environ\.get\("OMNI_EARN"\) == "1"/.test(PY) && /if ev\[0\] < o:/.test(PY) && /def get_earn\(/.test(PY), "스위치 · 발표 '이전' 만(당일 미혼입) · 워커에서 받기", "★실적 칸이 없거나 당일 발표를 본다★");
  chk(iE > 0 && iE < iG && /OMNI_EARN 실험 회차 — 업로드 안 함/.test(RUN.slice(iE, iG)), "실력 관문 앞 · 업로드 거부", "★실적 실험 배선이 틀렸다★");
  chk(/earn: int = 0/.test(MT) && /os\.environ\["OMNI_EARN"\] = "1"/.test(MT) && /omni_earn:/.test(MD) && /--earn \$\{\{ inputs\.omni_earn && 1 \|\| 0 \}\}/.test(MD) && /def check_earn\(\)/.test(ST) && /\n    check_earn\(\)\n/.test(ST),
    "Modal 입력 · 자가검사(당일 미혼입)", "★실적 실험 입력 또는 자가검사가 없다★");
}
console.log(fails ? "\n✗ 실적 이력 수집기 검사 실패 " + fails : "\n✓ 실적 이력 수집기 검사 통과");
process.exit(fails ? 1 : 0);
