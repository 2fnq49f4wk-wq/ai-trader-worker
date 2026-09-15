/* [V33.363] ★"언제부터 열화인지" 가 매 사이클 지워지고 있었다★
 *
 *   실측(자가진단 2026-09-15): "[MLOPS] ★30회 반복★ — 모델 열화 감지 —
 *   검증정확도 49.8% < 50.5% → 열화 → ML observe + 재학습 필요 (×2 · 최근 1분 전)".
 *   같은 문장이 끝없이 반복되는데 ★그 안에 시간이 없다.★
 *
 *   원인은 한 줄이었다 — `setState(DB, "model_drift", { ts: Date.now(), … })` 를
 *   ★매 사이클 새로 쓴다.★ 그래서 model_drift.ts 는 '열화가 시작된 때' 가 아니라
 *   '방금 또 봤다' 다. 몇 시간째인지·며칠째인지를 아무도 알 수 없었고,
 *   재학습이 몇 번 돌았는데도 안 낫는 상황을 숫자로 말할 수 없었다.
 *
 *   ★이 게이트를 뒤늦게 붙인다.★ V33.363 이 이 고침을 게이트 없이 넣었다 —
 *   이 저장소 규율(모든 고침은 게이트로 못 박는다)을 내가 어겼고, 여기서 메운다.
 */
import { readFileSync } from "node:fs";
import { mlDriftCheck, AI_PARAMS } from "../src/index.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "✗ FAIL ") + m); if (!c) fail++; };
const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");

// ── ① 열화 판정 자체는 그대로인가(회귀 없음) ─────────────────────────────────
{
  const P = AI_PARAMS.mlops;
  const floor = P.driftAccFloor != null ? P.driftAccFloor : 0.505;
  ok(mlDriftCheck({ valAccLB: floor - 0.01 }, P).drift === true, `정확도가 문턱(${floor}) 아래면 열화`);
  ok(mlDriftCheck({ valAccLB: floor + 0.01 }, P).drift === false, "문턱 위면 정상");
  ok(mlDriftCheck(null, P).drift === false && mlDriftCheck(null, P).reason === "미학습",
     "모델이 없으면 열화가 아니라 '미학습'(없는 것을 나쁘다고 하지 않는다)");
  ok(mlDriftCheck({}, P).reason === "정확도 없음", "정확도를 모르면 그렇게 말한다");
}

// ── ② ★시작(since)이 보존되는가★ — 이 절이 이 게이트의 요점이다 ──────────────
{
  const blk = src.slice(src.indexOf("let _dPrev = null;"), src.indexOf("} else if (_dPrev &&"));
  ok(blk.indexOf("_num(_dPrev && _dPrev.since, 0) || Date.now()") >= 0,
     "★직전 기록의 since 를 이어받는다★ — 없을 때만 지금으로 찍는다(= 진짜 시작)");
  ok(/since: _since/.test(blk), "저장할 때 그 since 를 그대로 쓴다");
  ok(/ts: Date\.now\(\)/.test(blk), "마지막 확인 시각(ts)은 따로 갱신한다");
  ok(!/setState\(DB, "model_drift", \{ ts: Date\.now\(\), acc:/.test(src),
     "옛 한 줄(ts 만 쓰던 것)이 사라졌다");
  ok(/n: _n/.test(blk) && /_num\(_dPrev && _dPrev\.n, 0\) \+ 1/.test(blk),
     "몇 번째 감지인지 센다(재학습이 몇 번 돌았는데도 안 낫는지를 말할 수 있다)");

  /* ★기간 계산과 문구를 실제로 돌린다.★ 소스에 있다는 것과 맞게 나온다는 것은 다르다. */
  const m = /const _agoTxt = _hrs < 1 \? [\s\S]*?;/.exec(blk);
  ok(!!m, "기간 문구 생성부를 잘라냈다");
  if (m) {
    const f = (h) => eval("(function(_hrs){" + m[0] + "return _agoTxt;})")(h);
    ok(f(0.5) === "30분째", `30분 → "${f(0.5)}"`);
    ok(f(0.001) === "1분째", `아주 짧아도 0분이라 하지 않는다 → "${f(0.001)}"`);
    ok(f(3) === "3.0시간째", `3시간 → "${f(3)}"`);
    ok(f(47.9) === "47.9시간째", `이틀 미만은 시간으로 → "${f(47.9)}"`);
    ok(f(72) === "3.0일째", `이틀 넘으면 일로 → "${f(72)}"`);
  }
  /* 등급이 갈리는가 — 하루를 넘으면 WARN 이 아니라 ERROR 다 */
  ok(/_hrs >= 24 \? "ERROR" : "WARN"/.test(blk),
     "★하루를 넘으면 ERROR 로 올린다★ — 재학습으로 안 낫는다는 뜻이라 급이 다르다");
  ok(/재학습으로 낫지 않는다는 뜻이다/.test(blk), "그때 무엇을 봐야 하는지까지 적는다(문턱이 아니라 표본·피처)");
}

// ── ③ ★회복을 말하는가★ — 종전엔 기록이 그대로 남아 영영 '열화' 로 보였다 ─────
{
  const blk = src.slice(src.indexOf("} else if (_dPrev &&"), src.indexOf("} else if (_dPrev &&") + 900);
  ok(/DELETE FROM state WHERE k = \?/.test(blk) && /model_drift/.test(blk),
     "정상으로 돌아오면 기록을 지운다(다음 열화의 since 가 진짜 시작이 되게)");
  ok(/열화 해소/.test(blk), "회복을 로그로 말한다 — 나아진 것을 안 알려 주면 고쳐졌는지 알 수 없다");
  ok(/_lasted/.test(blk) && /감지 " \+ _num\(_dPrev\.n, 0\)/.test(blk),
     "얼마나 지속됐고 몇 번 감지됐는지 함께 적는다");
  ok(/_num\(_dPrev\.since, 0\) > 0/.test(src.slice(src.indexOf("} else if (_dPrev &&"), src.indexOf("} else if (_dPrev &&") + 120)),
     "열화 기록이 있을 때만 '해소' 를 말한다(처음부터 정상인데 해소라고 하지 않는다)");
}

console.log(fail ? "\n열화 추적 계약 위반 " + fail + "건 — 배포 차단" : "\n  ok   열화 추적 계약 통과");
process.exit(fail ? 1 : 0);
