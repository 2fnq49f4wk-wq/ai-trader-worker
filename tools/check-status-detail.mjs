/* [V33.360] ★운용상태 파일이 문장 중간에서 잘려 결론이 사라졌다 + 상태를 구체화한다★
 *
 *   사용자 보고: "ai운용상태 파일들 깨지는거 같은데 수정하고 좀더 구체적으로 보이게".
 *   파일 자체는 유효한 JSON 이었다(검사함). 깨진 것은 ★내용★ 이다 —
 *   운영 스냅샷(2026-09-15 01:49)에서 `note` 4개가 ★정확히 300자★ 에서 잘려 있었다:
 *       flow   …"잡음과 구별"        (원문: "잡음과 구별되지 않는다")
 *       xalpha …"잡음과"
 *       stack  …"실측 70일 ·"
 *       memo   …"→ 합류 "
 *   이 문장은 앞에 '무엇을 학습했나', ★맨 끝에 결론★('→ 합류 보류 — …')을 적는 구조라
 *   뒤에서 자르면 정확히 결론만 사라진다. 그게 이 파일을 여는 이유인데.
 *
 *   그리고 "구체적으로" 를 위해 세 가지를 상태에 실었다:
 *     · d1Headroom — 상한까지 몇 행·며칠 남았나 (D1 이 한계인지 숫자로 답한다)
 *     · poolWindow — 표본 풀의 시간 창·종목당 건수 (고유도가 왜 그 값인지의 절반, I-2)
 *     · 판 은퇴    — 옛 featVer 기록을 치워 activeFeatVer 가 사실을 말하게
 */
import { readFileSync } from "node:fs";
import { _clipMid } from "../src/index.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "✗ FAIL ") + m); if (!c) fail++; };
const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");

// ── ① _clipMid — 머리와 ★꼬리★ 를 둘 다 남기는가 (실행으로) ──────────────────
{
  const head = "[FLOW] 학습완료 표본 12770 valAcc 46.2% ";
  const mid = "x".repeat(900);
  const tail = "→ 합류 보류 — 홀드아웃 t -0.39 < 1.65 — 잡음과 구별되지 않는다";
  const s = head + mid + tail;

  ok(_clipMid(s, 5000) === s, "상한 안이면 한 글자도 안 건드린다");

  const c = _clipMid(s, 300);
  ok(c.length <= 300 + 20, `상한 300 → ${c.length}자 (접힘 표시 여유 포함)`);
  ok(c.startsWith("[FLOW] 학습완료"), "머리가 남는다 — 무엇을 학습했는지");
  ok(c.endsWith("잡음과 구별되지 않는다"), "★꼬리가 남는다 — 결론★ (종전엔 이게 사라졌다)");
  ok(/접음/.test(c), `접은 사실을 숨기지 않는다: "${c.slice(c.indexOf("…("), c.indexOf(")…") + 2)}"`);

  // 종전 방식과 직접 대조 — 결론이 사라지는 것을 보인다
  const oldWay = s.slice(0, 300);
  ok(!oldWay.endsWith("잡음과 구별되지 않는다"),
     "대조군 — 종전 방식(뒤에서 자르기)은 결론을 잃는다");

  ok(_clipMid(null, 300) === "" && _clipMid(undefined, 300) === "", "null/undefined 는 빈 문자열");
  ok(_clipMid("짧음", 300) === "짧음", "짧은 값은 그대로");
  ok(_clipMid("a".repeat(500), 10).length <= 60, "상한이 비정상적으로 작아도 터지지 않는다");
}

// ── ② 잘리던 자리들이 실제로 _clipMid 를 쓰는가 (배선) ────────────────────────
{
  const noteWrites = [...src.matchAll(/setState\(DB, "train_note:[^)]*?\{[\s\S]{0,200}?\}\)/g)].map((m) => m[0]);
  ok(noteWrites.length >= 2, `train_note 저장 ${noteWrites.length}곳을 찾았다`);
  for (const w of noteWrites) {
    const key = (/train_note:([\w"+ .]+)/.exec(w) || [])[1] || "?";
    ok(/_clipMid\(/.test(w), `train_note(${key.slice(0, 18)}) 가 _clipMid 를 쓴다`);
    ok(!/\.slice\(0, 300\)/.test(w), `train_note(${key.slice(0, 18)}) 에 옛 300자 자르기가 없다`);
  }
  const logSample = src.slice(src.indexOf("if (!groups[sig]) groups[sig] ="), src.indexOf("if (!groups[sig]) groups[sig] =") + 220);
  ok(/_clipMid\(msg, 260\)/.test(logSample), "자가진단 로그 표본도 _clipMid 를 쓴다(종전 150자 뒤자르기)");
}

// ── ③ 상태가 구체적인가 — 새 세 블록이 실려 있는가 ──────────────────────────
{
  for (const [k, why] of [
    ["R.d1Headroom", "상한까지 몇 행·며칠 남았나"],
    ["R.poolWindow", "표본 풀의 시간 창·종목당 건수"],
  ]) ok(src.indexOf(k + " =") >= 0, `상태에 ${k} 를 싣는다 — ${why}`);

  const hb = src.slice(src.indexOf("R.d1Headroom = {"), src.indexOf("R.poolWindow"));
  for (const f of ["cap", "leftRows", "daysLeft", "perDay", "note"])
    ok(hb.indexOf(f + ":") >= 0, `  d1Headroom.${f}`);
  ok(/daysLeft:[\s\S]{0,80}: null/.test(hb), "못 재면 daysLeft 는 null — 지어내지 않는다");

  const pw = src.slice(src.indexOf("if (_pu) R.poolWindow = {"), src.indexOf("if (_pu) R.poolWindow = {") + 1400);
  for (const f of ["windowDays", "nSym", "perSym", "maxPerSym", "conc", "why"])
    ok(pw.indexOf(f + ":") >= 0, `  poolWindow.${f}`);
  ok(/고유도 계산이 실패했다/.test(pw), "고유도가 실패한 상태를 ★말한다★(uBar=1 로 조용히 떨어지지 않게)");

  /* ★추가 D1 쿼리를 만들지 않았는가★ — 구체화한다고 부하를 늘리면 I-1 이 재발한다. */
  const blk = src.slice(src.indexOf("R.d1Headroom = {") - 1600, src.indexOf("} catch (e) {}", src.indexOf("R.poolWindow")));
  ok(!/DB\.prepare\(/.test(blk),
     "★새 블록이 D1 쿼리를 하나도 안 만든다★ — 이미 있는 캐시·상태만 읽는다(I-1 재발 방지)");
  ok(/_mlCountsCached\(DB\)/.test(blk), "하루 유입은 이미 있는 60초 공유 캐시에서 가져온다");
}

console.log(fail ? "\n운용상태 계약 위반 " + fail + "건 — 배포 차단" : "\n  ok   운용상태 계약 통과");
process.exit(fail ? 1 : 0);
