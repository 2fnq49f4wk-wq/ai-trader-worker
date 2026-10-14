/* [V33.578] ★OMNI-Q 상위권 진입 경로 계약★ — 사용자(10/12): "ai 가 포지션을 아무것도 안 들고 있다 · omni 가 아직 섀도우 — 벗어나게".
 *   ① 진입 판정(omniqRoutePick): 그 머리 점수 ≥ 0.90 · 발언/잠정 · 신선 · 켜진 머리가 하위 절반이면 쉰다 · 잠정 ×0.5 / 정식 ×1
 *   ② 보유 판정(omniqHoldOf): 최소 보유(5일 머리 7일 · 20일 머리 28일) 뒤 < 0.75 면 drop · 낡음/회수/누락이면 release · 아니면 hold
 *   ③ 배선: 주입(맨 앞 · 체결 기준 상한 · 하루 몫은 원장) · 꼬리표 AI-Q(원장 사유 = 실적 관문 = _entryTag) · 위원회는 막지도 키우지도 않음 ·
 *           잠정 크기는 상한·예산 뒤 · OMNIQ-DROP · 위원회 청산/시간손절 제외 · 해제 시 meta.omq 삭제 · WEAK_RS·NEGEXP_MS 만 예외
 *   ④ NEGEXP_SIG 교착: AI 진입은 실적 관문이 그 키를 판정 중이면 실적 관문에 맡긴다(규칙 신호·기록 없는 키는 종전대로)
 *   ⑤ AI_PRIMARY 원장 사유에 detail 이 있다("AI_PRIMARY undefined" 재발 방지) */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const H = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };

const now = Date.UTC(2026, 9, 12, 2);
const D = 86400000;
const gProv = { g1: { ok: true, t: 17.6 }, g2: { ok: true, folds: [0.004, 0.006, 0.003, 0.005] }, g3: { days: 0, ok: false } };
const gSpeak = { g1: { ok: true, t: 7 }, g2: { ok: true, folds: [0.01, 0.01, 0.01] }, g3: { days: 35, mu: 0.53, lb: 0.51, ok: true } };
const gWeak = { g1: { ok: true, t: 3.2 }, g2: { ok: true, folds: [0.01, -0.01, 0.02] }, g3: { days: 0, ok: false } };
const st = (o) => Object.assign({ day: "2026-10-12", trainedAt: now - 3600000, speak: false, gate: gProv, speak20: false, gate20: gWeak,
  scores: { TOP: 0.95, EDGE: 0.90, MID: 0.80, LOW: 0.30 }, heads: { r20: { TOP: 0.7, EDGE: 0.6, MID: 0.95, LOW: 0.95 } } }, o || {});

// ① 진입 판정
const R = M.OMNIQ_ROUTE;
chk(R.entryPct === 0.9 && R.holdPct === 0.75 && R.maxPerCycle === 2 && R.maxPerDay === 3 && R.maxOpenProv === 6 && R.provMult === 0.5 &&
    R.minHoldCal[5] === 7 && R.minHoldCal[20] === 28, "미리 고정한 수치: 진입 0.90 · 띠 0.75 · 사이클 2 · 하루 3 · 잠정 동시 6 · ×0.5 · 최소 보유 7/28일");
let p = M.omniqRoutePick(st(), "TOP", now);
chk(p && p.h === 5 && p.mode === "prov" && p.mult === 0.5 && p.s === 0.95, "잠정 5일 머리 상위 10% → 반 크기로 고른다", JSON.stringify(p));
chk(M.omniqRoutePick(st(), "EDGE", now) && !M.omniqRoutePick(st(), "MID", now), "문턱 0.90 포함 · 0.80 은 고르지 않는다(20일 머리 섀도우)");
chk(!M.omniqRoutePick(st(), "LOW", now) && !M.omniqRoutePick(st(), "NONE", now), "하위·점수 없는 종목은 고르지 않는다");
chk(!M.omniqRoutePick(st({ trainedAt: now - 6 * D }), "TOP", now), "낡은 점수(5일+)로는 사지 않는다");
chk(!M.omniqRoutePick(st({ gate: gWeak }), "TOP", now) && !M.omniqRoutePick(null, "TOP", now), "섀도우(잠정 조건 미달)·상태 없음 → 사지 않는다");
p = M.omniqRoutePick(st({ speak: true, gate: gSpeak }), "TOP", now);
chk(p && p.mode === "speak" && p.mult === 1, "정식 발언이면 온전한 크기", JSON.stringify(p));
p = M.omniqRoutePick(st({ gate20: gProv }), "MID", now);
chk(p && p.h === 20 && p.s === 0.95, "20일 머리가 켜져 있으면 20일 상위 10% 도 고른다(5일은 띠 안)", JSON.stringify(p));
chk(!M.omniqRoutePick(st({ gate20: gProv }), "LOW", now), "켜진 머리 하나라도 하위 절반이면 쉰다(머리끼리 엇갈림 · OMNIQ_LOW 와 같은 판정)");
chk(!M.omniqBlocks(st(), "TOP", now) && M.omniqBlocks(st(), "LOW", now), "고른 종목은 하위 절반 차단(OMNIQ_LOW)에 걸리지 않는다");

// ② 보유 판정
const om5 = { h: 5, s: 0.95, mode: "prov" };
const H5 = (sc, heldDays, o) => M.omniqHoldOf(st(Object.assign({ scores: { X: sc } }, o || {})), "X", om5, now - heldDays * D, now);
chk(H5(0.6, 8).mode === "drop" && /상위 25% 밖/.test(H5(0.6, 8).why), "최소 보유 뒤 띠(0.75) 밖이면 판다", JSON.stringify(H5(0.6, 8)));
chk(H5(0.6, 6).mode === "hold" && H5(0.8, 30).mode === "hold" && H5(0.75, 9).mode === "hold", "최소 보유 전엔 안 판다 · 띠 안이면 계속 든다(0.75 포함)");
chk(H5(0.6, 8, { trainedAt: now - 6 * D }).mode === "release" && H5(0.6, 8, { gate: gWeak }).mode === "release", "점수 낡음 · 머리 회수 → 관리 해제(강제 매도 없음)");
chk(M.omniqHoldOf(st({ scores: {} }), "X", om5, now - 9 * D, now).mode === "release" && M.omniqHoldOf(st(), "X", null, now, now).mode === "none",
    "점수표에 없으면 해제 · OMNI-Q 보유가 아니면 무동작");
const om20 = { h: 20, s: 0.93, mode: "prov" };
chk(M.omniqHoldOf(st({ gate20: gProv, heads: { r20: { X: 0.6 } } }), "X", om20, now - 20 * D, now).mode === "hold" &&
    M.omniqHoldOf(st({ gate20: gProv, heads: { r20: { X: 0.6 } } }), "X", om20, now - 29 * D, now).mode === "drop", "20일 머리는 28일 최소 보유 · heads.r20 으로 판정");

// ③ 배선
const inj = S.slice(S.indexOf("/* [V33.578] ★OMNI-Q 상위권 진입★(OMNIQ_ROUTE 주석)"), S.indexOf("if (stratResults.length === 0) {\n            incNobuy(\"no_signal\");"));
chk(inj.length > 200 && /omniqRoutePick\(__omniq, symbol, Date\.now\(\)\)/.test(inj) && /stratResults\.unshift\(/.test(inj) && /isOmniQ: true/.test(inj) &&
    /__omqBought < OMNIQ_ROUTE\.maxPerCycle/.test(inj) && /__omqToday \+ __omqBought < OMNIQ_ROUTE\.maxPerDay/.test(inj) && /__omqOpen < OMNIQ_ROUTE\.maxOpenProv/.test(inj) &&
    /!heldSymbols\.has\(symbol\)/.test(inj) && /!crashGate\.blockNew/.test(inj) && /canTrade/.test(inj),
    "주입: 맨 앞 · 체결 기준 사이클/하루/잠정 동시 상한 · 보유·폭락게이트·장시간 확인");
chk(/if \(signal && signal\.isOmniQ\) \{ __omqBought\+\+; __omqOpen\+\+; \}/.test(S) && /omniqRouteToday\(DB, market, Date\.now\(\)\)/.test(S) &&
    /reason LIKE '\[AI-Q\]%'/.test(S), "상한은 실제 체결로만 센다 · 하루 몫은 원장([AI-Q] 매수)에서");
chk(M._entryTag({ isOmniQ: true, isAiPrimary: true }) === "AI-Q" && M._entryTag({ isAiPrimary: true }) === "AI" && M._entryTag({ isAiScalp: true }) === "AI-SCALP" && M._entryTag({}) === "RULE",
    "꼬리표: AI-Q · AI · AI-SCALP · RULE");
chk(/reason: "\[" \+ _entryTag\(signal\) \+ "\]\["/.test(S) && /const tag = _entryTag\(signal\) \+ ":"/.test(S) && M._pgTag("[AI-Q][TREND] OMNI_Q x") === "AI-Q:TREND",
    "원장 사유와 실적 관문이 같은 꼬리표 함수를 쓴다 · AI-Q:TREND 로 따로 센다");
const com = S.slice(S.indexOf("if (signal.isOmniQ || signal.isPair || _regimeScalp(signal)) {"), S.indexOf("} else if (_md && (_md.observe || _md.abstain)) {"));   // [V33.582] 패닉 단타와 같은 갈래
chk(com.length > 50 && !/continue/.test(com) && !/qty/.test(com) && /signal\.mlMindP = _md\.p/.test(com), "위원회: OMNI-Q 는 막지도(continue 없음) 키우지도(qty 없음) 않고 p 만 기록");
chk(/&& !signal\.isOmniQ( && !signal\.isPair)?( && !signal\.isPanicScalp| && !_regimeScalp\(signal\))?\s*\n\s*&& !__candSyms\.has\(symbol \+ ":pdist"\)/.test(S), "OMNI-Q 후보는 AI_PRIMARY 백분위 분포에 안 들어간다");
chk(/signal\.mlMindP === "number" && !signal\.isOmniQ( && !signal\.isPair)?\) \? signal\.mlMindP : null/.test(S), "켈리는 OMNI-Q 크기를 정하지 않는다");
const eb = S.slice(S.indexOf("async function executeBuy("), S.indexOf("// === [V8] 전략 룰 헬퍼 ==="));
const iPg = eb.indexOf("if (_pg.mult < 1)"), iOq = eb.indexOf("signal.isOmniQ && typeof signal.omqMult === \"number\"");
chk(iPg > 0 && iOq > iPg && /signal\.isAiPrimary \|\| signal\.isAiScalp \|\| signal\.isOmniQ/.test(eb) && /omq: \(signal && signal\.isOmniQ && signal\.omq\) \? signal\.omq : null/.test(eb),
    "executeBuy: 잠정 ×0.5 는 실적 관문·상한 뒤 · 레버리지/인버스 ETF 제외 · meta.omq 기록");
const ex = S.slice(S.indexOf("/* [V33.578] ★OMNI-Q 가 관리하는 보유★(OMNIQ_ROUTE)"), S.indexOf("// [V22] 모델기반 청산(Learned Exit)"));
chk(/omniqHoldOf\(__omniq, symbol, held\.meta\.omq, held\.opened_ts, Date\.now\(\)\)/.test(ex) && /"OMNIQ-DROP " \+ _hv\.why/.test(ex) &&
    /delete held\.meta\.omq/.test(ex) && /savePosition\(DB, market, symbol, stratName, held\)/.test(ex) && /_omqHeld = true/.test(ex),
    "청산: OMNIQ-DROP · 해제 시 meta.omq 삭제·저장 · 띠 안이면 관리 중 표시");
chk(/_xc\.committeeExit && __aiReady && !_omqHeld/.test(S) && /if \(heldDays >= timeStopD && !meta\.omq\)/.test(S), "관리 중 보유엔 위원회 청산(AI_EXIT/ROTATE)·시간손절이 안 걸린다");
// 실제 evaluateSell: meta.omq 면 시간손절 없음 · 없으면 시간손절 · 손절은 둘 다
{
  const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3));
  const daily = { closes, highs: closes.map((c) => c * 1.01), lows: closes.map((c) => c * 0.99), volumes: closes.map(() => 1e6) };
  const cfg = { trendRules: { timeStopDays: 5, stopLossPct: 5, atrStopMult: 2, trailAtrMult: 2.5 }, stopLoss: 5, maPeriod: 20, atrPeriod: 14 };
  const pos = (meta) => ({ symbol: "X", strategy: "trend", qty: 10, avg: 100, opened_ts: Date.now() - 9 * D, meta: Object.assign({ stopPrice: 95, peakPrice: 100.2 }, meta) });
  const a = M.evaluateSell(pos({}), 100.1, daily, 50, 100, 100, cfg, true, "us", null);
  const b = M.evaluateSell(pos({ omq: om5 }), 100.1, daily, 50, 100, 100, cfg, true, "us", null);
  const c = M.evaluateSell(pos({ omq: om5 }), 94, daily, 50, 100, 100, cfg, true, "us", null);
  chk(a.sell && /TIME-STOP/.test(a.reason) && !(b.sell && /TIME-STOP/.test(b.reason || "")) && c.sell && /^STOP/.test(c.reason),
      "evaluateSell: 일반 보유는 시간손절 · OMNI-Q 관리 보유는 시간손절 없음 · 손절은 그대로", JSON.stringify([a.reason, b.reason || null, c.reason]));
}
// 위험 관문: WEAK_RS 만 예외(실제 evaluateBuyBlocks)
{
  const closes = Array.from({ length: 60 }, (_, i) => 100 - i * 0.3);   // 지수보다 크게 약한 종목
  const daily = { closes, highs: closes, lows: closes, volumes: closes.map(() => 1e6) };
  const cfg = { rsFilterEnabled: true, rsLookbackDays: 20, rsMinOutperform: -2, marketCrashPct: -4, maxDailyDrop: 6, atrPeriod: 14, trendRules: {} };
  const regime = { worstDayPct: 0, regime: "BULL", idxReturn20: 3 };
  const ctx = { symbol: "ZZZ", strategy: "trend", market: "us" };
  const rRule = M.evaluateBuyBlocks(82, 0, daily, cfg, regime, { name: "TR_PULLBACK" }, ctx);
  const rOq = M.evaluateBuyBlocks(82, 0, daily, cfg, regime, { name: "OMNI_Q", isOmniQ: true }, ctx);
  const rCrash = M.evaluateBuyBlocks(82, 0, daily, cfg, Object.assign({}, regime, { worstDayPct: -5 }), { name: "OMNI_Q", isOmniQ: true }, ctx);
  chk(/^WEAK_RS/.test(rRule || "") && rOq === null && /^MARKET_CRASH/.test(rCrash || ""), "위험 관문: OMNI-Q 는 WEAK_RS 만 면제 · 폭락 차단은 그대로", JSON.stringify([rRule, rOq, rCrash]));
}
chk(/const _isAiSc = !!\(signal && \(signal\.isAiScalp \|\| signal\.isOmniQ( \|\| signal\.isPair)?\)\);/.test(S), "NEGEXP_MS: 남의 성적으로 OMNI-Q 를 막지 않는다(AI_SCALP 와 같은 예외)");
const blk = S.slice(S.indexOf("/* [V33.530] ★추격 매수 차단★(DEFAULT_CFG.antiChase"), S.indexOf("let _spillMult = 1;"));
chk(blk.length > 200 && /antiChaseWhy/.test(blk) && /incBlock\("OMNIQ_LOW"\)/.test(blk) && !/isOmniQ/.test(blk), "추격 차단·OMNIQ_LOW 블록은 OMNI-Q 를 예외로 두지 않는다(위험 관문 그대로)");

// ④ NEGEXP_SIG 교착 해소 — 실적 관문이 판정 중인 AI 키만
{
  const pg = { keys: { "kr:AI:TREND": { mode: "probation", n: 0 }, "us:AI:TREND": { mode: "open", n: 40 }, "kr:AI:SNAP": undefined, "us:RULE:TREND": { mode: "probation", n: 3 }, "kr:AI-Q:TREND": { mode: "open", n: 4 } } };
  const ap = { name: "AI_PRIMARY", isAiPrimary: true };
  chk(M.negExpDefersToPerfGate(pg, "kr", ap, "trend") && M.negExpDefersToPerfGate(pg, "us", ap, "trend"), "AI 키를 실적 관문이 판정 중(시험 · 표본 15+ 열림)이면 실적 관문에 맡긴다");
  chk(!M.negExpDefersToPerfGate(pg, "kr", ap, "snap") && !M.negExpDefersToPerfGate(pg, "us", { name: "TR_PULLBACK" }, "trend") && !M.negExpDefersToPerfGate(pg, "kr", { name: "OMNI_Q", isOmniQ: true }, "trend") && !M.negExpDefersToPerfGate(null, "kr", ap, "trend"),
      "기록 없는 AI 키 · 규칙 신호 · 표본 적은 열림 · 관문 못 읽음 → 종전대로 NEGEXP_SIG 가 막는다");
  const ng = S.slice(S.indexOf("if (negExpBlocked(signalStatsMkt, market, signal.name)) {"), S.indexOf("// [V33.44] ★시장×전략 게이트★"));
  chk(/negExpDefersToPerfGate\(await perfGateLoad\(DB, false\), market, signal, strategy\)/.test(ng) && /incBlock\("NEGEXP_SIG\[" \+ signal\.name \+ "\]"\)/.test(ng), "배선: 막기 전에 실적 관문을 한 번 본다(캐시 15분)");
  chk(M.negExpBlocked({ "kr:AI_PRIMARY": { count: 96, expectancy: -0.4, avgPnl: -0.39 } }, "kr", "AI_PRIMARY") === true, "NEGEXP_SIG 문턱 자체는 그대로(30건 · 기대값<0 · 평균<0)");
}

// ⑤ AI_PRIMARY 사유
chk(/detail: "셋업 " \+ _apSetup/.test(S) && /\(signal\.detail != null && signal\.detail !== "" \? " " \+ signal\.detail : ""\)/.test(S),
    "AI_PRIMARY 에 detail(셋업·야간픽·정렬·다기간) · detail 없는 신호도 'undefined' 를 안 찍는다");

// 화면
chk(/function route\(v\)/.test(H) && /진입 경로 켜짐/.test(H) && /return \{ tag: tag, gates: gates, line: line, brief: brief, card: card, route: route \}/.test(H) &&
    /v\.route = \{ enabled: OMNIQ_ROUTE\.enabled, on:/.test(S), "화면: OMNI-Q 카드가 진입 경로(켜짐·오늘 n/3·관리 중 보유)를 서버 route 로 그린다");
chk(/OMNI-Q 후보 " \+ __omqCand \+ " 체결 " \+ __omqBought/.test(S), "심사 로그에 OMNI-Q 후보·체결 수를 남긴다(조용한 0 구분)");

if (fails) { console.log("\n✗ OMNI-Q 진입 경로 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ OMNI-Q 진입 경로 통과");
