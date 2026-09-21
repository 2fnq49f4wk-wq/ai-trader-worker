/* ═══════════════════════════════════════════════════════════════════════════
   [V33.400] 달력 소급 재각인 — 저장된 행의 죽은 달력 6칸을 ts 로 되살린다

   ■ 왜 필요했나 (측정이 먼저다)
     V33.399 는 FOMC 표가 2021-01 에서 시작하는 것을 원인으로 보고 2020 을 넣었다.
     같은 판에 심은 진단이 ★자릿수가 틀렸다★ 고 답했다(2026-09-21 회차):
       [달력결측] fomcKnown=0 비율 — 학습 ★99.88%★ · 검증 52.50%
       [달력분포] opexToNext σ0.568/최빈100% · fomcTo σ0.886/최빈100% · …6칸 전부
     ★opexToNext 도 최빈 100%★ 인 것이 결정적이다 — _opexCtx 는 표가 필요 없고
     유효한 ts 만 있으면 산술로 계산된다. 그것이 상수라면 원인은 표가 아니라
     ★수확 당시 obsTs 가 없었다★ 는 것이다. 여섯 칸이 전부 0 으로 박혔다.

   ■ 이 검사가 무는 것 — 이 고침이 조용히 망가지는 길
     ① 한 경로만 고친다 — D1 과 R2 스냅샷이 서로 다른 값을 내보낸다(이 저장소의 단골 사고).
     ② 멱등이 깨진다 — 제대로 찍힌 행의 실값을 덮어쓰면 고치려던 것보다 나빠진다.
     ③ ts 를 모르는데 지어낸다 — V33.265 가 명시적으로 금지한 것이다.
     ④ 꼬리 배치 가드가 빠진다 — 판이 바뀌면 엉뚱한 칸에 날짜가 적힌다.
     ⑤ 아무것도 안 하는데 아무도 모른다 — 건수를 응답에 싣지 않으면 조용히 죽는다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const D = (s) => Date.parse(s + "T00:00:00Z");

const N = M.LUXML.featNames.length, C = M.CAL_FEATS.length, SS = M.DS_FEATS.length;
const base = N - SS - C;
const mk = (ts, fill) => ({ ts: ts, x: new Array(N).fill(fill == null ? 0 : fill) });
const cal = (sm) => sm.x.slice(base, base + C);

console.log("① 죽은 행이 실제로 되살아나는가 (실행해서 확인)");
{
  const sm = mk(D("2022-06-15"));
  const r = M._calRestampSamples([sm]);
  const want = M._calFeats(D("2022-06-15"));
  const got = cal(sm);
  chk(r.n === 1 && r.changed === 1, "1건을 만졌고 1건이 실제로 바뀌었다",
    "되살리지 않았다: " + JSON.stringify(r));
  chk(M.CAL_FEATS.every((k, i) => got[i] === want[k]),
    "되살린 값이 라이브 조립(_calFeats)과 ★완전히 같다★ — " + JSON.stringify(got),
    "★라이브와 다른 값을 적는다★ 기대 " + JSON.stringify(M.CAL_FEATS.map(k => want[k])) + " vs " + JSON.stringify(got));
  chk(got[M.CAL_FEATS.indexOf("fomcKnown")] === 1,
    "fomcKnown 이 0 → 1 로 살아난다(학습구간 99.88% 가 이 상태였다)",
    "★되살렸는데도 fomcKnown 이 0 이다★");
}

console.log("\n② ★멱등★ — 제대로 찍힌 행의 실값을 덮어쓰지 않는가");
{
  const sm = mk(D("2024-03-11"));
  M._calRestampSamples([sm]);
  const once = cal(sm).join(",");
  const r2 = M._calRestampSamples([sm]);
  chk(r2.changed === 0 && cal(sm).join(",") === once,
    "두 번째 통과에서 바뀐 것이 0 — 같은 ts 면 같은 값이다",
    "★멱등이 아니다 — 통과할 때마다 값이 흔들린다★");
  // 라이브 행(ts == obsTs)도 값이 보존돼야 한다
  const live = { ts: D("2026-06-15"), x: new Array(N).fill(0) };
  const lv = M._calFeats(live.ts);
  for (let i = 0; i < C; i++) live.x[base + i] = lv[M.CAL_FEATS[i]];
  const r3 = M._calRestampSamples([live]);
  chk(r3.changed === 0, "이미 옳은 라이브 행은 한 칸도 안 바뀐다", "★옳은 행을 건드린다★");
}

console.log("\n③ 모르는 것은 지어내지 않는가");
{
  for (const [ts, why] of [[0, "ts=0(결측)"], [D("1995-01-02"), "2000년 이전"], [-1, "음수"]]) {
    const sm = mk(ts, 7);
    const r = M._calRestampSamples([sm]);
    if (!(r.skipped === 1 && r.n === 0 && sm.x.every(v => v === 7))) {
      console.log("  FAIL ★" + why + " 인데 달력을 적었다★ " + JSON.stringify(r)); fails++;
    }
  }
  console.log("  ok   ts 를 모르면 기권한다(ts=0 · 2000년 이전 · 음수) — Date.now() 로 때우지 않는다");
  /* ★함수 본문만 떼어낸다.★ 고정 폭으로 보면 ★다음 함수★ 의 Date.now() 를 잡는다 —
     처음 이 검사를 그렇게 써서 멀쩡한 코드를 실패로 읽었다(게이트가 소스를 문자열로
     보는 것의 전형적인 실수다). 괄호를 세서 본문 끝을 찾는다. */
  const _fnBody = (name) => {
    const i = S.indexOf("function " + name);
    if (i < 0) return "";
    let d = 0, k = S.indexOf("{", i), e = k;
    for (; e < S.length; e++) { const c = S[e]; if (c === "{") d++; else if (c === "}") { d--; if (d === 0) break; } }
    return S.slice(k, e + 1);
  };
  const BODY = _fnBody("_calRestampSamples");
  chk(BODY.length > 200, "재각인 본문을 " + BODY.length + "자 떼어냈다", "본문 추출이 깨졌다");
  chk(!/Date\.now\(\)/.test(BODY),
    "재각인 본문 안에 Date.now() 가 없다", "★재각인이 Date.now() 를 쓴다 — 옛 행에 오늘 날짜가 붙는다★");
}

console.log("\n④ 달력 칸 밖은 건드리지 않는가 · 꼬리 배치 가드");
{
  const sm = mk(D("2022-06-15"), 3);
  M._calRestampSamples([sm]);
  chk(sm.x.slice(0, base).every(v => v === 3), "달력 앞 " + base + "칸이 그대로다", "★앞칸을 덮어쓴다★");
  chk(sm.x.slice(N - SS).every(v => v === 3), "DS 꼬리 " + SS + "칸이 그대로다", "★DS 꼬리를 덮어쓴다★");
  const bad = { ts: D("2022-06-15"), x: new Array(N - 1).fill(0) };
  const rb = M._calRestampSamples([bad]);
  chk(rb.n === 0 && bad.x.length === N - 1, "폭이 다른 행은 손대지 않는다", "★폭이 다른데 적는다★");
  chk(/for \(let i = 0; i < C; i\+\+\) if \(names\[base \+ i\] !== CAL_FEATS\[i\]\) return out;/.test(S),
    "달력 6종이 그 자리가 아니면 ★아무것도 안 한다★(배치 가드)",
    "★꼬리 배치를 확인하지 않는다 — 판이 바뀌면 엉뚱한 칸에 날짜가 적힌다★");
}

console.log("\n⑤ ★두 경로가 모두 지나는가 — 한쪽만 고치면 출처가 갈라진다★");
{
  // 정의 1 + 호출 2(D1 · R2). 호출이 하나라도 빠지면 두 출처가 갈라진다.
  const hits = (S.match(/_calRestampSamples\(/g) || []).length;
  chk(hits >= 3, "_calRestampSamples 가 정의 1 + 호출 2 = " + hits + "곳",
    "★_calRestampSamples 가 " + hits + "곳뿐 — 경로 하나가 빠졌다★");
  /* ★표본을 싣는 R2 응답★ 에 앵커를 건다. source:"r2" 는 두 번 나오는데 앞의 것은
     파트 소진 시의 빈 응답이라 재각인할 것이 없다 — 거기에 앵커를 걸면 멀쩡한 배선을
     실패로 읽는다(처음 이 검사를 그렇게 썼다). samples 를 싣는 쪽으로 잡는다. */
  const i2 = S.lastIndexOf('source: "r2"');
  const r2blk = S.slice(Math.max(0, i2 - 1200), i2 + 900);
  chk(/_calRestampSamples\(_arr\)/.test(r2blk),
    "R2 스냅샷 경로가 재각인을 지난다", "★R2 경로가 옛 값을 그대로 내보낸다 — D1 과 값이 갈린다★");
  const i1 = S.indexOf("const _last = raw.length ? raw[raw.length - 1] : null;");
  const d1blk = S.slice(Math.max(0, i1 - 600), i1 + 800);
  chk(/_calRestampSamples\(out\)/.test(d1blk),
    "D1 직접 경로가 재각인을 지난다", "★D1 경로가 옛 값을 그대로 내보낸다★");
}

console.log("\n⑥ 조용히 아무것도 안 하면 보이는가 (건수가 응답에 실린다)");
{
  for (const k of ["calRestamped", "calRestampChanged", "calRestampSkipped"]) {
    const n = (S.match(new RegExp(k + ":", "g")) || []).length;
    if (n < 2) { console.log("  FAIL ★" + k + " 가 " + n + "곳 — 두 경로 모두에 실려야 한다★"); fails++; }
  }
  console.log("  ok   만진 수·바뀐 수·기권한 수가 ★두 경로 모두★ 의 응답에 실린다");
}

console.log("\n⑦ 달력 계산은 여전히 한 곳에만 사는가");
{
  const f = S.slice(S.indexOf("function _calRestampSamples"), S.indexOf("function _calRestampSamples") + 1400);
  chk(/_calFeats\(ts\)/.test(f), "재각인이 라이브와 ★같은 _calFeats★ 를 부른다",
    "★재각인이 달력을 따로 계산한다 — 두 구현은 언젠가 갈라진다★");
  chk(!/thirdFriday|FOMC_DAYS|getUTCDay/.test(f),
    "재각인 안에 날짜 산술이 없다", "★재각인이 달력을 다시 구현했다★");
}

console.log("\n⑧ 선점 재시작이 같은 일을 두 번 하지 않는가 (진행 기록이 단계마다 남는가)");
{
  const PY = readFileSync(new URL("../trainer/modal/modal_train.py", import.meta.url), "utf8");
  chk(/def _persist_progress\(\):/.test(PY),
    "_persist_progress 가 있다 — 진행을 단계마다 적는다",
    "★진행 기록이 회차 끝에서만 남는다 — 컨테이너가 죽으면 통째로 사라진다★");
  // _stage 본문 끝에서 호출돼야 한다(적립·기록 뒤)
  const i = PY.indexOf("def _stage(name, fn):");
  const blk = PY.slice(i, i + 1800);
  chk(/_costs\[name\] = _next_cost[\s\S]{0,240}_persist_progress\(\)/.test(blk),
    "단계가 끝날 때마다(실측 적립 뒤) 저장한다",
    "★단계 종료 시 저장하지 않는다 — 선점 재시작이 같은 일을 다시 한다★");
  chk(/_store\["last_ok"\] = _last_ok/.test(PY.slice(PY.indexOf("def _persist_progress"), PY.indexOf("def _persist_progress") + 500)),
    "last_ok(언제 마지막으로 돌았나)를 적는다", "★last_ok 를 안 적는다 — 굶주림 순서가 재시작에서 되감긴다★");
  chk(/_store\["stage_cost"\] = _costs/.test(PY.slice(PY.indexOf("def _persist_progress"), PY.indexOf("def _persist_progress") + 500)),
    "stage_cost(단계 실측)를 적는다", "★실측을 안 적는다 — 다음 회차 예산이 추측으로 되돌아간다★");
  // 회차 끝 저장은 그대로 남아 있어야 한다(둘 다 필요하다 — 끝 저장은 last_run 을 남긴다)
  chk(/_store\["last_run"\] = \{/.test(PY),
    "회차 끝 저장(last_run)은 그대로다", "회차 요약 저장이 사라졌다");
}

console.log(fails === 0 ? "\n✓ 달력 소급 재각인 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
