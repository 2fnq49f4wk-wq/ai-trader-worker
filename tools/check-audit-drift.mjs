/* [V33.361] ★두 가지 '말 안 하는 진단' — 원장 드리프트와 멈춘 야간 단계★
 *
 *   ① 원장감사 — 실측(2026-09-14·15 이틀 연속 같은 ERROR):
 *        "[원장감사] ★이상★ 유령매도 0건(초과대금 약 0.00) / 포지션 드리프트 1건
 *         · 원인 점검 후 /api/audit 로 상세 확인"
 *      ★어느 종목인지, 얼마나 어긋났는지, 어느 쪽이 큰지가 한 글자도 없다.★
 *      원인은 문장을 만드는 `_top` 이 ★유령매도만★ 훑는다는 것. 드리프트만 있으면 빈 문자열이 된다.
 *      감사는 { symbol, ledgerQty, tableQty, diff } 를 이미 갖고 있다 — 안 적었을 뿐이다.
 *
 *   ② anlrevk — 실측: 야간 단계가 419분째 "개정 원장 없음 — 대기".
 *      사슬을 따라가면: 야후 v7 사망(A-6) → 컨센서스 수집 0종목 → okCount 0 에서 조용히 return
 *      → analystRevTrack 미호출 → analyst_rev 원장 미생성 → 이 단계가 영영 대기
 *      → 자가진단이 "완주 도장을 찍었는데 안 끝난 단계" 를 매일 경고.
 *      다섯 줄 어디에도 ★v7★ 이라는 말이 없었다.
 */
import { readFileSync } from "node:fs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "✗ FAIL ") + m); if (!c) fail++; };
const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");

// ── ① 드리프트를 이름으로 말하는가 ───────────────────────────────────────────
{
  /* ★앵커는 만들어지는 자리에 건다.★ 소비되는 자리(로그 문장)에서 거꾸로 세면
     주석 길이에 따라 창이 어긋난다 — 첫 판본이 그래서 8건을 헛짚었다. */
  const a0 = src.indexOf("const _dfTxt = _df.slice(0, 4)");
  const blk = src.slice(a0, src.indexOf("· 상세는 /api/audit", a0) + 40);
  ok(a0 > 0, "드리프트 문장 생성부를 앵커로 잡았다");
  ok(/_dfTxt/.test(blk), "드리프트 전용 문장(_dfTxt)을 만든다");
  for (const [k, why] of [["d.symbol", "어느 종목"], ["d.ledgerQty", "원장은 몇 주"],
                          ["d.tableQty", "표는 몇 주"], ["d.diff", "얼마나 어긋났나"], ["d.market", "어느 시장"]])
    ok(blk.indexOf(k) >= 0, `  · ${k} — ${why}`);
  ok(/그대로 팔면 유령매도/.test(blk),
     "★표가 더 많은 경우(diff>0)의 위험을 말로 푼다 — 그대로 팔면 유령매도★");
  ok(/표에서 사라진 보유/.test(blk), "표가 더 적은 경우(diff<0)도 말로 푼다 — 관리 밖 포지션");
  ok(/_df\.length > 4/.test(blk), "4건을 넘으면 '외 N건' 으로 적는다(문장이 무한정 길어지지 않게)");
  /* ★만드는 것과 쓰는 것은 다르다.★ 첫 판본은 _dfTxt 가 '만들어지는지' 만 봐서,
     로그에서 그 값을 빼 버리는 돌연변이를 놓쳤다. ★실제로 문장에 이어 붙는지★ 를 본다. */
  const useAt = src.indexOf('" / 포지션 드리프트 " + _df.length');
  const useBlk = src.slice(useAt, src.indexOf("· 상세는 /api/audit", useAt) + 30);
  ok(/\(_dfTxt \? " — 드리프트: " \+ _dfTxt/.test(useBlk),
     "★ERROR 문장이 _dfTxt 를 실제로 이어 붙인다★(만들어 두고 안 쓰면 종전과 같다)");
  ok(!/\(false \?/.test(useBlk), "그 자리가 상수 false 로 막혀 있지 않다");

  /* ★문장 생성을 실행해서 잰다.★ 소스에 있다는 것과 실제로 찍힌다는 것은 다르다. */
  const m = /const _dfTxt = _df\.slice\(0, 4\)\.map\(function \(d\) \{[\s\S]*?\}\)\.join\(" \/ "\);/.exec(blk);
  ok(!!m, "드리프트 문장 생성부를 잘라냈다");
  if (m) {
    const _num = (v, d) => (typeof v === "number" && isFinite(v)) ? v : d;
    const run = (df) => eval("(function(_df,_num){" + m[0] + "return _dfTxt;})")(df, _num);
    const plus = run([{ market: "kr", symbol: "005930.KS", ledgerQty: 10, tableQty: 13, diff: 3 }]);
    ok(/005930\.KS/.test(plus) && /원장 10주/.test(plus) && /표 13주/.test(plus),
       `종목·양쪽 수량이 실제로 찍힌다 → "${plus.slice(0, 58)}…"`);
    ok(/유령매도/.test(plus), "표가 많으면 유령매도 위험을 경고한다");
    const minus = run([{ market: "us", symbol: "AAPL", ledgerQty: 9, tableQty: 4, diff: -5 }]);
    ok(/관리 밖/.test(minus) && /\(-5\)/.test(minus), `표가 적으면 다른 문장이 나온다 → "${minus.slice(-28)}"`);
    ok(run([]) === "", "드리프트가 없으면 빈 문자열(없는 말을 만들지 않는다)");
    // 대조군 — 종전 방식(_ph 만 훑기)은 드리프트만 있을 때 아무 말도 못 한다
    const oldWay = [].slice(-4).map((p) => p.symbol).join(", ");
    ok(oldWay === "", "대조군 — 종전 `_top` 은 유령매도가 0이면 빈 문자열이었다");
  }
}

// ── ② 멈춘 단계가 상류를 지목하는가 ──────────────────────────────────────────
{
  const i = src.indexOf("[ANLREVK] 개정 원장 없음");
  const blk = src.slice(i - 900, i + 300);
  ok(/analyst_consensus/.test(blk), "대기 사유가 컨센서스 상태를 읽는다");
  ok(/yahoo_v7/.test(blk), "대기 사유가 v7 상태를 읽는다");
  ok(/A-6/.test(blk), "v7 이 죽어 있으면 ★결함 번호(A-6)까지 지목한다★");
  ok(/시간 전/.test(blk), "컨센서스가 몇 시간 전 것인지 적는다");
  /* 같은 함정 — _why 를 만들어 놓고 return 에서 빼면 종전 문장 그대로다. */
  ok(/개정 원장 없음 — 대기" \+ _why;/.test(blk),
     "★대기 문장이 _why 를 실제로 이어 붙인다★");
}

// ── ③ 죽은 상류가 조용히 캐시로 위장하지 않는가 ──────────────────────────────
{
  const i = src.indexOf("if (okCount === 0) {");
  ok(i > 0, "컨센서스 수집 0종목 분기를 찾았다");
  const blk = src.slice(i, i + 1600);
  ok(/log\(DB, "WARN"/.test(blk), "0종목이면 WARN 을 남긴다(종전엔 조용히 return 이었다)");
  ok(/야후 v7 사망\(A-6\)/.test(blk), "v7 이 죽어 있으면 그 이름을 적는다");
  ok(/anlrevk/.test(blk), "★이게 멈추면 어느 하류가 멈추는지까지 적는다★");
  ok(/return cached;/.test(blk), "그래도 캐시는 그대로 돌려준다(없는 값을 지어내지 않는다)");
  ok(!/if \(okCount === 0\) return cached;  \/\/ 전부 실패/.test(src), "옛 침묵 한 줄이 사라졌다");
}

console.log(fail ? "\n진단 문장 계약 위반 " + fail + "건 — 배포 차단" : "\n  ok   진단 문장 계약 통과");
process.exit(fail ? 1 : 0);
