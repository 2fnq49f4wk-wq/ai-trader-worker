/* [V33.364] ★"지금 적용 중" 이라던 문턱이 12~19시간 전 값이었다★
 *
 *   실측(운영 스냅샷 2026-09-15 01:49):
 *     US  지금 계산 floor 0.4500 (손익비 1.51) / ★applied.floor 0.4614 — 12.0시간 전★
 *     KR  지금 계산 floor 0.4665 (손익비 1.40) / ★applied.floor 0.4643 — 19.3시간 전★
 *
 *   화면은 그 값을 `applied` 라 부르고 소스 주석은 "엔진이 마지막 사이클에 실제로 쓴 값"
 *   이라 적었다. ★둘 다 사실이 아니었다.★ 기록이 `if (_newThr < _thrAI)` ★안에서만★
 *   쓰였기 때문이다 — 즉 '백분위 문턱이 고정문턱을 밑돈 사이클' 에만 남는다.
 *   그 조건이 안 맞으면 갱신이 없고, 화면은 어제 값을 '지금' 으로 보여 준다.
 *   문턱은 돈이 걸린 값이라 이 오해가 비싸다(매수를 막거나 열어 준다).
 */
import { readFileSync } from "node:fs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "✗ FAIL ") + m); if (!c) fail++; };
const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");

// ── ① 기록이 ★조건 밖★ 으로 나왔는가 ────────────────────────────────────────
{
  const i = src.indexOf("const _thrBefore = _thrAI;");
  ok(i > 0, "적용 전 문턱을 따로 잡아 둔다(_thrBefore)");
  const blk = src.slice(i, i + 900);
  ok(/if \(_newThr < _thrBefore\) \? "pct" : "fixed"/.test(blk) || /path: \(_newThr < _thrBefore\)/.test(blk),
     "어느 갈래로 정해졌는지(path)를 함께 적는다");
  /* ★요점★ — 기록이 if 블록 밖에 있어야 한다. 안에 있으면 종전과 같다. */
  const assignAt = blk.indexOf("__thrWhy[market] =");
  const ifAt = blk.indexOf("if (_newThr < _thrAI) _thrAI = _newThr;");
  ok(ifAt >= 0 && assignAt > ifAt,
     "★기록이 if 블록 ★밖★ 에 있다 — 어느 갈래가 이겼든 매 사이클 남는다★");
  ok(!/if \(_newThr < _thrAI\) \{ _thrAI = _newThr; __thrWhy\[market\]/.test(src),
     "옛 형태(조건 안에서만 기록)가 사라졌다");
  ok(/thr: \+_thrAI\.toFixed\(4\)/.test(blk),
     "기록하는 값이 ★실제로 쓰는 문턱(_thrAI)★ 이다(후보값이 아니라)");
  for (const [k, why] of [["pctThr", "백분위가 제안한 값"], ["fixedThr", "고정 쪽 값"]])
    ok(blk.indexOf(k + ":") >= 0, `  · ${k} — ${why}(둘을 다 남겨야 왜 그 값이 됐는지 안다)`);
}

// ── ② 읽는 쪽이 ★나이★ 를 함께 내는가 ───────────────────────────────────────
{
  const i = src.indexOf('let _why = await getState(env.DB, "ai_thr_why:" + mkt, null);');
  ok(i > 0, "읽는 곳을 찾았다");
  const blk = src.slice(i, i + 700);
  ok(/ageH:/.test(blk), "기록의 나이(ageH)를 함께 낸다");
  ok(/stale:/.test(blk), "오래됐으면 문장으로도 말한다");
  ok(/_ah > 1 \?/.test(blk), "1시간을 넘으면 오래된 것으로 본다(사이클은 분 단위로 돈다)");
  ok(!/엔진이 마지막 사이클에 실제로 쓴 값/.test(src) || /이제 ★정말로★ 마지막 사이클 값이다/.test(src),
     "옛 주석의 거짓 주장이 정정됐다");
}

// ── ③ ★실측 시나리오를 그대로 돌린다★ — 기록 로직을 잘라 실행 ────────────────
{
  const m = /const _thrBefore = _thrAI;[\s\S]*?fixedThr: \+_thrBefore\.toFixed\(4\) \};/.exec(src);
  ok(!!m, "기록 로직을 잘라냈다");
  if (m) {
    const run = (thrAI, newThr) => {
      const __thrWhy = {}; const market = "us";
      const _pctThr = newThr, _floor = 0.45, _fl = { src: "손익비 1.51 → 분기 0.398 +여유 0.05" }, _srt = { length: 2000 };
      let _thrAI = thrAI; const _newThr = newThr;
      eval(m[0]);
      return __thrWhy[market];
    };
    /* 백분위가 이긴 경우 — 종전에도 기록됐다 */
    const win = run(0.55, 0.4614);
    ok(win && win.thr === 0.4614 && win.path === "pct",
       `백분위가 이기면 그 값을 기록 — thr=${win.thr} path=${win.path}`);
    /* ★백분위가 진 경우 — 종전엔 ★아무것도 기록되지 않았다★ (그래서 12시간 전 값이 남았다) */
    const lose = run(0.45, 0.50);
    ok(!!lose, "★백분위가 져도 기록된다 — 종전엔 여기서 아무것도 안 남아 옛 값이 화면에 박혔다★");
    ok(lose.thr === 0.45 && lose.path === "fixed",
       `그때는 고정값이 실제 문턱 — thr=${lose.thr} path=${lose.path}`);
    ok(lose.pctThr === 0.5 && lose.fixedThr === 0.45,
       `두 후보값을 다 남긴다 — 백분위 ${lose.pctThr} vs 고정 ${lose.fixedThr}(왜 그 값이 됐는지 보인다)`);
    /* 같을 때(경계) — '이겼다' 고 하지 않는다 */
    const tie = run(0.46, 0.46);
    ok(tie.path === "fixed", "정확히 같으면 '백분위가 이겼다' 고 하지 않는다(문턱을 올리지 않는 규칙 그대로)");
  }
}

console.log(fail ? "\n문턱 기록 계약 위반 " + fail + "건 — 배포 차단" : "\n  ok   문턱 기록 계약 통과");
process.exit(fail ? 1 : 0);
