// [V33.108] LangGraph 식 파이프라인 그래프 검증기.
//
//   LangGraph(StateGraph)의 핵심은 "노드가 어떤 상태 채널을 읽고 쓰는지 선언하고,
//   실행기가 그 의존관계로 순서를 검증·결정한다" 는 것이다. 우리 야간 파이프라인은
//   34단계가 한 줄로 늘어서 있고, 순서 근거는 전부 ★주석★ 이다:
//     · "stackbf 는 전문가 재학습 앞이어야 누출이 없다"     (V33.104)
//     · "expreg 는 전문가 재학습 뒤여야 한다"               (V33.107)
//     · "portstats 는 calibrate 보다 앞"                    (V33.90)
//     · "xspanel 은 harvest 앞(정규화에 쓴다)"              (V33.x)
//   주석은 실행되지 않는다. 실제로 V33.104 에서 stackbf 순서 때문에 STACK 이 통째로
//   in-sample 누출이었고, 아무도 그걸 못 잡았다.
//
//   → 선언을 사람이 다시 쓰게 하지 않는다. ★코드에서 그래프를 추출★ 한다.
//     각 야간 함수 본문의 getState/setState 를 읽어 read/write 채널을 뽑고,
//     "B 가 읽는 키를 A 가 쓴다" 면 A→B 간선을 만든 뒤, 크론 실행순서가 그 간선을
//     거스르지 않는지 검사한다. 함수가 바뀌면 그래프도 자동으로 따라 바뀐다.
//
//   위반은 두 종류다.
//     ① 순서 위반  — B 가 A 의 산출물을 읽는데 B 가 먼저 돈다(그날 값은 ★어제 것★ 이다)
//     ② 자기참조   — 같은 키를 읽고 쓰는 누적 버퍼(정상). 간선에서 제외한다.
//   ①이 전부 나쁜 건 아니다 — 의도적으로 '어제 모델'을 쓰는 자리가 있다(전진검증·누출방지).
//   그래서 의도된 역방향은 INTENDED 에 명시해 두고, 명시되지 않은 역방향만 실패시킨다.
//   즉 이 파일이 곧 ★기계가 읽는 순서 계약서★ 다.

import fs from "node:fs";

const src = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const lines = src.split("\n");

let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.log("  FAIL " + m); };

// ── 1) 크론 실행 순서 추출 ────────────────────────────────────────────────────
const order = [];
const stageFn = {};
// _stg("name", ...) 위치를 먼저 찾고, 그 콜백 안에서 처음 나오는 `await <fn>(` 를 그 단계의
//   본체로 본다. 단계마다 작성 형태가 조금씩 달라(한 줄/여러 줄/const 대입) 한 방 정규식으로
//   묶으면 조용히 몇 개를 놓친다 — 놓치면 검사가 통과처럼 보여서 더 위험하다.
for (const m of src.matchAll(/_stg\(\s*"([a-z0-9]+)"\s*,/g)) {
  const seg = src.slice(m.index, m.index + 600);
  const f = seg.match(/await ([A-Za-z_$][\w$]*)\s*\(/);
  order.push(m[1]);
  stageFn[m[1]] = f ? f[1] : null;
}
if (order.length < 20) { bad("크론 단계 추출 실패 (" + order.length + "개) — 정규식이 실제 코드와 어긋났다"); }
else ok("크론 단계 " + order.length + "개 추출");
const pos = {}; order.forEach((n, i) => { pos[n] = i; });

// ── 2) 수동 파이프라인(target=all)이 크론과 같은 순서인가 ──────────────────────
//   "수동 1회 == 야간 1회" 가 아니면 수동 실행으로 검증한 결과를 믿을 수 없다.
{
  const mm = src.match(/const _PIPE = \[([\s\S]*?)\n      \];/);
  if (!mm) bad("수동 파이프라인(_PIPE) 을 찾지 못했다");
  else {
    const manual = [...mm[1].matchAll(/\["([a-z0-9]+)",/g)].map((x) => x[1]);
    const missing = order.filter((n) => manual.indexOf(n) < 0);
    const extra = manual.filter((n) => order.indexOf(n) < 0);
    if (missing.length) bad("수동 파이프라인에 빠진 단계: " + missing.join(", "));
    if (extra.length) bad("수동 파이프라인에만 있는 단계: " + extra.join(", "));
    // 상대순서 비교 — 크론에 있는 단계들만 추려 순서가 같아야 한다.
    const mFiltered = manual.filter((n) => order.indexOf(n) >= 0);
    const mism = [];
    for (let i = 0; i < Math.min(mFiltered.length, order.length); i++)
      if (mFiltered[i] !== order[i]) { mism.push("#" + i + " 크론 " + order[i] + " vs 수동 " + mFiltered[i]); break; }
    if (!missing.length && !extra.length && !mism.length) ok("수동 파이프라인 == 크론 (" + manual.length + "단계, 순서 동일)");
    else if (mism.length) bad("수동/크론 순서 불일치: " + mism.join(" | "));
  }
}

// ── 3) 함수별 상태 채널(read/write) 추출 ──────────────────────────────────────
//   최상위 함수의 줄 범위를 잡고, 그 안의 getState/setState 키를 모은다.
//   (중첩 함수는 부모 범위에 포함된다 — 실행되면 어차피 부모가 부른 것이므로 맞다)
function fnRanges() {
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(?:async )?function (\w+)\s*\(/);
    if (!m) continue;
    // 다음 최상위 선언 전까지가 이 함수의 범위(열 0 선언만 최상위라는 저장소 규약을 이용)
    let j = i + 1;
    for (; j < lines.length; j++) if (/^(?:async )?function \w+\s*\(|^const \w+ = |^let \w+ = /.test(lines[j])) break;
    out[m[1]] = [i, j];
  }
  return out;
}
const R = fnRanges();
function channels(fn) {
  const rg = R[fn];
  if (!rg) return null;
  const body = lines.slice(rg[0], rg[1]).join("\n");
  const reads = new Set(), writes = new Set();
  for (const m of body.matchAll(/setState\([^,]+,\s*"([a-zA-Z0-9_:.]+)"/g)) writes.add(m[1]);
  for (const m of body.matchAll(/getState\([^,]+,\s*"([a-zA-Z0-9_:.]+)"/g)) reads.add(m[1]);
  for (const m of body.matchAll(/getStates\([^,]+,\s*\[([^\]]*)\]/g))
    for (const k of m[1].matchAll(/"([a-zA-Z0-9_:.]+)"/g)) reads.add(k[1]);
  return { reads, writes };
}

// ── 4) 의도된 역방향(어제 산출물을 쓰는 자리) ─────────────────────────────────
//   여기 적힌 것만 역방향이 허용된다. 새 역방향이 생기면 게이트가 잡는다.
const INTENDED = {
  // stackbf 는 ★어제 전문가★ 로 채점해야 out-of-sample 이 된다(V33.104).
  "stackbf<-l1": "누출방지: 어제 전문가로 채점",
  "stackbf<-brain": "누출방지: 어제 전문가로 채점",
  "stackbf<-mind": "누출방지: 어제 전문가로 채점",
  "stackbf<-gbdt": "누출방지: 어제 전문가로 채점",
  "stackbf<-dnn": "누출방지: 어제 전문가로 채점",
  "stackbf<-memo": "누출방지: 어제 전문가로 채점",
  "stackbf<-bandit": "누출방지: 어제 전문가로 채점",
  // stackepoch 는 오늘 학습 구간의 상한을 '학습 전에' 못 박는 자리다.
  "stackepoch<-l1": "설계: 전문가 학습 직전 기준선",
  "stackepoch<-brain": "설계: 전문가 학습 직전 기준선",
  "stackepoch<-mind": "설계: 전문가 학습 직전 기준선",
  "stackepoch<-gbdt": "설계: 전문가 학습 직전 기준선",
  "stackepoch<-dnn": "설계: 전문가 학습 직전 기준선",
  "stackepoch<-memo": "설계: 전문가 학습 직전 기준선"
};

// ── 5) 그래프 구성 + 순서 검증 ────────────────────────────────────────────────
{
  const ch = {};
  let noRange = [];
  for (const st of order) {
    if (!stageFn[st]) { noRange.push(st + "(본체 미검출)"); continue; }
    const c = channels(stageFn[st]);
    if (!c) { noRange.push(st + "(" + stageFn[st] + ")"); continue; }
    ch[st] = c;
  }
  if (noRange.length) console.log("  info 본문 범위를 못 잡은 단계(검사 제외): " + noRange.join(", "));

  const violations = [], edges = [];
  for (const b of Object.keys(ch)) {
    for (const key of ch[b].reads) {
      for (const a of Object.keys(ch)) {
        if (a === b) continue;                    // 자기 누적 버퍼는 간선 아님
        if (!ch[a].writes.has(key)) continue;
        if (ch[b].writes.has(key)) continue;      // b 도 쓰는 키 = 공유 누적(순서 무관)
        edges.push([a, b, key]);
        if (pos[a] < pos[b]) continue;            // 정방향 — 정상
        const tag = b + "<-" + a;
        if (INTENDED[tag]) continue;              // 의도된 역방향
        violations.push(b + "(#" + pos[b] + ") 가 " + a + "(#" + pos[a] + ") 의 산출물 '" + key +
                        "' 를 읽는데 먼저 돈다 — 그날 값은 어제 것이다");
      }
    }
  }
  ok("상태 채널 간선 " + edges.length + "개 추출 (단계 " + Object.keys(ch).length + "개)");
  if (violations.length) {
    bad("순서 위반 " + violations.length + "건:\n    " + violations.slice(0, 10).join("\n    "));
  } else ok("순서 위반 없음 — 모든 간선이 실행순서와 일치(의도된 역방향 " + Object.keys(INTENDED).length + "건 제외)");

  // 의도된 역방향이 실제로 아직 역방향인지도 확인 — 코드가 바뀌어 정방향이 되면
  // 그 예외는 죽은 규칙이므로 지워야 한다(계약서가 낡는 것을 막는다).
  const stale = [];
  for (const tag of Object.keys(INTENDED)) {
    const [b, a] = tag.split("<-");
    if (pos[a] == null || pos[b] == null) { stale.push(tag + "(단계 없음)"); continue; }
    if (pos[a] < pos[b]) stale.push(tag + "(이제 정방향)");
  }
  if (stale.length) console.log("  info 정리 대상 예외: " + stale.join(", "));
  else ok("의도된 역방향 예외 " + Object.keys(INTENDED).length + "건 모두 유효");
}

console.log(fails ? "\n파이프라인 그래프 위반 " + fails + "건" : "\n  ok   파이프라인 그래프 통과");
process.exit(fails ? 1 : 0);
