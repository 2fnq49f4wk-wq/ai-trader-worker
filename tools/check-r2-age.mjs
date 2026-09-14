/* [V33.357] ★R2 집계는 '지금' 이 아니다 — 나이를 숨기지 않는다★
 *
 *   `r2_status_cache` 는 ★/api/r2-status 를 누가 열었을 때만★ 갱신된다.
 *   R2.list 가 Class A 과금이라 주기 호출을 ★일부러★ 안 한다 — 그건 옳은 결정이다.
 *   문제는 화면이 그 값을 ★현재 상태처럼★ 보여 준 것이다.
 *
 *   실측(2026-09-14 23:09 스냅샷): ageSec = 2,008,262 (=23.2일), today.day = "2026-08-23".
 *     · 화면 표기는 "2,008,262초 전 집계" — 사람이 23일로 읽을 수 있는 형식이 아니다
 *     · 그 아래 행은 23일 전 files/pending 을 ★"오늘 단타 수집"★ 이라 부르며 초록으로 칠했다
 *       → 멈춘 수집이 도는 것처럼 읽힌다
 *
 *   A-7(휴장 중 남은 시간외 값에 나이 표시)과 같은 원칙이다:
 *   ★값을 지어내지 않는 것과 값의 나이를 숨기지 않는 것은 같은 일이다.★
 *
 *   HTML 에서 함수를 잘라 ★실제로 실행한다★(문자열 검사 아님).
 */
import { readFileSync } from "node:fs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "✗ FAIL ") + m); if (!c) fail++; };

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

// ── extAgeTxt 를 잘라 실제로 돌린다 ───────────────────────────────────────────
const m = html.match(/function extAgeTxt\(ts, nowMs, freshMin\) \{[\s\S]*?\n  \}/);
ok(!!m, "extAgeTxt 를 HTML 에서 찾았다(A-7 에서 만든 공용 나이 표기)");
const extAgeTxt = m ? eval("(" + m[0] + ")") : null;

if (extAgeTxt) {
  const NOW = Date.now();
  const age = (sec) => extAgeTxt(NOW - sec * 1000, NOW, 5);
  // ★실측값★ 2,008,262초 = 23.2일
  ok(age(2008262) === "23일 전", `실측 ageSec 2,008,262 → "${age(2008262)}" (종전 표기는 "2,008,262초 전")`);
  ok(/초/.test(age(2008262)) === false, "23일을 '초' 로 찍지 않는다");
  ok(age(600) === "10분 전", `10분 → "${age(600)}"`);
  ok(age(7200) === "2시간 전", `2시간 → "${age(7200)}"`);
  ok(age(60) === "", "5분 이내면 아무것도 안 붙인다(신선하면 조용하다)");
  ok(extAgeTxt(null, NOW, 5) === "시각미상", "시각을 모르면 '시각미상'");
}

// ── 오래된 집계를 '오늘' 이라 부르지 않는가 (배선) ────────────────────────────
//     r2Old 판정과 그에 따른 분기가 실제로 걸려 있는지 본다.
{
  const blk = html.slice(html.indexOf("// [V33.101] R2 저장소 상태"),
                         html.indexOf("// ⑥ AI 픽"));
  ok(blk.length > 200, "R2 저장소 블록을 찾았다");
  ok(/var r2Old\s*=\s*\(R\.ageSec != null && R\.ageSec > 6 \* 3600\)/.test(blk),
     "6시간 넘으면 '옛 집계' 로 본다");
  ok(/window\.extAgeTxt/.test(blk) && /_ageFn\(/.test(blk),
     "나이를 공용 extAgeTxt 로 계산한다(window 로 받아 부른다)");
  /* ★계산만으로는 부족하다 — 화면에 ★찍히는 줄★ 이 그 값을 쓰는지 봐야 한다.
     처음엔 `extAgeTxt(` 가 블록 어딘가에 있으면 통과시켰는데, 표시 줄만 원시 초로
     되돌리는 돌연변이가 그대로 빠져나갔다(계산은 남아 있으니까). */
  const bindRow = blk.slice(blk.indexOf("rows5.push(['R2 바인딩', col('활성'"),
                           blk.indexOf("var gk = Object.keys"));
  ok(bindRow.length > 40, "R2 바인딩 표시 줄을 찾았다");
  ok(/r2Age/.test(bindRow), "표시 줄이 r2Age(사람이 읽는 표기)를 쓴다");
  /* ★스코프 배선까지 지킨다.★ 이 파일의 <script> 는 IIFE 라 스코프가 막혀 있다 —
     extAgeTxt 를 그냥 부르면 ReferenceError 가 나고, 실제로 그렇게 썼다가
     check-html-js 가 잡았다. 같은 로직을 복제하는 대신 window 로 한 벌만 내보낸다. */
  ok(/window\.extAgeTxt\s*=\s*extAgeTxt/.test(html),
     "extAgeTxt 를 window 로 내보낸다(IIFE 스코프를 넘겨 ★한 벌만★ 쓴다)");
  ok(/window\.extAgeTxt/.test(blk), "R2 블록이 그 한 벌을 부른다(로직을 복제하지 않는다)");
  const dupes = (html.match(/function extAgeTxt\s*\(/g) || []).length;
  ok(dupes === 1, `extAgeTxt 정의가 ${dupes}개 — 1개여야 한다(복제하면 두 표기가 갈라진다)`);
  ok(!/n0\(R\.ageSec\)/.test(bindRow) && !/R\.ageSec\s*\+\s*'초/.test(bindRow),
     "표시 줄이 ageSec 원시 초를 그대로 찍지 않는다(종전엔 \"2,008,262초 전\" 이었다)");
  ok(/if \(r2Old\) \{/.test(blk), "옛 집계면 다른 행을 그린다");

  // ★옛 집계일 때 '오늘' 이라는 말이 안 나와야 한다★
  const oldBranch = blk.slice(blk.indexOf("if (r2Old) {"), blk.indexOf("} else {", blk.indexOf("if (r2Old) {")));
  ok(oldBranch.indexOf("'오늘 단타 수집'") < 0 && oldBranch.indexOf("오늘 단타 수집") < 0,
     "옛 집계 분기에는 '오늘' 이라는 말이 없다(23일 전을 오늘이라 부르지 않는다)");
  ok(/C\.amb/.test(oldBranch) && !/C\.pos/.test(oldBranch),
     "옛 집계는 초록(C.pos)으로 칠하지 않는다 — 초록은 '지금 돌고 있다' 로 읽힌다");
  ok(/지금 상태가 아니다/.test(oldBranch), "옛 집계임을 문장으로도 말한다");

  // 신선한 집계는 종전대로 '오늘' 이라 부른다(회귀 없음)
  const freshBranch = blk.slice(blk.indexOf("} else {", blk.indexOf("if (r2Old) {")));
  ok(/'오늘 단타 수집'/.test(freshBranch), "신선한 집계는 종전대로 '오늘 단타 수집'");
  ok(/C\.pos/.test(freshBranch), "신선하고 수집 중이면 초록으로 칠한다(종전 동작 유지)");
}

console.log(fail ? "\nR2 집계 나이 계약 위반 " + fail + "건 — 배포 차단" : "\n  ok   R2 집계 나이 계약 통과");
process.exit(fail ? 1 : 0);
