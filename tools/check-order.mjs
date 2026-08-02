// [V33.84] 선언·사용 순서 계약 게이트
//   배경: V33.83 켈리 블록이 stopDist 선언보다 앞에 놓여 매 진입마다 TDZ ReferenceError 가
//   났고, 자기 try/catch 에 삼켜져 ★기능이 있는데 전혀 안 도는★ 상태였다. node --check 는
//   문법만 보므로 못 잡는다.
//   범용 TDZ 검사는 파서 없이는 오탐(문자열·객체키·프로퍼티)이 151건 나와 쓸 수 없었다.
//   그래서 "이 블록은 반드시 이 선언 뒤에 있어야 한다"는 계약만 정확히 검사한다.
//   블록을 옮기거나 선언을 옮기면 여기서 잡힌다.
import fs from "node:fs";
const src = fs.readFileSync("src/index.js", "utf8");
const ln = (i) => src.slice(0, i).split("\n").length;

// [블록 마커, 반드시 그보다 앞서 있어야 하는 것들]
const CONTRACTS = [
  ["// ══ [V33.83] 거래별 켈리", ["let stopDist =", "let riskPct = _baseRisk", "let __portRho", "let __scalpEdge = null, __ddPctNow"]],
  ["// ══ [V33.82] ★단타 집중투자·레버리지★", ["let maxPosPct", "let __scalpEdge = null, __ddPctNow"]],
  ["// ══ [V33.80] ★고정 확률문턱 → 횡단면 백분위 문턱★", ["let __pDistCache"]],
  ["// [V33.78] FLOW 피처 조립", ["let __flowModel = null"]],
  ["// [V33.79] XALPHA 피처", ["let __xaModel = null"]],
  ["// [V33.83] 보유분 평균 상관", ["let __portRho"]],
];
// riskPct 는 켈리가 고쳐 쓴 뒤에 소비돼야 한다(먼저 소비되면 켈리가 무의미).
const AFTER = [
  ["const riskDollar = equity * (riskPct / 100)", "// ══ [V33.83] 거래별 켈리"],
];

let bad = 0;
for (const [marker, deps] of CONTRACTS) {
  const i = src.indexOf(marker);
  if (i < 0) { console.error(`  FAIL 순서계약: 블록 마커 없음 — ${marker.slice(0, 40)}`); bad++; continue; }
  for (const d of deps) {
    const j = src.indexOf(d);
    if (j < 0) { console.error(`  FAIL 순서계약: 선언 없음 — '${d}'`); bad++; continue; }
    if (j > i) { console.error(`  FAIL 순서계약: '${d}' 선언(@${ln(j)}) 이 블록(@${ln(i)}) 보다 뒤 — TDZ`); bad++; }
  }
}
for (const [consumer, producer] of AFTER) {
  const c = src.indexOf(consumer), p = src.indexOf(producer);
  if (c < 0 || p < 0) { console.error(`  FAIL 순서계약: 소비/생산 지점 없음`); bad++; continue; }
  if (c < p) { console.error(`  FAIL 순서계약: '${consumer.slice(0,40)}'(@${ln(c)}) 이 켈리(@${ln(p)}) 보다 앞 — 켈리 무효`); bad++; }
}
// 읽기만 하고 아무도 안 쓰는 state 키 = 죽은 게이트 (V33.84 에서 stin_trust 가 그랬다)
const reads = new Set([...src.matchAll(/getState\([A-Za-z.]*DB,\s*"([a-z_][a-z0-9_]*)"/g)].map(m => m[1]));
const writes = new Set([...src.matchAll(/setState\([A-Za-z.]*DB,\s*"([a-z_][a-z0-9_]*)"/g)].map(m => m[1]));
// 변수 키로 기록되는 것들은 리터럴 검색에 안 잡힌다 — 실제 기록 경로를 확인하고 화이트리스트에 둔다.
//   flow/xalpha/stack_model: _miniLogisticTrain 이 setState(DB, opts.stateKey, ...) 로 기록
//   dnn_model / gbdt_*: 청크·시장별 동적 키로 기록
const KNOWN_EXTERNAL = new Set(["cfg","deposits","outflows","daily","quote","hist","index",
  "flow_model","xalpha_model","stack_model","dnn_model","gbdt_",
  "earnings_calendar_v2","econ_calendar"]);
for (const k of reads) {
  if (writes.has(k) || KNOWN_EXTERNAL.has(k)) continue;
  if (/^(daily|quote|hist|index|ai_picks|sector_|xs_|mkt_|xmkt_|equity_peak)/.test(k)) continue;
  console.error(`  WARN 죽은 state 키: "${k}" — 읽기만 하고 기록하는 곳이 없다(게이트가 영원히 닫힐 수 있음)`);
}
// [V33.85] 호출되지 않는 함수 = 죽은 코드. 감사에서 18건(연쇄 1건 포함)이 나왔다.
//   죽은 코드는 그냥 용량이 아니라 ★사람을 속인다★ — "그 기능 있잖아"라고 믿게 만든다.
//   실제로 computeCrashGate(폭락방어 39줄)는 메인 사이클에 재구현돼 있는데도 남아 있었고,
//   taPredictMultiTF(멀티타임프레임 확률결합)는 아무도 안 부르는 채로 방치돼 있었다.
{
  const defs = new Map();
  for (const m of src.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) defs.set(m[1], m.index);
  const deadFns = [];
  for (const [name, pos] of defs) {
    const re = new RegExp("(?<![\\w$.])" + name.replace(/\$/g, "\\$") + "(?![\\w$])", "g");
    if ([...src.matchAll(re)].length - 1 <= 0) deadFns.push({ name, line: ln(pos) });
  }
  if (deadFns.length) {
    for (const d of deadFns) console.error(`  FAIL 죽은코드: 호출되지 않는 함수 '${d.name}' @${d.line}`);
    bad += deadFns.length;
  }
}
if (bad) { console.error(`\n순서계약 위반 ${bad}건 — 배포 차단`); process.exit(1); }
console.log("  ok   선언·사용 순서 계약 통과");
