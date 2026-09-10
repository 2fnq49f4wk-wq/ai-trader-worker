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
/* [V33.338] ★평범한 객체로 이름표를 만들면 Object.prototype 이 섞인다.★
   R 이 {} 였다. 그래서 코드에 toLocaleString·toString·valueOf·constructor 같은 이름이
   나오면 R[name] 이 ★상속된 프로토타입 메서드★ 를 돌려주어 "아는 함수" 로 취급됐다.
   그 뒤 ownChannels 가 R[fn] 의 [0]·[1] 을 읽으면 undefined 라
   lines.slice(undefined, undefined) = ★파일 전체★ 가 되고, 파일 안 모든 setState 가
   그 단계의 산출물로 붙는다 — 실제로 dnn 단계가 daily:·quote:·hist: 를 쓴다고 보고
   순서 위반 25건을 만들어냈다(V33.338 에서 .toLocaleString() 한 줄을 추가하자 터졌다).
   이름표를 담는 그릇은 프로토타입이 없어야 한다. */
function fnRanges() {
  const out = Object.create(null);
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
// 한 함수 ★본문에 직접 적힌★ 채널.
function ownChannels(fn) {
  const rg = R[fn];
  if (!rg) return null;
  const body = lines.slice(rg[0], rg[1]).join("\n");
  const reads = new Set(), writes = new Set(), calls = new Set();
  for (const m of body.matchAll(/setState\([^,]+,\s*"([a-zA-Z0-9_:.]+)"/g)) writes.add(m[1]);
  for (const m of body.matchAll(/getState\([^,]+,\s*"([a-zA-Z0-9_:.]+)"/g)) reads.add(m[1]);
  for (const m of body.matchAll(/getStates\([^,]+,\s*\[([^\]]*)\]/g))
    for (const k of m[1].matchAll(/"([a-zA-Z0-9_:.]+)"/g)) reads.add(k[1]);
  // 최상위 헬퍼 호출 — 채널 전파에 쓴다.
  for (const m of body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) if (R[m[1]] && m[1] !== fn) calls.add(m[1]);
  return { reads, writes, calls };
}
// [V33.115] ★헬퍼를 타고 넘어가 채널을 모은다.★
//   종전엔 단계 본문에 ★직접 적힌★ getState/setState 만 봤다. 그런데 실제 코드는 조회를
//   헬퍼로 감싸는 게 보통이다 — 예: mlPoolUniqGet(DB) 안에서 ml_pool_uniq 를 읽는다.
//   그러면 그 의존관계가 그래프에서 통째로 사라지고, 순서가 뒤집혀도 게이트가 통과한다.
//   "검사했는데 못 잡았다" 는 이 저장소가 이미 여러 번 겪은 실패 형태다(V33.111 주석 참조).
//   깊이 제한 + 순환 방지로 전이 폐포를 구한다.
const _chCache = new Map();
function channels(fn, depth, seen) {
  depth = depth == null ? 3 : depth;
  seen = seen || new Set();
  if (depth === 3 && _chCache.has(fn)) return _chCache.get(fn);
  const own = ownChannels(fn);
  if (!own) return null;
  const reads = new Set(own.reads), writes = new Set(own.writes);
  if (depth > 0 && !seen.has(fn)) {
    seen.add(fn);
    for (const c of own.calls) {
      const sub = channels(c, depth - 1, seen);
      if (!sub) continue;
      for (const k of sub.reads) reads.add(k);
      for (const k of sub.writes) writes.add(k);
    }
    seen.delete(fn);
  }
  const out = { reads, writes };
  if (depth === 3) _chCache.set(fn, out);
  return out;
}

// ── 4) 의도된 역방향(어제 산출물을 쓰는 자리) ─────────────────────────────────
//   여기 적힌 것만 역방향이 허용된다. 새 역방향이 생기면 게이트가 잡는다.
const INTENDED = {
  /* [V33.193] portstats 가 DSR(디플레이션 샤프)의 ★시도 집합★ 을 만들려고 어제의 전략 검정
     결과를 읽는다. 정방향으로 돌리려면 selfreview 를 앞으로 당겨야 하는데, selfreview 는
     그날의 원장 통계를 쓰는 쪽이라 순서를 뒤집으면 이번에는 그쪽이 어제 값을 보게 된다
     (진짜 순환이다). 어제 값을 쓰는 게 맞는 이유:
       · 시도 집합의 크기 K 는 '어떤 전략들을 검정하고 있나' 이고, 이건 하루 만에 안 바뀐다.
       · 시도들 사이의 SR 표준편차 σ(SR)도 하루치 거래로는 거의 안 움직인다.
     즉 여기서 필요한 것은 ★어제와 오늘이 사실상 같은 값★ 이라, 하루 지연이 판정을 바꾸지 않는다.
     (바뀌는 것은 그 시장 자신의 SR 이고, 그건 오늘 값으로 계산한다.) */
  "portstats<-selfreview": "DSR 시도집합: 어제 전략 검정 결과(하루 지연이 판정을 안 바꾼다)",
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
  "stackepoch<-memo": "설계: 전문가 학습 직전 기준선",
  // ── 아래는 헬퍼 추적(V33.115)으로 새로 드러난 간선이다. 전부 확인 후 의도된 것으로 판정했다.
  //   종전 게이트는 이 간선들을 ★보지도 못했다★ — 통과가 아니라 사각지대였다.
  // 감성 학습은 '수집된 뉴스'로 어휘 계수를 적합한다. 수집기는 그 계수로 오늘 뉴스를 점수화하는데,
  // 오늘 뉴스로 학습한 계수로 오늘 뉴스를 채점하면 그건 자기참조다 — 어제 계수를 쓰는 게 맞다.
  "senti<-sentilearn": "설계: 어제 학습한 어휘로 오늘 뉴스를 채점(자기참조 방지)",
  // mind_model 은 ★두 곳★ 이 쓴다: mind(#12, 야간 재학습)와 mindshadow(#27, 섀도우 승격).
  // 아래 독자들의 실제 생산자는 mind(#12)이고 그건 정방향이다. mindshadow 는 같은 채널에
  // 조건부로 덧쓰는 두 번째 기록자라 역방향으로 보일 뿐이다(승격은 그 다음날부터 반영된다).
  "gbdt<-mindshadow": "채널 이중기록: 실제 생산자는 mind(#12) — 정방향",
  "dnn<-mindshadow": "채널 이중기록: 실제 생산자는 mind(#12) — 정방향",
  "expreg<-mindshadow": "채널 이중기록: 실제 생산자는 mind(#12) — 정방향",
  "stackbf<-mindshadow": "누출방지: 어제 전문가로 채점(stackbf<-mind 와 같은 이유)"
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

/* ─────────────────────────────────────────────────────────────────────────
   [V33.259] 관측 가능성 — 단계가 도는 것과 ★돌았는지 볼 수 있는 것★ 은 다르다

   rv_panel 이 실제로 그랬다. V33.250 에서 xspanel 바로 뒤에 넣었고 크론·수동
   파이프라인 양쪽에 제대로 배선돼 있었는데, /api/pipeline 의 단계 목록에는
   형제인 xs_panel 만 있고 rv_panel 이 빠졌다. 그 결과 "PR_OU·XS_ARB 가 아직
   한 번도 발화하지 않았다" 를 만났을 때 ★패널이 없어서인지 조건이 안 맞아서인지
   구분할 수가 없었다★. 로그는 하루 한 줄이라 조회 창(약 3시간) 밖으로 밀린다.

   패널류는 '하루 한 번 만들어 온종일 읽는' 물건이라 신선도가 곧 기능이다.
   그러니 패널을 만드는 단계는 예외 없이 화면 목록에 있어야 한다. */
{
  console.log("");
  const _sub = src.slice(src.indexOf('path === "/api/pipeline"'));
  const _subs = _sub.slice(0, _sub.indexOf("];"));
  const shown = [...new Set([..._subs.matchAll(/key:\s*"([a-z_0-9:]+)"/g)].map(m => m[1]))];
  // 패널을 만드는 함수가 어느 상태 키에 쓰는지 코드에서 뽑는다 — 목록을 손으로 적지 않는다.
  const wanted = [];
  for (const fn of ["mlBuildXSPanel", "rvBuildPanel"]) {
    const i = src.indexOf("\nasync function " + fn + "(");
    if (i < 0) { bad(fn + " 를 찾지 못했다"); continue; }
    let j = src.indexOf("{", i), d = 0, k = j;
    for (; k < src.length; k++) { const c = src[k]; if (c === "{") d++; else if (c === "}") { d--; if (d === 0) break; } }
    const body = src.slice(j, k + 1);
    const m = [...body.matchAll(/setState\(\s*DB\s*,\s*"([a-z_0-9]+)"/g)].map(x => x[1]);
    for (const key of m) wanted.push({ fn: fn, key: key });
  }
  ok("패널 생성기가 쓰는 상태 키 " + wanted.length + "개를 코드에서 뽑았다 (" +
     wanted.map(w => w.key).join(", ") + ")");
  const unseen = wanted.filter(w => shown.indexOf(w.key) < 0);
  if (unseen.length) {
    bad("화면 단계 목록에 없는 패널: " + unseen.map(w => w.key + "(" + w.fn + ")").join(", ") +
        " → 돌았는지 볼 수 없다");
  } else ok("패널 " + wanted.length + "종이 전부 /api/pipeline 단계 목록에 있다 — 신선도를 눈으로 잰다");
}

/* [V33.338] ★이 검사 자신의 함정을 못박는다.★
   이름표 그릇이 다시 {} 로 돌아가면 Object.prototype 메서드(toString·valueOf·toLocaleString…)가
   "아는 함수" 로 잡히고, ownChannels 가 undefined 범위를 slice 해 ★파일 전체★ 를 한 단계의
   본문으로 읽는다 — 없는 순서 위반 수십 건이 생긴다. 실제로 V33.338 에서 소스에
   .toLocaleString() 한 줄이 늘자 위반 25건이 터졌다(코드가 아니라 이 검사가 틀린 것이었다). */
{
  const R2 = fnRanges();
  const polluted = ["toLocaleString", "toString", "valueOf", "constructor", "hasOwnProperty"]
    .filter((k) => R2[k] !== undefined);
  if (!polluted.length) ok("함수 이름표에 프로토타입이 안 섞인다(toString·valueOf 등이 '아는 함수'로 안 잡힌다)");
  else { console.log("  FAIL ★이름표에 프로토타입이 섞였다: " + polluted.join(", ") + " — 파일 전체가 한 단계 산출물이 된다★"); fails++; }
}

console.log(fails ? "\n파이프라인 그래프 위반 " + fails + "건" : "\n  ok   파이프라인 그래프 통과");
process.exit(fails ? 1 : 0);
