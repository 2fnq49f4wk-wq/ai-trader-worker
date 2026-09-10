/* [V33.334] 학습표본 제자리 이관 — ★표본을 죽이지 않고 판을 올렸는가★
 *
 *   사용자 지시: "피처 통합하는데 이거 학습표본 안 죽게 기존에 있는 데이터로 dma 스토캐스틱
 *   전부 계산해서 학습표본에 넣은 다음에 학습시켜 모델들 안죽게 잘처리해봐".
 *
 *   종전 방식은 featVer 를 올리고 옛 표본을 버린 뒤 딥이력에서 다시 수확하는 것이었다.
 *   되긴 하지만 ★며칠 동안 위원 전원이 굶는다★ — 표본이 0 에서 다시 자라기 때문이다.
 *   그래서 지우지 않고 옮긴다. 이 검사가 무는 것은 그 이관의 세 가지 성질이다:
 *     ① 앞칸이 한 칸도 밀리지 않는다 (밀리면 51만 표본의 뜻이 통째로 어긋난다 — 복구 불가)
 *     ② 이력이 없으면 지어내지 않고 dsKnown=0 으로 "모른다"고 적는다
 *     ③ ★이관이 끝나기 전엔 구판 정리가 멈춘다★ — 안 그러면 이관 대상이 먼저 지워진다
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.error("  FAIL " + m); };
const code = S.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
const names = M.LUXML.featNames, D = names.length, SN = M.DS_FEATS.length;

// ── ① ★봉을 내용으로 찾는가★ — ts 로 찾으면 엉뚱한 봉을 붙인다 ──────────
{
  /* 수확 표본의 ts 는 실제 날짜가 아니다(소스: "봉 시점 근사, 일봉 1개=1일").
     주말·휴장을 안 세므로 100봉 전 표본의 ts 는 실제보다 몇 주 앞선다.
     그래서 저장된 벡터의 dayPct·ret5·ret20 로 봉을 특정한다 — 셋 다 종가만으로
     정해지고 클램프도 없어 이력에서 그대로 재현된다. */
  const closes = [];
  for (let i = 0; i < 400; i++) closes.push(100 + i * 0.31 + Math.sin(i / 7) * 3.1);
  const map = M._dsAnchorIndex(closes);
  const at = 250, L = at + 1, price = closes[at];
  const key = M._dsAnchorKey((price / closes[at - 1] - 1) * 100,
                             (price / closes[L - 6] - 1) * 100,
                             (price / closes[L - 21] - 1) * 100);
  if (map.get(key) === at) ok(`저장된 dayPct·ret5·ret20 만으로 ${at}번째 봉을 정확히 특정한다`);
  else bad(`내용으로 봉을 못 찾는다: ${map.get(key)} (기대 ${at})`);
  if (map.get(M._dsAnchorKey(9.9, 9.9, 9.9)) === undefined)
    ok("이력에 없는 조합은 찾지 못한다고 답한다 — 아무 봉이나 갖다 쓰지 않는다");
  else bad("없는 조합에도 봉을 갖다 쓴다");
  // 같은 세 값이 두 봉에서 나오면 애매하다 — 쓰지 않아야 한다
  const flat = new Array(200).fill(100);
  const fm = M._dsAnchorIndex(flat);
  const dup = fm.get(M._dsAnchorKey(0, 0, 0));
  if (dup === -1) ok("세 값이 같은 봉이 둘 이상이면 -1(애매) — 실측값이라고 붙이지 않는다");
  else bad(`중복 앵커를 그대로 쓴다: ${dup}`);
  if (map.size > 300) ok(`이력 400봉에서 앵커 ${map.size}개가 만들어진다(대부분의 봉이 특정된다)`);
  else bad(`앵커가 ${map.size}개뿐이다 — 대부분의 표본을 못 찾는다`);

  const highs = closes.map((c) => c * 1.01), lows = closes.map((c) => c * 0.99);
  const v = M._dsFeats(closes.slice(0, at + 1), highs.slice(0, at + 1), lows.slice(0, at + 1));
  if (v.dsKnown === 1 && Math.abs(v.dispMaPct) < 50 && v.stochSlowK >= 0 && v.stochSlowK <= 100)
    ok(`이력이 있으면 실측값을 낸다(가격-DMA ${v.dispMaPct.toFixed(2)}% · %K ${v.stochSlowK.toFixed(0)} · dsKnown 1)`);
  else bad("실측값 계산이 틀렸다: " + JSON.stringify(v));
  const short = M._dsFeats(closes.slice(0, 30), null, null);
  if (short.dsKnown === 0 && short.stochSlowK === 50 && short.dispMaPct === 0)
    ok("이력이 모자라면 중립 + dsKnown=0 — 지어내지 않고 '모른다'고 적는다");
  else bad("짧은 이력에서 값을 지어낸다: " + JSON.stringify(short));
  /* ★고가·저가가 없으면 getStochSlow 는 조용히 종가근사로 떨어진다.★ 그 값은 진짜
     스토캐스틱과 분포가 달라, 섞으면 같은 칸에 다른 지표 둘을 밀어 넣는 셈이 된다. */
  const noHL = M._dsFeats(closes.slice(0, at + 1), null, null);
  if (noHL.dsKnown === 0)
    ok("고가·저가가 없으면 실측이라고 하지 않는다 — 종가근사가 진짜 값으로 섞이지 않는다");
  else bad("★고가·저가 없이 계산한 종가근사를 실측(dsKnown=1)이라고 붙인다★");
  const misHL = M._dsFeats(closes.slice(0, at + 1), highs.slice(0, at), lows.slice(0, at + 1));
  if (misHL.dsKnown === 0) ok("고가·저가 길이가 어긋나도 실측이라고 하지 않는다");
  else bad("정렬이 어긋난 고가·저가로 계산하고 실측이라 붙인다");
  if (/_IX_MAX/.test(S) && /_ixOrder\.shift\(\)/.test(S))
    ok("이관의 종목 캐시에 상한이 있다 — 딥이력을 종목마다 들고 있으면 아이솔레이트 메모리를 넘긴다");
  else bad("종목 캐시가 무한히 자란다 — 한 호출에서 수십 MB 가 된다");

  /* ★Displaced MA 인가★ — V33.334 는 '이동평균 차이'였다. 사용자가 말한 것은 이쪽이다. */
  const dm = M.getDisplacedMA(closes, M.DS_PARAMS.maPeriod, M.DS_PARAMS.maShift);
  const n = closes.length, p = M.DS_PARAMS.maPeriod, sh = M.DS_PARAMS.maShift;
  let sum = 0; for (let i = n - 1 - sh - p + 1; i <= n - 1 - sh; i++) sum += closes[i];
  if (dm && Math.abs(dm.ma - sum / p) < 1e-9)
    ok(`DMA 선이 ${sh}봉 전 MA(${p}) 와 정확히 같다 — 이동평균을 앞으로 민 선이다`);
  else bad("DMA 가 Displaced MA 가 아니다");
  const mutated = closes.slice(); mutated[n - 1] = 99999;
  if (M.getDisplacedMA(mutated, p, sh).ma === dm.ma)
    ok("마지막 봉을 바꿔도 선 값이 안 변한다 — 미래·현재 종가를 선에 쓰지 않는다(누출 없음)");
  else bad("★DMA 선이 현재 봉을 쓴다 — 밀어놓은 선의 정의가 아니다★");
}

// ── ② ★앞칸이 밀리지 않는가★ — 밀리면 복구 불가능한 사고다 ─────────────
{
  const oldVec = Array.from({ length: D - SN }, (_, j) => j * 0.5 - 3);
  const vals = { dispMaPct: 1.5, dispMaSlope: -0.4, stochSlowK: 72.5, stochSlowD: 68.1, dsKnown: 1 };
  const nx = M._featBackfillX(oldVec, Date.parse("2026-05-05T00:00:00Z"), vals);
  if (nx && nx.length === D && oldVec.every((v, j) => nx[j] === v))
    ok(`옛 ${D - SN}칸이 한 칸도 안 밀리고 ${D}칸이 된다`);
  else bad("★앞칸이 밀렸다 — 기존 표본 전체의 뜻이 어긋난다★");
  const tailOk = M.DS_FEATS.every((n, i) => nx[D - SN + i] === vals[n]);
  if (tailOk) ok("새 5칸이 featNames 꼬리 순서 그대로 실린다");
  else bad("새 값이 이름 순서와 어긋나게 실린다");
  const neu = M._featBackfillX(oldVec, Date.parse("2026-05-05T00:00:00Z"), null);
  if (neu && neu[names.indexOf("dsKnown")] === 0 && neu[names.indexOf("stochSlowK")] === 50)
    ok("값을 못 구하면 중립으로 폭만 맞추고 dsKnown=0 을 남긴다");
  else bad("중립 채움이 잘못됐다");
}

// ── ③ ★이관이 끝나기 전엔 구판을 지우지 않는가★ ────────────────────────
{
  if (/const _migPend = await mlFeatMigPending\(DB\);/.test(code) &&
      /if \(_migPend\) \{[\s\S]{0,400}\} else \{[\s\S]{0,600}DELETE FROM ml_samples WHERE id IN/.test(code))
    ok("ml_samples 구판 정리가 이관 완료 여부를 ★먼저 물어본다★");
  else bad("★구판 정리가 이관을 모른 채 돈다 — 이관 대상이 먼저 지워진다★");
  if (/if \(!_migPend\) try \{\n\s*const _altPrune = \[/.test(code))
    ok("ml_samples_st 등 나머지 표 정리도 같은 조건에 걸린다");
  else bad("alt 표 정리가 이관과 무관하게 돈다 — 단타 표본이 먼저 지워진다");
  // 모르면 지우지 않는다 — 상태를 못 읽을 때의 기본값
  /* ★이관 중에는 학습도 미뤄야 한다.★ 반쪽 표본으로 배우면 정확도가 낮게 나오고
     신뢰게이트가 모델을 강등시킨다 — 데이터는 멀쩡한데 위원이 내려앉는 사고다. */
  /* ★보류는 '조용한 return' 이면 안 된다.★ 야간 파이프라인의 _stg 는 함수가 무엇을 돌려주든
     "오늘 완료" 도장을 찍는다 — 그러면 그날은 다시 학습하지 않아, featVer 를 올린 날
     위원장(MIND)·L1 이 하루 종일 판 불일치로 남고 위원회가 규칙엔진 비상운용으로 떨어진다.
     실제로 그렇게 났다(2026-09-10 10:35 화면: 위원 좌석 2/10). 재시도 신호여야 한다. */
  if (/return "\u27F3 \[ML\] 표본 이관 중/.test(S))
    ok("이관 중 학습 보류가 ★재시도 신호(⟳)★ 다 — 완료 도장이 아니라 '아직'이라고 말한다");
  else bad("★보류가 조용한 return 이다 — _stg 가 오늘 완료로 도장을 찍어 그날 내내 재학습이 없다★");
  /* ★문장이 아니라 동작으로 못박는다.★ 처음엔 소스에 표식 문자열이 있는지만 봤는데,
     분기를 if(false) 로 죽여도 문자열은 그대로 남아 검사가 통과했다 — 헛도는 검사였다.
     그래서 _stg 를 꺼내 실제로 돌린다: ⟳ 를 돌려준 단계는 '오늘 완료' 도장이 찍히면 안 된다. */
  {
    // ★상수 선언까지 포함해 잘라야 한다★ — 처음엔 함수만 떼어 내 _STG_RETRY_MS 가 없었고,
    //   _stg 자신의 catch 가 그 ReferenceError 를 삼켜 "재시도가 안 된다"로 보였다.
    const a = S.indexOf("            const _STG_RETRY_MS =");
    const b = S.indexOf("\n            // (1) 반사실 후보 라벨링", a);
    const store = {};
    const env = { DB: { prepare: () => ({ bind: () => ({ run: async () => ({}), first: async () => null, all: async () => ({ results: [] }) }) }) } };
    const ctx = vm.createContext({
      env, Date, Math, JSON, String,
      _aiDay: "2026-09-10", _STG_COST_MIN_MS: 1e9, _stgCost: { ms: {}, ts: 0 },
      _num: (v, d) => { const x = Number(v); return Number.isFinite(x) ? x : d; },
      getState: async (_db, k) => (store[k] === undefined ? null : store[k]),
      setState: async (_db, k, v) => { store[k] = v; },
      log: async () => {}
    });
    vm.runInContext(S.slice(a, b) + "\n globalThis.stg = _stg;", ctx);
    let ran = 0;
    await ctx.stg("t1", async () => { ran++; return "⟳ [ML] 아직"; });
    const markWait = store["ai_stage:t1"];
    if (typeof markWait === "string" && markWait.indexOf("2026-09-10|wait|") === 0)
      ok("⟳ 를 돌려준 단계는 완료 도장 대신 '아직' 표식이 찍힌다");
    else bad(`★'아직'인데 완료 도장이 찍혔다(${markWait}) — 그날 내내 재학습이 없다★`);
    await ctx.stg("t1", async () => { ran++; return "⟳ [ML] 아직"; });
    if (ran === 1) ok("바로 다음 실행은 건너뛴다 — 매 분 무거운 학습 질의를 반복하지 않는다");
    else bad("재시도 간격이 없다 — 매 분 학습 질의가 반복된다");
    store["ai_stage:t1"] = "2026-09-10|wait|" + (Date.now() - 20 * 60000);
    await ctx.stg("t1", async () => { ran++; return "[ML] 학습 완료"; });
    if (ran === 2 && store["ai_stage:t1"] === "2026-09-10")
      ok("표식이 만료되면 같은 날 안에 다시 돌고, 성공하면 그때 완료 도장이 찍힌다");
    else bad(`재시도/완료 전이가 깨졌다(ran ${ran} · mark ${store["ai_stage:t1"]})`);
    await ctx.stg("t1", async () => { ran++; return "다시"; });
    if (ran === 2) ok("완료된 단계는 그날 다시 돌지 않는다 — 종전 동작 그대로다");
    else bad("완료 도장이 무시된다 — 같은 학습이 하루에 여러 번 돈다");
  }
  const waits = (S.match(/return "\\u27F3 " \+ "\[/g) || []).length;
  if (waits >= 8) ok(`표본 부족으로 물러나는 학습 단계 ${waits}곳이 재시도 신호를 쓴다(MIND·L1·BRAIN·GBDT·DNN·MEMO·BANDIT·SCAN 등)`);
  else bad(`재시도 신호를 쓰는 단계가 ${waits}곳뿐이다 — 나머지는 그날 내내 멈춘다`);
  if (/id < \? ORDER BY id DESC/.test(S))
    ok("이관이 ★최신 행부터★ 돈다 — 학습창(최근 trainWindow)이 먼저 새 판이 되어 위원들이 빨리 돌아온다");
  else bad("★이관이 오래된 행부터 돈다 — 학습에 쓰는 최근 구간이 가장 늦게 준비된다★");
  const src = S.slice(S.indexOf("async function mlFeatMigPending(DB)"), S.indexOf("async function mlMarketHarvestNightly"));
  if (/catch \(e\) \{ return true; \}/.test(src) && /if \(!st\) return true;/.test(src))
    ok("상태를 못 읽거나 아직 시작 전이면 '이관 중'으로 본다 — 모르면 지우지 않는다");
  else bad("상태를 모를 때 지우는 쪽으로 기운다");
}

// ── ④ 이관을 ★실제로 돌려★ 표본이 살아남는지 본다 ──────────────────────
{
  const day0 = Math.floor(Date.parse("2025-01-02T00:00:00Z") / 86400000);
  const closes = [], highs = [], lows = [], days = [];
  for (let i = 0; i < 300; i++) {
    const c = 100 + i * 0.3 + Math.sin(i / 6) * 2;
    closes.push(c); highs.push(c * 1.01); lows.push(c * 0.99); days.push(day0 + i);
  }
  const daily = { closes, highs, lows, days, ts: Date.now() };
  /* ★표본 벡터의 앵커 세 칸을 실제 이력값으로 채운다.★ 아무 값이나 넣으면 이관이
     전부 '못 찾음(중립)' 으로 떨어져, "실측값을 되계산한다"는 이 검사의 핵심이
     아무것도 시험하지 않게 된다 — 통과해도 의미가 없는 검사가 된다. */
  const iDay = names.indexOf("dayPct"), iR5 = names.indexOf("ret5"), iR20 = names.indexOf("ret20");
  const rows = [];
  for (let i = 0; i < 40; i++) {
    const at = 120 + i, L = at + 1, px = closes[at];
    const x = Array.from({ length: D - SN }, (_, j) => (j + i) % 7);
    x[iDay] = (px / closes[at - 1] - 1) * 100;
    x[iR5] = (px / closes[L - 6] - 1) * 100;
    x[iR20] = (px / closes[L - 21] - 1) * 100;
    rows.push({ id: i + 1, ts: (day0 + at) * 86400000, symbol: "AAA", strategy: "hv",
      feat: JSON.stringify(x), featver: M.LUXML.featVer - 1 });
  }
  /* ★라이브 표본★ — ret5·ret20 을 그 순간 호가로 계산해 어떤 봉과도 안 맞는다(앵커 불일치).
     대신 ts 가 진짜 날짜다. 날짜 경로가 없으면 이 표본들이 전부 dsKnown=0 이 되는데,
     하필 학습가중이 가장 높은(liveSrcWeight 1.5) 표본들이다. */
  for (let i = 0; i < 10; i++) {
    const at = 200 + i;
    const x = Array.from({ length: D - SN }, (_, j) => (j * 3 + i) % 11 + 0.137);   // 앵커와 안 맞는 값
    rows.push({ id: 200 + i, ts: (day0 + at) * 86400000, symbol: "AAA", strategy: "trend",
      feat: JSON.stringify(x), featver: M.LUXML.featVer - 1 });
  }
  // 이력이 없는 종목 — 버리지 않고 중립으로 살아남아야 한다
  for (let i = 0; i < 10; i++) {
    rows.push({ id: 100 + i, ts: (day0 + 150) * 86400000, symbol: "NOHIST", strategy: "hv",
      feat: JSON.stringify(Array.from({ length: D - SN }, () => 1)), featver: M.LUXML.featVer - 1 });
  }
  // ★일봉 캐시를 실제로 심어 둔다★ — 안 심으면 전부 '이력 없음'으로 떨어져,
  //   "실측값을 되계산한다"는 이 검사의 핵심이 아무것도 시험하지 않게 된다.
  /* 딥이력(hist:)을 먼저 본다 — 수확 표본이 거기서 나왔기 때문이다.
     이 stub 에도 그대로 심어 둔다(R2 미바인딩이면 histGet 이 D1 의 hist: 로 떨어진다). */
  const state = { "hist:AAA": JSON.stringify(daily), "daily:AAA": JSON.stringify(daily) };
  const DB = {
    prepare(sql) {
      const q = { sql, args: [] };
      q.bind = (...a) => { q.args = a; return q; };
      q.first = async () => {
        if (/FROM state WHERE k = \?/.test(sql)) { const v = state[q.args[0]]; return v ? { v } : null; }
        return null;
      };
      q.all = async () => {
        if (/SELECT id, ts, symbol, strategy, feat FROM (ml_samples|ml_samples_st) WHERE featver <> \? AND id < \? ORDER BY id DESC/.test(sql)) {
          const tb = /ml_samples_st/.test(sql) ? "st" : "main";
          if (tb === "st") return { results: [] };
          const [fv, cursor, lim] = q.args;
          return { results: rows.filter((r) => r.featver !== fv && r.id < cursor)
            .sort((a, b) => b.id - a.id).slice(0, lim) };
        }
        return { results: [] };
      };
      q.run = async () => {
        if (/INSERT INTO state/.test(sql)) { state[q.args[0]] = q.args[1]; return { meta: {} }; }
        return { meta: {} };
      };
      return q;
    },
    async batch(stmts) {
      for (const st of stmts) {
        if (/UPDATE ml_samples SET feat = \?, featver = \? WHERE id = \?/.test(st.sql)) {
          const [feat, fv, id] = st.args;
          const r = rows.find((x) => x.id === id);
          if (r) { r.feat = feat; r.featver = fv; }
        }
      }
      return [];
    }
  };
  DB.prepare = DB.prepare.bind(DB);
  // getState 는 state 테이블을 읽으므로 위 stub 으로 동작한다.
  const before = rows.length;
  let guard = 0, res = null;
  while (guard++ < 20) {
    res = await M.mlFeatMigrate(DB, { runMs: 400 });
    if (res && res.done) break;
  }
  const after = rows.length;
  const migrated = rows.filter((r) => r.featver === M.LUXML.featVer).length;
  const widths = new Set(rows.map((r) => { try { return JSON.parse(r.feat).length; } catch (e) { return -1; } }));

  if (after === before) ok(`이관 전후 표본 수가 같다(${before}건) — ★한 건도 버리지 않았다★`);
  else bad(`표본이 ${before} → ${after} 로 줄었다 — 이관이 표본을 잃는다`);
  if (migrated === before) ok(`전부 새 판(featVer ${M.LUXML.featVer})으로 옮겨졌다`);
  else bad(`${migrated}/${before} 만 옮겨졌다`);
  if (widths.size === 1 && widths.has(D)) ok(`모든 표본이 ${D}칸이 됐다(폭이 섞이지 않는다)`);
  else bad(`폭이 섞였다: ${[...widths].join(",")}`);
  const kOf = (pred) => rows.filter(pred).filter((r) => { try { return JSON.parse(r.feat)[names.indexOf("dsKnown")] === 1; } catch (e) { return false; } }).length;
  const hvK = kOf((r) => r.strategy === "hv" && r.symbol === "AAA");
  const liveK = kOf((r) => r.strategy === "trend");
  const noHistK = kOf((r) => r.symbol === "NOHIST");
  if (hvK === 40) ok("수확 표본 40건이 내용 앵커로 실측 복구된다(dsKnown=1)");
  else bad(`수확 표본 복구가 틀렸다: ${hvK}/40`);
  if (liveK === 10) ok("★라이브 표본 10건도 진짜 ts 로 실측 복구된다★ — 앵커가 안 맞는다고 버리지 않는다");
  else bad(`라이브 표본이 복구되지 않는다: ${liveK}/10 — 가중이 가장 높은 표본이 통째로 '모름'이 된다`);
  if (noHistK === 0) ok("이력이 없는 10건은 중립(dsKnown=0) — 없는 값을 지어내지 않는다");
  else bad(`이력이 없는데 실측이라고 붙였다: ${noHistK}건`);
  if (res && res.done) ok("이관이 완료 상태로 마감된다 — 그때부터 구판 정리가 재개된다");
  else bad("이관이 끝나지 않는다 — 구판 정리가 영영 멈춘다");
  // getState 로 daily 를 읽는 경로가 stub 에 없어 NOHIST 와 AAA 모두 중립이 될 수 있다 —
  // 그 경우 위 known 검사가 먼저 실패하므로 여기서 별도 처리는 하지 않는다.
}

if (fails) { console.error(`\n✗ 표본 이관 계약 ${fails}건 실패`); process.exit(1); }
console.log("\n✓ 표본 이관 계약 통과 — 판을 올리면서 표본을 한 건도 버리지 않는다");
