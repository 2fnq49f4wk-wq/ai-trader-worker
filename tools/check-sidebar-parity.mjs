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
  /* [V33.301] 판정이 서버 명부(buildRoster)로 올라갔다. 사이드바가 admit 을 ★직접★ 읽으면
     그건 판정이 다시 화면으로 내려온 것이고, 곧 두뇌 화면과 갈라진다. 명부만 읽어야 한다. */
  chk(/LUXR\.state\('dual_bull'\)/.test(t) && !/b\.admit/.test(t),
    "사이드바가 ★서버 명부★ 로 상태를 말한다(admit 을 화면에서 다시 해석하지 않는다)",
    "사이드바가 admit/trusted 를 직접 해석한다 — 두뇌 화면과 갈라질 자리다");
  chk(!/'IC 미달 대기'/.test(t), "'IC 미달 대기' 문구가 사라졌다 — 사실이 아니었다", "★틀린 문구가 남아 있다★");
  chk(/if\(st==='on'\) return '가동';[\s\S]{0,120}?if\(st==='prov'\) return '잠정가동'/.test(t),
    "합류/잠정합류를 명부 state 로 구분해 적는다(FLOW·XALPHA·SEQ 와 같은 말)",
    "상태 문구가 명부와 무관하다 — 불과 글자가 다른 근거로 만들어진다");
  chk(/has\(x\.icBlock\) \? \{v:x\.icBlock, lab:'블록IC'\}/.test(t),
    "게이트가 보는 블록 IC 를 적는다 — 없을 때만 원시값을 쓰고 그렇다고 밝힌다",
    "★사이드바가 여전히 원시 IC 를 'IC' 라고 적는다 — 두뇌 화면과 숫자가 다르다★");
  chk(/lab:'IC\(원시\)'/.test(t), "원시값을 쓸 땐 이름표로 밝힌다", "원시값을 블록IC 인 척 적는다");
  chk(/' t '\+b\.icT\.toFixed\(2\)/.test(t), "유의성 t 도 함께 적는다(두뇌 화면과 같은 값)", "t 가 없다");
}

console.log("\n⑤ 위원 이름이 잘리지 않는가 (운영 화면이 'XALP… / MEM… / 이중헤…' 였다)");
{
  chk(/h \+= sec\('위원회 \(신규 전문가\)'\)\s*\n\s*\+ cmList\(\[/.test(HV),
    "위원회는 2줄 목록으로 그린다(이름과 증거가 자리를 안 다툰다)",
    "★위원회가 아직 2칸 표를 쓴다 — 긴 이름이 잘린다★");
  const css = /\.rail-ai \.cm-nm\{([\s\S]*?)\}/.exec(HV);
  chk(!!css && !/text-overflow:\s*ellipsis/.test(css[1]) && /white-space:\s*normal/.test(css[1]),
    "위원 이름 줄에 말줄임이 없다 — 길면 줄바꿈한다", "★이름이 여전히 말줄임된다★");
  chk(!!css && !/width:\s*\d+px/.test(css[1]),
    "이름 칸에 고정 폭이 없다(52px 고정이 잘림의 원인이었다)", "이름 칸이 아직 고정 폭이다");
  const ev = /\.rail-ai \.cm-ev\{([\s\S]*?)\}/.exec(HV);
  chk(!!ev && /tabular-nums/.test(ev[1]),
    "증거줄 숫자는 자릿수가 맞춰진다(값이 흔들려도 눈이 안 흔들린다)", "증거줄에 tabular-nums 가 없다");
  /* 다른 섹션은 종전 표를 그대로 쓴다 — 위원회만 바꾼 것이지 전체를 헤집지 않았다. */
  chk(/\+ tbl\(\[ trow\('미국장'/.test(HV),
    "진입 문턱 등 다른 섹션은 종전 표 그대로다(필요한 곳만 바꿨다)", "다른 섹션까지 바뀌었다");
}

console.log("\n⑥ 읽는 쪽이 ★쓰는 쪽이 넣는 판★ 을 보는가 (V33.280 에서 내가 낸 회귀)");
{
  /* dualHeadTrainNightly 가 모델에 넣는 featVer 와, ai-mode 가 대조하는 featVer 가
     같은 상수여야 한다. V33.280 은 이걸 DUALHEAD.featVer(2)로 바꿔 놓아 _ok 가 늘 false 가
     됐고, admit 이 null 이 되어 사이드바가 "보류" 를 적었다 — 두뇌 화면과 또 갈라졌다. */
  const tr = /async function dualHeadTrainNightly\(DB\)[\s\S]*?featVer:\s*([A-Za-z0-9_.]+)/.exec(S);
  const rd = /이중헤드 모델이 실제로 저장하는 값[\s\S]*?const _ok = m\.featVer === ([A-Za-z0-9_.]+);/.exec(S);
  console.log(`       쓰는 쪽 ${tr && tr[1]} · 읽는 쪽 ${rd && rd[1]}`);
  chk(!!tr && !!rd && tr[1] === rd[1],
    `이중헤드 판 비교가 쓰는 쪽과 같은 상수다 (${rd && rd[1]})`,
    `★판 비교가 어긋난다 — 쓰기 ${tr && tr[1]} vs 읽기 ${rd && rd[1]}. admit 이 늘 null 이 된다★`);
  chk(M.DUALHEAD.featVer !== M.LUXML.featVer,
    `두 상수가 실제로 다르다(DUALHEAD ${M.DUALHEAD.featVer} vs LUXML ${M.LUXML.featVer}) — 헷갈릴 수 있는 조건이 맞다`,
    "두 상수가 같아 이 검사가 무의미하다");
}

console.log("\n⑦ SEQ 가 사이드바에 나오는가 (위원회에서 투표하는데 목록에 없었다)");
{
  chk(/_alt\.seq = \{/.test(S), "서버가 SEQ 를 ai-mode 에 싣는다", "★서버가 SEQ 를 안 실어 준다 — 화면이 그릴 수가 없다★");
  chk(/getState\(env\.DB, "seq_trust", null\)/.test(S),
    "큰 모델을 안 건드리고 동반 레코드(seq_trust)만 읽는다", "SEQ 를 읽는 경로가 다르다");
  chk(/var q = alt\.seq;/.test(HV), "사이드바가 SEQ 행을 그린다", "사이드바에 SEQ 행이 없다");
  chk(/mult: _sq \? _num\(_sq\.wSeq, 0\) : null/.test(S) && /q\.mult\.toFixed\(2\)/.test(HV),
    "지분은 ★서버가 승격 때 판정해 적어 둔 값★ 을 그대로 쓴다(화면이 다시 매기지 않는다)",
    "화면이 지분을 스스로 계산한다 — 두뇌 화면과 갈라질 자리다");
  chk(/판 불일치/.test(HV.slice(HV.indexOf("var q = alt.seq;"), HV.indexOf("var q = alt.seq;") + 1400)),
    "판이 안 맞으면 그렇다고 적는다(조용히 '보류' 로 뭉개지 않는다)", "판 불일치를 구분하지 않는다");
}

console.log("\n⑧ 단타 레버리지 — '못 잰 것' 과 '재봤더니 나쁜 것' 을 가르는가");
{
  chk(/minSamples: 30,/.test(S), "레버리지에 표본 바닥이 있다(30 — 수축식이 쓰는 수와 같다)",
    "★표본 바닥이 없다 — 9건으로 증폭이 열릴 수 있다★");
  chk(/kellyN: _num\(_st\.n, null\)/.test(S), "결정기에 켈리 표본수를 넘긴다", "결정기가 표본수를 못 받는다");
  chk(/else if \(kN != null && kN < minN\) \{/.test(S),
    "표본이 바닥 미만이면 켈리를 아예 안 본다(증폭 없음)", "표본 바닥이 판정에 안 걸린다");
  /* ★실제로 돌려 본다★ — 9건에 좋은 켈리가 나와도 열리면 안 된다. */
  const base = { cfg: { enabled: true, minKelly: 0.05, minSamples: 30, maxMult: 2, concMult: 2, ddCut: 6 },
                 isScalp: true, modelTrusted: true, maeMult: 1, ddPct: 0 };
  const few = M.leverageDecide(Object.assign({}, base, { kelly: 0.35, kellyN: 9 }));
  const many = M.leverageDecide(Object.assign({}, base, { kelly: 0.35, kellyN: 200 }));
  console.log(`       켈리 0.35 — 9건 → ×${few.mult.toFixed(2)} · 200건 → ×${many.mult.toFixed(2)}`);
  chk(few.mult <= 1, `9건이면 좋은 켈리(0.35)여도 증폭하지 않는다 (×${few.mult.toFixed(2)})`,
    `★9건으로 레버리지가 ×${few.mult.toFixed(2)} 열린다 — 부호가 우연으로 뒤집히는 구간이다★`);
  chk(many.mult > 1, `표본이 차면 같은 켈리로 열린다 (×${many.mult.toFixed(2)}) — 막기만 하는 게 아니다`,
    "표본이 차도 안 열린다 — 바닥이 게이트를 죽였다");
  chk(/닫힘 — 표본 부족/.test(HV) && /우연으로 뒤집힌다/.test(HV),
    "화면이 '표본 부족' 이라고 말한다(-0.551 을 판정처럼 적지 않는다)",
    "★화면이 여전히 9건짜리 켈리를 판정처럼 적는다★");
}

console.log(fails === 0 ? "\n✓ 사이드바·두뇌 화면 일치 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
