/* [V33.584] ★AI 모델 학습은 금요일 한 번 — 나머지 날은 수집만★ 계약.
 *   사용자(10/13): "ai모델 학습을 금요일 한번만 하는걸로 해 · 그 전까지는 수집만 · cpu 사용량 줄이고 · Omni 수집은 이어서".
 *   ① 워커 야간 파이프라인 — 학습 단계(TRAIN_STAGES)는 금요일 07시Z~일요일(이어 끝내기)에만 · 주 1회 도장 · 수집 단계는 매일
 *      · 피처 판이 바뀐 날만 예외(강제 학습) — trainWeekKey 진리표 + 배선
 *   ② [V33.585] 사용자(10/13): "내부 cpu 사용 안 하는 학습은 일일 2회로 유지" — 외부 학습(Modal · OMNI-Q GHA)은 하루 2회 그대로,
 *      주 1회는 ★워커 안 학습★ 에만. Modal 크론 12시간 · 자동 재트리거·워치독 14h · 위원회 전진평가 일요일 그대로
 *   ③ OMNI-Q — 기본은 회차마다 학습(하루 2회) · 채점만(캐시 모델) 방식은 선택지(실제 파이썬 should_train) · 워커 신선도는 채점 시각 + 모델 나이 한도
 *   ④ CPU 절감 — 반사실 라벨 4시간 · OMNI 섀도우 채점 60/180분 · 원자재·국채 슬리브 3/15분 · OMNI 봉 수집은 그대로 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const PY = readFileSync(new URL("../trainer/modal/modal_train.py", import.meta.url), "utf8");
const WD = readFileSync(new URL("../.github/workflows/modal-watchdog.yml", import.meta.url), "utf8");
const TG = readFileSync(new URL("../.github/workflows/train-gha.yml", import.meta.url), "utf8");
const QG = readFileSync(new URL("../.github/workflows/omniq-gha.yml", import.meta.url), "utf8");
const QGP = readFileSync(new URL("../trainer/modal/omniq_gha.py", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };

// ① 학습 주 키 진리표 (2026-10-16 = 금요일)
const at = (s) => Date.parse(s);
const K = M.trainWeekKey;
const T = [
  ["목 23:00Z", "2026-10-15T23:00:00Z", null, null],
  ["금 06:59Z(한국장 중 · 창 전)", "2026-10-16T06:59:00Z", null, null],
  ["금 07:00Z", "2026-10-16T07:00:00Z", null, "2026-10-16"],
  ["토 10:00Z(이어 끝내기)", "2026-10-17T10:00:00Z", null, "2026-10-16"],
  ["일 23:59Z", "2026-10-18T23:59:00Z", null, "2026-10-16"],
  ["월 01:00Z", "2026-10-19T01:00:00Z", null, null],
  ["화 · 판 변경일(강제)", "2026-10-13T03:00:00Z", "2026-10-13", "force:2026-10-13"],
  ["수 · 어제 강제였음", "2026-10-14T03:00:00Z", "2026-10-13", null],
];
const bad = T.filter(([, t, f, want]) => K(at(t), f) !== want).map(([n, t, f]) => n + "→" + K(at(t), f));
chk(bad.length === 0, "trainWeekKey: 금 07시Z 에 열리고 · 주말엔 같은 금요일 키 · 월~목 닫힘 · 판 변경일만 강제", bad.join(" | "));
const TS = M.TRAIN_STAGES;
const learn = ["l1", "bandit", "brain", "mind", "gbdt", "memo", "dual", "calibrate", "finalcal", "expepoch", "pooluniq", "mindshadow"];
const collect = ["harvest", "omnibars", "omniflow", "omninews", "omniearn", "cflabel", "deephist", "senti", "socialobs", "uniscan", "ledgeraudit", "portstats", "xspanel", "rvpanel", "optmicro"];
chk(learn.every((k) => TS.has(k)), "학습·적합 단계는 주 1회 집합에 있다", learn.filter((k) => !TS.has(k)).join(","));
chk(collect.every((k) => !TS.has(k)), "수집·라벨·스캔·감사 단계는 매일 돈다(주 1회 집합 밖)", collect.filter((k) => TS.has(k)).join(","));
const stg = new Set([...S.matchAll(/_stg\("([a-z0-9]+)"/g)].map((m) => m[1]));
const ghost = [...TS].filter((k) => !stg.has(k));
chk(ghost.length === 0, "TRAIN_STAGES 의 이름이 전부 실제 파이프라인 단계다(오타 = 매일 학습)", ghost.join(","));
const STG = S.slice(S.indexOf("const _stg = async function (nm, fn) {"), S.indexOf('await _stg("cflabel"'));
chk(/const _isTrain = TRAIN_STAGES\.has\(nm\);\s*\n\s*if \(_isTrain && !_trainKey\) return;\s*\n\s*const _day = _isTrain \? _trainKey : _aiDay;/.test(STG)
    && /if \(_mark === _day\) return;/.test(STG) && /setState\(env\.DB, "ai_stage:" \+ nm, _day\);/.test(STG) && /_day \+ "\|wait\|"/.test(STG),
    "_stg: 학습 단계는 창 밖이면 건너뛰고 · 주 키로 도장(대기 표식도 같은 키)");
chk(/if \(\(_aiLast !== _aiDay \|\| _resume \|\| _trainDue\) && !_aiLockFresh\)/.test(S) && /const _trainDue = !!_trainKey && _aiSt\.ai_trained_week !== _trainKey;/.test(S),
    "금요일 07시Z 에 그날 이미 수집을 마쳤어도 학습하러 다시 들어온다(_trainDue)");
chk(/setState\(env\.DB, "ai_train_force", _aiDay\); _trainKey = "force:" \+ _aiDay;/.test(S), "피처 판이 바뀐 날은 금요일을 기다리지 않는다(옛 모델은 못 읽는다)");
chk(/if \(_trainKey\) \{ try \{ await setState\(env\.DB, "ai_trained_week", _trainKey\);/.test(S), "완주하면 이번 주 학습을 닫는다(ai_trained_week)");
chk(/if \(!_trainKey\) throw 0;/.test(S) && /if \(_trainKey\) \{ try \{ await env\.DB\.prepare\("DELETE FROM state WHERE k = 'model_drift'"\)/.test(S),
    "창 밖에선 GBDT 재학습 트리거도 없고 · 열화 플래그는 재학습한 회차만 푼다");

// ①-b 실제 _stg 를 떼어 돌린다 — 학습 단계(mind)는 창 밖에선 안 돌고 · 금요일에 한 번 · 토요일엔 같은 주 도장으로 건너뛴다 · 수집 단계는 매일
{
  const vm = await import("node:vm");
  const a = S.indexOf("            const _STG_RETRY_MS =");
  const b = S.indexOf("\n            // (1) 반사실 후보 라벨링", a);
  const store = {};
  const ctx = vm.createContext({
    env: { DB: {} }, Date, Math, JSON, String, TRAIN_STAGES: new Set(["mind"]),
    _aiDay: "2026-10-14", _trainKey: null, _STG_COST_MIN_MS: 1e9, _stgCost: { ms: {}, ts: 0 },
    _num: (v, d) => { const x = Number(v); return Number.isFinite(x) ? x : d; },
    getState: async (_db, k) => (store[k] === undefined ? null : store[k]),
    setState: async (_db, k, v) => { store[k] = v; }, log: async () => {}
  });
  vm.runInContext(S.slice(a, b) + "\n globalThis.stg = _stg;", ctx);
  const ran = { mind: 0, harvest: 0 };
  const go = async () => { await ctx.stg("mind", async () => { ran.mind++; return "[MIND] 학습"; }); await ctx.stg("harvest", async () => { ran.harvest++; return "[HV] 수확"; }); };
  await go();                                                          // 수 — 창 밖
  ctx._aiDay = "2026-10-16"; await go();                                // 금 06시Z — 아직 창 밖
  ctx._trainKey = "2026-10-16"; await go();                             // 금 07시Z — 창 열림(같은 날 재진입)
  ctx._aiDay = "2026-10-17"; await go();                                // 토 — 같은 주
  chk(ran.mind === 1 && store["ai_stage:mind"] === "2026-10-16" && ran.harvest === 3 && store["ai_stage:harvest"] === "2026-10-17",
      "실제 _stg: 학습(mind)은 주 1회(금 07시Z) · 수집(harvest)은 매일 하루 한 번", JSON.stringify({ ran, mind: store["ai_stage:mind"], hv: store["ai_stage:harvest"] }));
}

// ② Modal · 자동 재트리거 · 워치독 · GHA
chk(/^CRON = (None if COMMITTEE_RETIRED else )?modal\.Cron\("10 \*\/12 \* \* \*"\)/m.test(PY), "외부 Modal 학습은 하루 2회 유지(워커 CPU 안 씀) · [V33.617] 위원회 퇴역 스위치로만 끈다");
chk(M.MODALAUTO.staleH === 14, "워커 자동 재트리거 문턱 14h 그대로(외부 학습 하루 2회)");
chk(/float\('\$AGE'\) > 14 /.test(WD) && !/date -u \+%u/.test(WD), "워치독: 14h 문턱 · 금요일 제한 없음");
chk(/cron: "10 22 \* \* 0"/.test(TG), "위원회 전진평가(GHA)는 종전 일요일 그대로");
chk(/cron: "20 7 \* \* 1-5"/.test(QG) && /cron: "20 21 \* \* 1-5"/.test(QG), "OMNI-Q GHA 하루 2회 그대로");

// ③ OMNI-Q
const D = 86400000, now = at("2026-10-14T03:00:00Z");
const F = M.omniqFresh;
chk(F({ trainedAt: now - 5 * D, scoredAt: now - 0.3 * D }, now) === true && F({ trainedAt: now - 11 * D, scoredAt: now - 0.3 * D }, now) === false
    && F({ trainedAt: now - 6 * D, scoredAt: now - 6 * D }, now) === false && F({ trainedAt: now - 3 * D }, now) === true,
    "워커 신선도: 채점 5일 · 모델 10일(금요일 모델로 평일 채점 = 신선 · 옛 레코드는 trainedAt 그대로)");
chk(/scoredAt: _num\(body\.scoredAt, Date\.now\(\)\)/.test(S) && (S.match(/if \(!omniqFresh\(st, nowMs\)\)/g) || []).length === 3 && !/_num\(st\.trainedAt, 0\) <= OMNIQ\.maxAgeMs/.test(S),
    "업로드가 채점 시각을 저장하고 · 경로·차단·보유 판정 셋 다 omniqFresh 를 쓴다");
const py = `
import sys, time, datetime as dt
sys.path.insert(0, "trainer/modal")
import omni_q as q
ts = lambda s: dt.datetime.strptime(s, "%Y-%m-%dT%H:%M").replace(tzinfo=dt.timezone.utc).timestamp()
N = ["a", "b"]
c = lambda s: {"names": N, "trainedAt": ts(s) * 1000}
r = [q.should_train("auto", c("2026-10-09T07:25"), N, ts("2026-10-16T07:25"))[0],
     q.should_train("auto", c("2026-10-16T07:25"), N, ts("2026-10-16T21:25"))[0],
     q.should_train("auto", c("2026-10-09T07:25"), N, ts("2026-10-13T21:25"))[0],
     q.should_train("auto", None, N, ts("2026-10-13T21:25"))[0],
     q.should_train("auto", c("2026-10-09T07:25"), ["a"], ts("2026-10-13T21:25"))[0],
     q.should_train("auto", c("2026-10-04T07:25"), N, ts("2026-10-13T07:25"))[0],
     q.should_train("train", c("2026-10-13T07:25"), N, ts("2026-10-13T08:00"))[0],
     q.should_train("score", c("2026-10-13T07:25"), N, ts("2026-10-16T08:00"))[0],
     q.should_train("auto", c("2026-10-09T07:25"), N, ts("2026-10-16T06:00"))[0]]
print(",".join("1" if x else "0" for x in r))
`;
let got = "";
try { got = execFileSync("python3", ["-c", py], { encoding: "utf8" }).trim(); } catch (e) { got = "ERR " + String(e.stderr || e).slice(0, 300); }
chk(got === "1,0,0,1,1,1,1,0,0", "OMNI-Q should_train(실제 파이썬): 금 07:25 학습 · 같은 금요일 21:25 채점만 · 평일 채점만 · 캐시 없음/피처 변경/8일 넘음 → 학습 · 강제 · 금 07시 전 채점만", got);
chk(/actions\/cache\/restore@v4/.test(QG) && /if: steps\.omq\.outputs\.trained == 'true'/.test(QG) && /actions\/cache\/save@v4/.test(QG) && /OMNIQ_MODE: \$\{\{ inputs\.mode \|\| 'train' \}\}/.test(QG) && /OMNIQ_MODE"\) or "train"\)/.test(QGP)
    && /cache=cache, mode=MODE/.test(QGP) && /trained=%s/.test(QGP), "GHA: 기본은 회차마다 학습 · 캐시 복원 → 실행 → 학습한 회차는 캐시 저장(채점만 선택지의 재료)");

// ④ CPU
chk(/if \(!COMMITTEE_RETIRED && Date\.now\(\) - _cfLock > 4 \* 3600000\)/.test(S), "반사실 라벨 틱 4시간 · [V33.634] 위원회 퇴역이면 아예 안 돈다");
const OS = S.slice(S.indexOf("const OMNI_SHADOW = {"), S.indexOf("let _omniShadowReady"));
chk(/gapOffMs: 60 \* 60000, gapInMs: 180 \* 60000/.test(OS), "OMNI 섀도우 채점 10/30분 → 60/180분(실력 0 머리의 전진 기록)");
chk(/const ALT_CADENCE = \{ tradeMs: 3 \* 60000, quoteMs: 15 \* 60000 \};/.test(S) && /"alt_sleeve_ts"/.test(S) && /_altExec \? ALT_CADENCE\.tradeMs : ALT_CADENCE\.quoteMs/.test(S),
    "원자재·국채 슬리브: 매분 → 체결 창 3분 · 시세만 15분");
const OB = S.slice(S.indexOf('__prof.mark("ai.omniBars")'), S.indexOf('__prof.mark("ai.krFlow")'));
chk(/omniBarsCollect\(env\.DB, \{\}\)/.test(OB) && !/TRAIN_STAGES|_trainKey/.test(OB) && !TS.has("omnibars"), "OMNI 봉 수집은 그대로 매 틱(사용자: \"Omni 수집은 이어서\")");

if (fails) { console.log("\n✗ 금요일 주 1회 학습 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 금요일 주 1회 학습 · 평일 수집만 통과");
