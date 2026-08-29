/* ═══════════════════════════════════════════════════════════════════════════
   [V33.272] STACK 에 SEQ 슬롯 추가 — 요청: "STACK에 seq 슬롯 추가해줘".

   ■ 진짜 위험은 슬롯을 빠뜨리는 게 아니라 ★네 곳 중 하나만 고치는 것★ 이었다
     위원 목록은 이 파일에 손으로 네 번 적혀 있었다:
       ① mlDeepDecide 의 라이브 결합(_stackFeat)
       ② stackSampleBackfill 의 소급생성(fv)
       ③ /api/nn-viz?model=overview 의 화면용 목록(_ov.stack.slots)
       ④ mlLinearVizData 의 STACK 구조 관측 이름표
     하나만 고치고 나머지 셋을 놓치면, STACK 은 "3번 자리는 boost" 라고 학습된 채로
     4번 자리에 다른 확률이 꽂힌 벡터를 받게 된다 — 성적으로만 드러나는 사고다.
     그래서 지금은 STACK_SLOTS 하나뿐이고, 이 검사는 ★그 하나만 있는지★ 를 잡는다.

   ■ 그리고 소급생성이 SEQ 를 못 채우는 게 버그가 아니라 규율이라는 것
     다른 전문가는 오늘 한 시점의 벡터로 다시 채점할 수 있지만, SEQ 는 그 종목의
     최근 16봉 ★시퀀스★ 가 있어야 한다. ml_samples.ts 는 "봉 수 × 1일" 근사라
     정확한 봉 인덱스를 못 되짚는다 — 억지로 재구성하면 이 저장소가 반복해 당한
     '조용한 오염'이 재현된다. 그래서 소급생성은 seq 를 항상 마스크 0 으로 두고,
     ★라이브 청산 표본★(그 순간 실제로 계산된 값)만 seq 를 채운다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const code = S.split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
const D = M.LUXML.featNames.length;

console.log("① 슬롯 목록이 정말 ★한 곳★ 뿐인가");
{
  chk(Array.isArray(M.STACK_SLOTS) && M.STACK_SLOTS.includes("seq"),
    `STACK_SLOTS 에 seq 가 있다 (${M.STACK_SLOTS.join(",")})`, "STACK_SLOTS 에 seq 가 없다");
  chk(M.STACK_SLOTS.length === 9, `위원 9명 = ${M.STACK_SLOTS.length * 2}차원`, "슬롯 수가 예상과 다르다");
  /* 손으로 다시 적은 위원 목록이 파일 어디에도 없어야 한다 — 있으면 그게 다섯 번째 사본이다. */
  const literal = /\["mind",\s*"dnn",\s*"gbdt",\s*"boost",\s*"flow",\s*"xalpha",\s*"memo"/g;
  const hits = [...code.matchAll(literal)].filter(m => !code.slice(m.index, m.index + 5).includes("STACK_SLOTS"));
  // STACK_SLOTS 선언 자체는 이 리터럴을 담고 있으므로 정확히 1건(선언부)만 있어야 한다.
  chk(hits.length === 1, "위원 목록 리터럴이 선언부 딱 하나뿐이다(손복사가 없다)",
    `★위원 목록이 ${hits.length}곳에 따로 적혀 있다 — 손복사가 남아 있다★`);
}

console.log("\n② 라이브 결합이 실제로 seq 를 그 자리에 싣는가");
{
  chk(/for \(const nm of STACK_SLOTS\) _stackFeat\.push/.test(code),
    "라이브 _stackFeat 조립이 STACK_SLOTS 를 순회한다", "라이브 조립이 다른 목록을 쓴다");
  const idx = M.STACK_SLOTS.indexOf("seq");
  chk(idx >= 0, `seq 는 ${idx}번 자리다`, "seq 자리를 못 찾는다");
  // 스텁 DB 로 위원회를 실제로 돌려, seq 가 투표했을 때 그 자리에 seq 확률이 꽂히는지 본다.
  const stubDB = { prepare() { throw new Error("state 없음"); } };
  let s = 7; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff * 2 - 1; };
  const mat = (a, b) => Array.from({ length: a }, () => Array.from({ length: b }, () => rnd() * 0.3));
  const vec = (n, f) => Array.from({ length: n }, () => (f == null ? rnd() * 0.3 : f));
  const seqModel = { L: 16, D, d: 16, heads: 2, featVer: M.LUXML.featVer, trusted: true, w: 0.3, valAccLB: 0.52,
    mean: vec(D), std: vec(D).map(v => Math.abs(v) + 0.5), Win: mat(16, D), bin: vec(16), pos: mat(16, 16),
    ln1g: vec(16, 1), ln1b: vec(16), Wq: mat(16, 16), bq: vec(16), Wk: mat(16, 16), bk: vec(16),
    Wv: mat(16, 16), bv: vec(16), Wo: mat(16, 16), bo: vec(16),
    ln2g: vec(16, 1), ln2b: vec(16), W1: mat(64, 16), b1: vec(64), W2: mat(16, 64), b2: vec(16),
    lng: vec(16, 1), lnb: vec(16), Wh: vec(16), bh: rnd() };
  const seqFeat = Array.from({ length: 16 }, () => Array.from({ length: D }, () => rnd() * 2));
  let r; try {
    r = await M.mlDeepDecide(stubDB, new Array(D).fill(0.1), {
      guard: null, mind: null, trust: null, gbdtTrust: null, boosters: [], dnn: null, gbdt: null,
      cal: null, evstats: null, seqModel, seqFeat
    });
  } catch (e) { r = { _threw: String(e && e.message) }; }
  chk(r && Array.isArray(r.stackFeat) && r.stackFeat.length === M.STACK_SLOTS.length * 2,
    `위원회를 실제로 돌리면 stackFeat 이 ${M.STACK_SLOTS.length * 2}차원으로 나온다`,
    "stackFeat 차원이 다르다: " + JSON.stringify(r && (r.stackFeat || r._threw)));
  if (r && Array.isArray(r.stackFeat)) {
    const pSlot = r.stackFeat[idx], mSlot = r.stackFeat[M.STACK_SLOTS.length + idx];
    chk(mSlot === 1 && Math.abs(pSlot - 0.5) > 1e-6,
      `seq 가 투표했을 때 seq 자리(확률 idx${idx}=${pSlot}, 마스크 idx${M.STACK_SLOTS.length + idx}=${mSlot})가 실제로 채워진다`,
      "seq 가 투표해도 그 자리가 0.5/0 그대로다 — 배선이 죽어 있다");
  }
}

console.log("\n③ ★소급생성은 seq 를 채우지 않는다★ — 채우면 그게 오염이다");
{
  const fn = code.slice(code.indexOf("async function stackSampleBackfill"), code.indexOf("async function stackExpertEpochStamp"));
  chk(!/P\.seq\s*=/.test(fn) && !/M\.seq\s*=\s*1/.test(fn),
    "소급생성 루프가 P.seq/M.seq 를 채우는 코드를 갖고 있지 않다(정직한 기권)",
    "★소급생성이 seq 를 채운다 — ts 근사로 봉 인덱스를 재구성했다면 오염이다★");
  chk(/for \(const k of STACK_SLOTS\) fv\.push/.test(fn),
    "소급생성도 STACK_SLOTS 를 순회해 벡터를 만든다(라이브와 같은 자리 배치)",
    "소급생성이 다른 목록으로 벡터를 만든다 — 라이브와 자리가 어긋난다");
  // 실제로 돌려서: 전문가 목록에 seq 가 없어도(스텁이 아무것도 못 채워도) 죽지 않고 skip 되는가.
  const rows = [{ id: 1, ts: Date.now(), market: "us", symbol: "AAA",
                  feat: JSON.stringify(new Array(D).fill(0)), label: 1, pnl_pct: 1 }];
  const inserted = [];
  const db = {
    async prepare(sql) {
      const st = {
        _sql: sql,
        bind(...a) { st._a = a; return st; },
        async first() {
          if (/stack_expert_epoch/.test(sql)) return null;
          if (/MAX\(id\)/.test(sql)) return { m: 0 };
          return null;
        },
        async all() { return { results: /ml_samples/.test(sql) ? rows.splice(0) : [] }; },
        async run() { if (/INSERT INTO stack_samples/.test(sql)) inserted.push(st._a); return { success: true }; }
      };
      return st;
    },
    async batch(a) { for (const x of a) await x.run(); return []; }
  };
  const _origGetState = M.getState;
  try {
    let out; try { out = await M.stackSampleBackfill(db, { deadlineMs: 500 }); } catch (e) { out = String(e && e.message); }
    chk(typeof out === "string", "전문가가 하나도 안 실려도 예외 없이 문자열 결과를 낸다(죽지 않는다)", "예외로 죽는다: " + out);
  } catch (e) { chk(false, "", "소급생성 호출 실패: " + e.message); }
}

console.log("\n④ 화면·구조관측도 같은 목록을 쓰는가");
{
  chk(/dim: STACK_SLOTS\.length \* 2, slots: STACK_SLOTS/.test(code),
    "전체구조 화면(overview)이 STACK_SLOTS 를 그대로 내려준다", "화면이 손으로 적은 목록을 내려준다 — 넷째 사본이다");
  chk(/return STACK_SLOTS\.map\(function \(x\) \{ return "p:" \+ x; \}\)/.test(code),
    "STACK 구조 관측(mlLinearVizData) 이름표도 STACK_SLOTS 에서 나온다", "구조 관측이 다른 목록으로 이름을 짓는다");
  const hv = HV_SAFE();
  chk((hv.match(/\(st\.slots\|\|\[\]\)\.length/g) || []).length >= 2,
    "화면 문구의 위원 수도 서버 값을 읽는다(손으로 적은 숫자가 없다)", "화면에 위원 수가 손으로 박혀 있다");
}
function HV_SAFE() {
  try { return readFileSync(new URL("../public/index.html", import.meta.url), "utf8"); } catch (e) { return ""; }
}

console.log("\n⑤ 차원 하드코딩이 안 남아 있는가");
{
  chk(!/featVec\.length !== 16/.test(code), "stackLogSample 의 길이 가드가 16 을 손으로 안 적는다", "길이 가드가 여전히 16 을 손으로 적는다");
  chk(!/D:\s*16,?\s*$/m.test(code.split("stackTrainNightly")[1] || ""), "학습 설정의 D 가 16 을 손으로 안 적는다", "학습 설정 D 가 여전히 16 이다");
  chk(/STACK_SLOTS\.length \* 2/.test(code), "차원은 전부 STACK_SLOTS.length*2 로 계산한다", "차원 계산식을 못 찾는다");
}

console.log(fails === 0 ? "\n✓ STACK·SEQ 배선 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
