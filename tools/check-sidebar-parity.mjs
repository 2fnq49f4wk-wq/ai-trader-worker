/* ═══════════════════════════════════════════════════════════════════════════
   [V33.280] 사이드바와 두뇌 화면이 ★같은 자★ 를 쓰는가.

   ■ 무엇이 있었나 (운영 스냅샷 2026-08-30T23:12Z · 사용자 보고)
     같은 순간, 같은 모델을 두 화면이 정반대로 말했다:
       사이드바 : "이중헤드 — IC 미달 대기 · 상승 IC 0.289 · 하락 IC 0.378"
       두뇌 화면: "이중헤드 강세 — ✅ 잠정 합류 ×0.25 · 블록 IC 0.268 · 유의성 T 4.26"
     ★IC 가 미달이어서 안 실린 게 아니라, 이미 실려 있었다.★

     원인 둘:
      ① 사이드바가 trusted 만 봤다. trusted 는 홀드아웃+전진검증을 ★둘 다★ 통과해야
         켜지는 엄격 플래그이고, 위원회 합류 여부는 expertAdmit 이 정한다(전진표본을
         모으는 중이면 '잠정 합류'). FLOW·XALPHA·STACK·MEMO 는 admit 을 받아 쓰는데
         이중헤드만 서버가 admit 을 ★안 실어 줬다★.
      ② 같은 이름 'IC' 로 서로 다른 값을 적었다 — 사이드바는 원시 IC, 두뇌 화면은
         게이트가 실제로 보는 블록 IC. 이름이 같으면 값도 같아야 한다.

   ■ 이 검사가 무는 것
     ① 서버가 이중헤드에도 다른 위원과 같은 증거(admit·icBlock·icT)를 싣는가
     ② admit 을 ★실제로 돌려★ 만든 값인가(손으로 지어낸 판정이 아닌가)
     ③ 사이드바가 trusted 가 아니라 admit 으로 상태를 말하는가
     ④ 사이드바가 게이트와 같은 자(블록 IC)를 적는가 — 원시값을 적을 땐 그렇다고 밝히는가
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const HV = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

console.log("① 서버가 이중헤드에도 같은 증거를 싣는가");
{
  const seg = /const _one = function \(m\) \{[\s\S]*?\n            \};/.exec(S);
  chk(!!seg, "이중헤드 조립부(_one)를 찾았다", "조립부를 못 찾는다");
  const t = seg ? seg[0] : "";
  for (const f of ["admit", "icBlock", "icT", "holdPass", "fwdReady", "fwdN", "minFwd"]) {
    chk(new RegExp("\\b" + f + ":").test(t), `이중헤드가 ${f} 를 싣는다`, `★이중헤드에 ${f} 가 없다 — 사이드바가 판단할 근거가 없다★`);
  }
  chk(/admit: _ok \? expertAdmit\(m\) : null/.test(t),
    "admit 은 ★expertAdmit 을 실제로 돌려★ 만든다(다른 위원과 같은 함수)",
    "admit 을 손으로 지어낸다 — 두뇌 화면과 또 갈라진다");
}

console.log("\n② expertAdmit 이 '전진 대기' 를 실제로 잠정합류로 판정하는가 (운영값 재현)");
{
  /* 운영 스냅샷의 이중헤드 강세 값을 그대로 넣어, 사이드바가 '미달' 이라 적던 그 모델이
     ★사실은 합류 중★ 이었음을 재현한다. 수치는 스냅샷에서 그대로 옮긴 것이다. */
  const bull = { valAcc: 0.5593, valIC: 0.28857, valICBlock: 0.268, valICt: 4.26,
                 holdPass: true, fwdReady: false, fwdN: 0, trusted: false, tMinUsed: 3.12 };
  const a = M.expertAdmit(bull);
  console.log(`       admit=${a.admit} · tier=${a.tier} · mult=${a.mult} · why=${String(a.why).slice(0, 46)}`);
  chk(a.admit === true && a.mult > 0,
    `전진 대기 중이어도 위원회에 실린다(가중 ×${a.mult.toFixed(2)}) — "IC 미달" 이 아니었다`,
    "합류 판정이 안 나온다 — 이 검사가 운영 상태를 재현하지 못한다");
  chk(bull.trusted === false && a.admit === true,
    "trusted=false 인데 admit=true 다 — ★사이드바가 trusted 만 보면 반드시 틀린다★",
    "trusted 와 admit 이 같아 이 검사가 무의미하다");
}

console.log("\n③~④ 사이드바가 admit 으로 말하고, 게이트와 같은 자를 적는가");
{
  const blk = /var d = alt\.dual;[\s\S]*?이중헤드\(강세\/약세\)', body\];/.exec(HV);
  chk(!!blk, "사이드바 이중헤드 칸을 찾았다", "사이드바 칸을 못 찾는다");
  const t = blk ? blk[0] : "";
  chk(/var aB=b\.admit, aR=r\.admit;/.test(t), "사이드바가 admit 을 읽는다", "사이드바가 여전히 admit 을 안 본다");
  chk(!/'IC 미달 대기'/.test(t), "'IC 미달 대기' 문구가 사라졌다 — 사실이 아니었다", "★틀린 문구가 남아 있다★");
  chk(/a\.tier==='full'\?'가동':'잠정가동'/.test(t),
    "합류/잠정합류를 tier 로 구분해 적는다(FLOW·XALPHA 와 같은 말)", "상태 문구가 admit 과 무관하다");
  chk(/has\(x\.icBlock\) \? \{v:x\.icBlock, lab:'블록IC'\}/.test(t),
    "게이트가 보는 블록 IC 를 적는다 — 없을 때만 원시값을 쓰고 그렇다고 밝힌다",
    "★사이드바가 여전히 원시 IC 를 'IC' 라고 적는다 — 두뇌 화면과 숫자가 다르다★");
  chk(/lab:'IC\(원시\)'/.test(t), "원시값을 쓸 땐 이름표로 밝힌다", "원시값을 블록IC 인 척 적는다");
  chk(/' t '\+b\.icT\.toFixed\(2\)/.test(t), "유의성 t 도 함께 적는다(두뇌 화면과 같은 값)", "t 가 없다");
}

console.log(fails === 0 ? "\n✓ 사이드바·두뇌 화면 일치 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
