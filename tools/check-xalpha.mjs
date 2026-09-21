// [V33.155] XALPHA(형식알파) 계약.
//
//   ★왜 손댔나★ 운영 스냅샷에서 XALPHA 는 "홀드아웃 t 0.71 < 1.65 — 잡음과 구별되지 않는다" 로
//   위원회에서 배제돼 있었다. 잡음과 구별이 안 되면 존재할 이유가 없다. 세 가지를 고쳤다:
//     ① 홀드아웃이 오염돼 있었다(퍼징 구간이 흡수됨 — check-purge 가 지킨다). valAcc 2.4159 가 증거.
//     ② 형식알파를 ★원값★ 으로 넣고 있었다. WorldQuant 101 의 rank() 는 횡단면 순위다.
//     ③ 하루짜리 알파로 10일 라벨을 맞히려 했다. 논문의 decay_linear 로 지평을 맞춘다.
//
//   이 게이트가 지키는 것은 ★그 세 가지가 다시 무너지지 않는 것★ 이다.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const grab = (n) => {
  let i = src.indexOf("function " + n + "(");
  if (i < 0) throw new Error("함수를 못 찾았다: " + n);
  if (src.slice(i - 6, i) === "async ") i -= 6;
  let d = 0;
  for (let k = src.indexOf("{", i); k < src.length; k++) {
    if (src[k] === "{") d++; else if (src[k] === "}") { d--; if (!d) return src.slice(i, k + 1); }
  }
  throw new Error("함수 끝을 못 찾았다: " + n);
};
const cblk = (n) => { const i = src.indexOf("const " + n + " = {"); return src.slice(i, src.indexOf("\n};", i) + 3); };

const M = new vm.Script(`
function _num(v,d){var n=Number(v);return isFinite(n)?n:d;}
function _clamp(v,a,b){return v<a?a:(v>b?b:v);}
${cblk("XALPHA")}
const XA_NALPHA=10; const XA_DECAY_D=5;
${grab("_xaDelta")}${grab("_xaCorr")}${grab("_xaTsRank")}${grab("_xaXsRank")}${grab("_rvAnnPct")}${grab("_altBarIdx")}
${grab("xalphaRawAlphas")}${grab("xalphaDecayAlphas")}${grab("xalphaBuildPanel")}${grab("xalphaBuildFeat")}
${grab("_tToZ")}${grab("_tSf")}${grab("_icBlockStats")}
({raw:xalphaRawAlphas,dec:xalphaDecayAlphas,panel:xalphaBuildPanel,feat:xalphaBuildFeat,
  blk:_icBlockStats,barIdx:_altBarIdx,XALPHA,XA_NALPHA,XA_DECAY_D});
`).runInNewContext({ Math, Number, Array, isFinite, Map });

let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.error("  FAIL " + m); };
const chk = (c, g, n) => c ? ok(g) : bad(n);
const randn = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const mkUni = (n, bars) => {
  const cache = {};
  for (let s = 0; s < n; s++) {
    const base = Math.exp(Math.log(10) + Math.random() * 9), vm2 = 0.5 + Math.random() * 2.5;
    const C = [], O = [], H = [], L = [], V = []; let px = base;
    for (let i = 0; i < (bars || 60); i++) {
      const r = randn() * 0.02 * vm2, o = px; px *= 1 + r;
      C.push(px); O.push(o);
      H.push(Math.max(o, px) * (1 + Math.abs(randn()) * 0.006 * vm2));
      L.push(Math.min(o, px) * (1 - Math.abs(randn()) * 0.006 * vm2));
      V.push(1e5 * (1 + Math.random() * 3));
    }
    cache["S" + s] = { closes: C, opens: O, highs: H, lows: L, volumes: V };
  }
  return cache;
};

// ── ① 피처 형태 ────────────────────────────────────────────────────────────
{
  const cache = mkUni(200), panel = M.panel(cache, "us"), f = M.feat("S0", cache, panel);
  chk(f && f.length === M.XALPHA.featNames.length,
    `피처 개수(${f ? f.length : 0})가 featNames(${M.XALPHA.featNames.length})와 같다`,
    `피처 개수 ${f ? f.length : 0} ≠ featNames ${M.XALPHA.featNames.length} — 학습기 D 와 어긋나 전 표본이 버려진다`);
  chk(f && f.every((x) => x >= 0 && x <= 1),
    "모든 피처가 [0,1] — 횡단면 랭크라 종목 규모·그날 시장 등락이 빠진다",
    "랭크가 아닌 값이 섞여 있다 — 종목 스케일이 그대로 들어간다");
  // 이름 순서가 벡터 순서와 같아야 구조 관측 화면이 계수에 맞는 이름을 붙인다
  const nm = M.XALPHA.featNames;
  const okOrder = nm.slice(0, 10).every((x) => /^a/.test(x))
               && nm.slice(10, 20).every((x) => /^d/.test(x))
               && nm.slice(20).every((x) => /^xs/.test(x));
  chk(okOrder, "featNames 순서가 벡터 순서(원값10 → 감쇠10 → 횡단면5)와 같다",
    "featNames 순서가 push 순서와 다르다 — 구조 화면이 계수에 엉뚱한 이름을 붙인다");
}

// ── ② ★누출★ — 미래 봉이 과거 시점 알파를 바꾸면 안 된다 ────────────────────
//   decay_linear 는 과거 시점 알파를 여러 개 계산한다. 헬퍼(_xaDelta·_xaCorr·_xaTsRank)가
//   전부 '배열의 끝' 기준이라, 인덱스만 옮기고 배열을 안 자르면 그 헬퍼들만 오늘을 본다.
//   그러면 ★과거 시점 알파가 미래를 보는★ 셈이 된다 — 홀드아웃 IC 를 통째로 못 믿게 된다.
{
  const cache = mkUni(30, 60);
  const before = M.raw("S0", cache, 3);
  const c2 = JSON.parse(JSON.stringify(cache));
  for (const k in c2) {
    const d = c2[k], last = d.closes[d.closes.length - 1];
    d.closes.push(last * 1.5); d.opens.push(last); d.highs.push(last * 1.6); d.lows.push(last * 0.9); d.volumes.push(9e9);
  }
  const after = M.raw("S0", c2, 4);   // 봉이 하나 늘었으니 back 을 1 늘리면 같은 시점
  chk(before && after && before.every((v, i) => Math.abs(v - after[i]) < 1e-9),
    "미래 봉을 붙여도 같은 시점의 알파는 한 자리도 바뀌지 않는다",
    "미래 봉이 과거 시점 알파를 바꾼다 — 배열을 자르지 않아 헬퍼가 오늘을 본다(누출)");
}

// ── ③ 랭크의 모집단 ────────────────────────────────────────────────────────
{
  const thin = mkUni(10);
  chk(M.feat("S0", thin, M.panel(thin, "us")) === null,
    `유니버스가 ${M.XALPHA.minPanel}종목 미만이면 표본을 만들지 않는다(얇은 순위는 정보가 아니다)`,
    "얇은 유니버스에서도 랭크를 만든다 — 몇 종목짜리 순위가 피처가 된다");
  const fat = mkUni(200);
  chk(M.feat("S0", fat, M.panel(fat, "us")) !== null, "충분한 유니버스에서는 정상 생성", "정상 유니버스에서도 생성 실패");
}

// ── ④ 패널과 피처가 ★같은 식★ 을 쓴다 ──────────────────────────────────────
//   두 벌로 두면 한쪽만 고치는 사고가 난다 — 이 저장소가 이미 여러 번 겪었다.
{
  const pb = grab("xalphaBuildPanel");
  chk(/xalphaRawAlphas\(sy, dailyCache\)/.test(pb) && /xalphaDecayAlphas\(sy, dailyCache\)/.test(pb),
    "패널이 피처와 같은 함수(xalphaRawAlphas·xalphaDecayAlphas)로 분포를 만든다",
    "패널이 알파를 따로 계산한다 — 분포와 값이 다른 식이면 순위가 무의미해진다");
}

// ── ⑤ decay_linear — 논문의 연산자 그대로 ──────────────────────────────────
{
  const dl = grab("xalphaDecayAlphas");
  chk(/const w = XA_DECAY_D - b;/.test(dl), `최근일수록 무거운 선형가중(${M.XA_DECAY_D},…,1)`,
    "감쇠가 선형가중이 아니다");
  chk(/if \(!a\) return null;/.test(dl),
    "한 시점이라도 못 만들면 평활도 만들지 않는다(빈칸을 0 으로 채우지 않는다)",
    "일부 시점이 비어도 평활을 만든다 — 없는 값이 0 으로 섞인다");
}

// ── ⑥ 유의성 검정은 ★일별 횡단면★ 으로 ─────────────────────────────────────
//   XALPHA 는 '같은 날 유니버스 안의 상대 순위' 가 신호다. 연속 슬라이스로 블록을 나누면
//   블록 간 분산이 모델이 아니라 ★시장 국면★ 을 재게 되어 유의성이 부풀거나 주저앉는다.
{
  chk(/dayBlocks: true/.test(src), "XALPHA 학습이 일별 블록으로 유의성을 잰다",
    "XALPHA 가 연속 슬라이스로 유의성을 잰다 — 횡단면 알파에 맞지 않는 검정이다");
  /* [V33.291] 인자에 mkeys 가 붙었다(시장 고정효과). 계약은 "keys 를 주면 그 키로 나눈다" 다. */
  chk(/function _icBlockStats\(pv, yv, K, keys/.test(src) && /Array\.isArray\(keys\)/.test(src),
    "_icBlockStats 가 keys 를 받으면 그 키로 블록을 나눈다(기본 동작은 그대로)",
    "_icBlockStats 에 키 블록 경로가 없다");
  // ★귀무에서 더 엄격한가★ — 느슨해지는 변경이면 게이트를 푸는 것과 같다.
  const R = 1200, DAYS = 20, PER = 97, TMIN = 2.5;
  let cS = 0, cD = 0;
  for (let r = 0; r < R; r++) {
    const pv = [], yv = [], keys = [];
    for (let d = 0; d < DAYS; d++) for (let s = 0; s < PER; s++) {
      pv.push(1 / (1 + Math.exp(-1.2 * randn())));   // 모델 출력
      yv.push(Math.random() < 0.5 ? 1 : 0);          // 결과 — ★완전 독립★
      keys.push(d);
    }
    if (Number(M.blk(pv, yv, 5).t) >= TMIN) cS++;
    if (Number(M.blk(pv, yv, 5, keys).t) >= TMIN) cD++;
  }
  const fpS = cS / R * 100, fpD = cD / R * 100;
  chk(fpD <= fpS + 0.5,
    `완전 독립 귀무에서 일별 블록이 더 엄격하다 — 오탐 ${fpD.toFixed(2)}% ≤ 연속 ${fpS.toFixed(2)}%`,
    `일별 블록이 오탐을 늘린다(${fpD.toFixed(2)}% > ${fpS.toFixed(2)}%) — 게이트를 푸는 변경이다`);
  chk(fpD <= 4, `일별 블록 오탐률 ${fpD.toFixed(2)}% (문턱 t≥${TMIN} 기준 4% 이내)`,
    `일별 블록 오탐률이 ${fpD.toFixed(2)}% 로 높다`);
}

// ── ⑦ 피처 의미가 바뀌었으면 featVer 가 올라가 있어야 한다 ──────────────────
{
  chk(M.XALPHA.featVer >= 2 && M.XALPHA.featNames.length === 25,
    `featVer ${M.XALPHA.featVer} · 피처 25개 — 옛 표본(원값 15개)과 섞이지 않는다`,
    `featVer ${M.XALPHA.featVer} 인데 피처가 ${M.XALPHA.featNames.length}개 — 의미가 다른 표본이 섞인다`);
}

// ── ⑧ 소급생성이 감쇠 창을 감당하는가 ─────────────────────────────────────
//   decay_linear 는 back=0..D-1 시점을 전부 계산한다. 소급생성 스냅샷의 봉 수가 모자라면
//   xalphaBuildFeat 이 null 을 돌려주고 ★그 표본이 조용히 사라진다★ (에러도 안 난다).
{
  const alt = (src.match(/const ALTBF = \{[^}]*\}/) || [""])[0];
  const minIdx = Number((alt.match(/minIdx:\s*(\d+)/) || [])[1]);
  const need = 24 + (M.XA_DECAY_D - 1);   // 스냅샷 봉수(minIdx+1) ≥ 25 + (D-1)
  chk(isFinite(minIdx) && minIdx >= need,
    `소급생성 최소 봉 인덱스 ${minIdx} ≥ 필요치 ${need} (감쇠 ${M.XA_DECAY_D}일을 감당한다)`,
    `ALTBF.minIdx ${minIdx} < ${need} — 감쇠 창을 못 채워 소급 표본이 조용히 사라진다`);
}

// ── ⑨ 소급생성이 ★반드시 전진하는가★ (V33.187) ───────────────────────────
//   실측 사고: 수동 스윕이 커서 669953 에서 10여 회차를 회차당 48초씩 태우고 +0/+0 만 찍다
//   60분 제한에 잘렸다. 원인은 두 겹이었다.
//     ① 배치 종목별 일봉 선로드(dailyAll)가 ★한 번도 읽히지 않는 채★ 수백 건의 getState 를
//        날려 준비 단계가 예산을 다 먹었다.
//     ② 마감시한을 날짜 루프 ★첫머리★ 에서 재서, 준비가 길면 한 날짜도 처리 못 하고 빠져나왔다.
//        lastId 가 안 오르니 다음 회차가 같은 날짜를 다시 집어 온다 — 무한 제자리.
//   지켜야 할 불변식: ★한 회차는 적어도 한 날짜를 끝낸다 = 커서는 반드시 전진한다.★
{
  const bf = grab("altSampleBackfill");
  // 주석은 걷어내고 본다 — 이 게이트가 지키려는 건 ★코드★ 다. 무엇을 왜 걷어냈는지 적은
  // 주석이 제 게이트를 걸어 넘어뜨리면, 다음 사람은 설명을 지우는 쪽으로 배운다(V33.182 재발).
  const bfCode = bf.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  chk(!/dailyAll/.test(bfCode),
    "소급생성에 읽히지 않는 일봉 선로드가 없다(회차당 수백 건의 조회를 태우던 자리)",
    "altSampleBackfill 에 dailyAll 선로드가 되살아났다 — 아무도 안 읽는데 예산만 먹는다");
  /* ══ [V33.403] ★계약을 "첫 break 가 마감시한이다" 가 아니라 뜻으로 적는다.★ ═══════════
     지켜야 할 것(V33.187): ★날짜 루프는 첫 순회에서 빠져나갈 수 없다★ — 그래야 lastId 가
     올라 커서가 전진하고 스윕이 끝난다. 종전 검사는 그것을 "루프 머리 80자 안의 break 에
     _dDone > 0 이 있다" 로 확인했는데, 그건 ★break 가 하나뿐일 때만★ 성립하는 대리 지표다.
     V33.403 이 예산 가드(_dProc >= _bDates)를 그 앞에 넣자 멀쩡한 코드가 실패로 읽혔다.
     → 루프 머리의 ★모든★ 이탈 조건을 뽑아, 초기값에서 ★전부 거짓★ 인지 실제로 계산한다.
       이쪽이 더 강하다 — 앞으로 어떤 가드가 추가돼도 같은 규칙으로 검사된다. */
  const loopAt = bfCode.indexOf("for (const dk of days)");
  const head = bfCode.slice(loopAt, loopAt + 360);
  const guards = [];
  {
    const re = /if \(([^)]*(?:\([^)]*\))?[^)]*)\)\s*break;/g;
    let mm;
    while ((mm = re.exec(head)) !== null) guards.push(mm[1].trim());
  }
  chk(guards.length > 0, "루프 머리의 이탈 조건 " + guards.length + "개를 뽑았다: " + guards.join(" | "),
    "이탈 조건을 못 찾는다 — 검사가 헛돈다");
  {
    // 초기값: 아직 아무 날짜도 안 했고(_dProc=_dDone=0), 마감시한은 ★이미 지났다★(최악의 경우)
    let firstExit = null;
    for (const g of guards) {
      let v = null;
      try {
        v = new Function("_dProc", "_dDone", "_bDates", "_dl", "Date",
          "return !!(" + g + ");")(0, 0, 6, 1, { now: function () { return 1e15; } });
      } catch (e) { v = "평가불가:" + e.message; }
      if (v === true) { firstExit = g; break; }
      if (typeof v !== "boolean") { firstExit = g + " (" + v + ")"; break; }
    }
    chk(firstExit === null,
      "초기값(_dProc=0·_dDone=0·마감 이미 지남)에서 ★어느 조건도 참이 아니다★ — 한 날짜는 반드시 끝낸다",
      "★루프가 첫 순회에서 빠져나갈 수 있다: " + firstExit + " — 커서가 안 올라 스윕이 제자리를 돈다★");
  }
  // 예산이 1 이어도 최소 한 날짜는 돈다(예산을 0 으로 못 만든다)
  chk(/Math\.max\(1, Math\.min\(60, _num\(cfg\.batchDates/.test(bfCode),
    "날짜 예산은 최소 1 로 바닥이 막혀 있다", "★예산이 0 이 될 수 있다 — 아무 날짜도 안 돈다★");
  chk(/const _lm = _num\(cfg\.loopMs, 0\);/.test(bf) && /_lm > 0 \? \(Date\.now\(\) \+ _lm\)/.test(bf),
    "예산을 날짜 루프 시작 시점부터 잰다(loopMs) — 준비 시간이 일할 시간을 잡아먹지 않는다",
    "loopMs 경로가 없다 — 절대 마감시각이면 준비 단계가 길 때 루프 몫이 0 이 된다");
  const rr = src.slice(src.indexOf('path === "/api/ai/resample-run"'));
  chk(/altSampleBackfill\(env\.DB, \{ batchDates: _bd, loopMs: \d+ \}\)/.test(rr.slice(0, 2000)),
    "수동 스윕 문이 loopMs 로 예산을 준다",
    "resample-run 이 아직 절대 마감시각(deadlineMs)으로 예산을 준다");
  // 스윕을 모는 쪽에도 정지 감지가 있어야 한다 — 진행 없는 반복은 시간만 태운다.
  const wf = readFileSync(new URL("../.github/workflows/resample-run.yml", import.meta.url), "utf8");
  chk(/STALL=\$\(\(STALL\+1\)\)/.test(wf) && /STALL.*-ge 5/.test(wf),
    "스윕 워크플로가 커서 정지를 5회차에 감지해 멈춘다",
    "스윕 워크플로에 커서 정지 가드가 없다 — 제자리 반복이 제한시간까지 간다");
}

// ── [V33.213] 소급생성 봉 인덱스 — ★미래 봉이 절대 섞이면 안 된다★ ────────────
/*  이 저장소의 무결성 규칙은 명시돼 있다: "봉 인덱스는 항상 '내림'으로 잡는다.
    하루라도 미래 봉이 섞이면 학습이 오염되고 그건 백테스트 사기가 된다."
    그런데 종전 구현(ceil(캘린더일 × 252/365))은 ceil 을 근거로 안전하다고 적어 두고도
    짧은 구간에서 되돌림이 모자랐다 — 비율이 1 보다 작다는 사실을 ceil 이 못 덮는다.
    백필은 FLOW·XALPHA 표본의 사실상 전부(각 3만여 건)라, 여기서 새면 두 모델의
    측정 엣지가 통째로 부푼다. 그래서 계약을 재현으로 확인한다. */
{
  const _D = 86400000;
  const _wd = (a, b) => {
    let n = 0; const A = new Date(a), B = new Date(b);
    A.setUTCHours(0, 0, 0, 0); B.setUTCHours(0, 0, 0, 0);
    for (let t = A.getTime() + _D; t <= B.getTime(); t += _D) { const d = new Date(t).getUTCDay(); if (d !== 0 && d !== 6) n++; }
    return n;
  };
  const _L = 2000;
  let _leak = 0, _mism = 0, _worst = null;
  for (let base = 0; base < 7; base++) {
    const now = Date.UTC(2026, 7, 17 + base);
    for (let cal = 0; cal <= 1460; cal++) {
      const ts = now - cal * _D;
      const back = _L - 1 - M.barIdx(_L, ts, now);
      const w = _wd(ts, now);
      if (back !== w) _mism++;
      // 실제 거래일 = 평일 − 공휴일(미국 연 10일 가정). 그보다 적게 되돌리면 미래 봉이 섞인다.
      const tds = Math.max(0, Math.round(w - (cal / 365.25) * 10));
      if (back < tds) { _leak++; if (!_worst) _worst = `캘린더 ${cal}일: 되돌림 ${back} < 거래일 ${tds}`; }
    }
  }
  chk(_mism === 0, "소급 봉 인덱스가 실제 평일 수와 정확히 일치한다(주말 구조 반영)",
      `소급 봉 인덱스가 평일 수와 어긋난다 ${_mism}건 — 비율 근사가 남아 있다`);
  chk(_leak === 0, "소급 봉 인덱스: 룩어헤드 0 / 10,227 조합 — 미래 봉이 섞이지 않는다",
      `소급 봉 인덱스가 되돌림 부족(룩어헤드)을 낸다 ${_leak}건 — ${_worst}`);
  chk(M.barIdx(_L, Date.UTC(2027, 0, 1), Date.UTC(2026, 0, 1)) === _L - 1 && M.barIdx(_L, 0, 0) === _L - 1,
      "소급 봉 인덱스 경계(동일·미래 시각)가 마지막 봉으로 안전 처리된다",
      "소급 봉 인덱스가 경계에서 배열 범위를 벗어난다");
}

// ── [V33.217] 봉 날짜가 있으면 ★추정하지 않는다★ ─────────────────────────
/*  daily: 캐시가 days(에폭 이후 일수)를 싣기 시작했다. 그러면 소급생성은 표본 시각의
    날짜보다 크지 않은 마지막 봉을 이분탐색으로 ★정확히★ 찾을 수 있다 —
    공휴일·휴장·상장 공백을 실제 데이터가 답하므로 근사가 필요 없다.
    폴백(평일 세기)은 남겨 두되, days 가 있을 때 그 폴백으로 떨어지면 안 된다. */
{
  const _D2 = 86400000;
  // 실제에 가까운 달력: 평일에서 공휴일을 빼고 1,000봉을 만든다.
  const _hol = new Set();
  { let sd = 7; const rr = () => { sd = (sd * 1103515245 + 12345) >>> 0; return sd / 4294967296; };
    for (let y = 2022; y <= 2026; y++) for (let k = 0; k < 10; k++) {
      _hol.add(Math.floor(Date.UTC(y, Math.floor(rr() * 12), 1 + Math.floor(rr() * 28)) / _D2)); } }
  const _days = []; let _t = Date.UTC(2022, 0, 3);
  while (_days.length < 1000) {
    const dn = Math.floor(_t / _D2), w = new Date(_t).getUTCDay();
    if (w !== 0 && w !== 6 && !_hol.has(dn)) _days.push(dn);
    _t += _D2;
  }
  const _len = _days.length, _now = _days[_len - 1] * _D2;
  const _truth = (ts) => { const tg = Math.floor(ts / _D2); let a = -1; for (let i = 0; i < _len; i++) if (_days[i] <= tg) a = i; return a; };
  let _bad = 0, _lead = 0, _fbOff = 0;
  for (let b = 0; b < 900; b++) {
    const ts = _now - b * _D2;
    const got = M.barIdx(_len, ts, _now, _days), want = _truth(ts);
    if (got !== want) _bad++;
    if (got > want) _lead++;
    _fbOff += Math.abs(M.barIdx(_len, ts, _now, null) - want);
  }
  chk(_bad === 0, "봉 날짜가 있으면 소급 인덱스가 ★정확히★ 맞는다(공휴일 포함 900개 시점, 오차 0)",
      `봉 날짜가 있는데도 인덱스가 어긋난다 ${_bad}건 — 근사로 떨어지고 있다`);
  chk(_lead === 0, "봉 날짜 경로에서도 미래 봉을 고르지 않는다",
      `봉 날짜 경로가 미래 봉을 고른다 ${_lead}건 — 룩어헤드`);
  // 폴백이 실제로 더 나쁜지 확인 — 아니면 이 기능이 값을 못 만든다는 뜻이다.
  chk(_fbOff / 900 > 1, `폴백(평일 세기)은 평균 ${(_fbOff / 900).toFixed(2)}봉 어긋난다 — 날짜를 저장할 이유`,
      "폴백과 정확 경로의 차이가 없다 — 재현이 이 기능의 근거를 증명하지 못한다");
  chk(M.barIdx(_len, (_days[0] - 5) * _D2, _now, _days) === -1,
      "첫 봉보다 앞선 표본은 만들지 않는다(-1)",
      "첫 봉보다 앞선 표본에 유효 인덱스를 준다 — 없는 과거를 지어낸다");
}

// [V33.217] 캐시를 쓰는 곳이 셋이면 셋 다 days 를 실어야 한다.
//   한 곳이라도 빠지면 좋은 캐시를 날짜 없는 캐시로 덮어써 스키마가 되돌아간다.
{
  const w = [...src.matchAll(/setState\(DB, "daily:" \+ symbol/g)].length;
  const withDays = [...src.matchAll(/days: (?:data|fb\.data)\.days/g)].length;
  chk(w >= 3 && withDays >= 3,
      `daily 캐시 기록 ${w}곳이 전부 days 를 싣는다`,
      `daily 캐시 기록 ${w}곳 중 days 를 싣는 곳이 ${withDays}곳뿐 — 빠진 경로가 스키마를 되돌린다`);
  const fresh = [...src.matchAll(/_dailyCacheOk\(cach/g)].length;
  chk(fresh >= 2, "신선도 판정이 전부 같은 함수(_dailyCacheOk)를 쓴다 — 한 경로만 옛 스키마로 남지 않는다",
      "신선도 판정이 경로마다 다르다 — days 없는 캐시가 어떤 경로에서는 영원히 신선하다");
}

console.log(fails ? "\nXALPHA 계약 위반 " + fails + "건 — 배포 차단" : "\n  ok   XALPHA 계약 통과");
process.exit(fails ? 1 : 0);
