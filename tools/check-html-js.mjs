// [V33.61] public/index.html 의 인라인 <script> 문법 검사.
//   배경: 프론트는 단일 HTML 안에 인라인 스크립트로 들어있어 `node --check src/index.js` 로는
//   전혀 검증되지 않는다. 실제로 V33.60 에서 중괄호 하나가 어긋나 스크립트 전체가 죽고
//   우측 사이드바·AI두뇌 창이 통째로 사라졌는데, 배포 게이트는 그대로 통과했다.
//   → 배포 전에 인라인 스크립트도 반드시 파싱해 본다.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let m, idx = 0, bad = 0, checked = 0;
while ((m = re.exec(html)) !== null) {
  const code = m[1];
  idx++;
  if (!code.trim()) continue;
  const line = html.slice(0, m.index).split("\n").length;
  try {
    new vm.Script(code, { filename: `index.html:script#${idx}` });
    checked++;
    console.log(`  ok   script#${idx} (line ${line}, ${code.length.toLocaleString()} chars)`);
  } catch (e) {
    bad++;
    console.error(`  FAIL script#${idx} (line ${line}): ${e.message}`);
  }
}
console.log(`\ninline scripts: ${checked} ok, ${bad} failed`);

// ── [V33.62] 문법만으로는 부족하다 — 핵심 렌더 함수를 실제로 '실행'해 본다 ──
//   실제 사고: stepCell 에서 존재하지 않는 헬퍼 num() 을 호출했다. 문법은 완벽했고
//   파싱 검사도 통과했지만, 실데이터가 들어오는 순간 ReferenceError 로 패널 전체가 죽었다.
//   (빈 데이터에서는 그 분기를 안 타서 증상이 안 보이는 것도 발견을 늦췄다)
//   → 대표 입력 몇 가지로 렌더 함수를 직접 호출해 예외가 나는지 본다.
let rtBad = 0;
try {
  const m = html.match(/function renderRailAiMode[\s\S]*?\n  \}/);
  if (!m) { console.error("  WARN renderRailAiMode 추출 실패 — 런타임 검사 생략"); }
  else {
    const harness = `
      var STORE = {};
      function esc(x){ return String(x==null?'':x); }
      function $id(id){ return { set innerHTML(v){ STORE[id] = v; } }; }
      ${m[0]}
      var CASES = {
        empty:   [{ aiReady:false }, []],
        partial: [{ aiReady:true, phase:{us:'RANGE'}, scalp:{store:'D1(폴백)',r2Bound:false,d1Samples:1840,d1Pending:37,need:3000,observed:2100,labeled:1900}, samples:{}, committee:{} }, []],
        full:    [{ aiReady:true,
          phase:{us:'TREND_UP',kr:'MELTUP',dayUs:1.2,dayKr:11.7,r5Us:0.4,r5Kr:6,erUs:0.1,erKr:0.2,ts:Date.now()},
          xmkt:{semi1d:-3.2,semi5d:-8.1},
          sectors:{TECH:{etf:'XLK',d1:-1.4,d5:-3.2}},
          scalp:{need:3000,collected:0,n:0,observed:412,observedToday:412,labeled:180,
                 pending:232,filesToday:0,store:'R2',r2Bound:true,live:true,trusted:false,trained:false,
                 horizonMin:60,ifeatVer:3,ifeatN:38,minConfluence:3},
          samples:{total:173955,featVer:13,today:0,yesterday:0},
          committee:{mind:true,dnn:true,gbdt:true,
            xgb:{trusted:true,accLB:0.53,w:0.39,source:'external',promoted:true},lgb:null,cat:null},
          diag:{dnn:{stored:true,featVerOk:true,trusted:true,w:0.41,source:'external'}},
          alt:{flow:{samples:412,minN:800,trained:false,trusted:false,acc:null,ic:null,n:null},
               xalpha:{samples:9200,minN:800,trained:true,trusted:true,acc:0.552,ic:0.041,icBlock:0.038,icT:2.41,n:9200,fwdIC:0.031,fwdN:2400,fwdReady:true,holdPass:true,minFwd:1500},
               stack:{samples:120,minN:600,trained:false,trusted:false},
               memo:{samples:173955,minN:4000,trained:true,trusted:true,acc:0.541,ic:0.109,icBlock:0.104,icT:4.66,protos:120,n:19200,fwdIC:0.044,fwdN:8800,fwdReady:true,holdPass:true,minFwd:1500},
               backfill:{made:18400,cursor:52310,ts:Date.now()},
               scalpLev:{enabled:true,trusted:true,kelly:0.11,n:340,minKelly:0.05,maxMult:2,concMult:2,ddCut:6},
               dual:{samples:173955,minN:1200,bull:{trained:true,trusted:true,ic:0.031,acc:0.61,base:0.28,n:60000},
                                              bear:{trained:true,trusted:true,ic:0.026,acc:0.66,base:0.21,n:60000}},
               port:{all:{ready:true,n:212,winRate:0.523,nWin:111,nLoss:101,avgWin:3.42,avgLoss:2.61,
                          expectancy:0.544,profitFactor:1.31,riskReturn:0.118,maxLossStreak:6}},
               tradeState:{us:'REDUCING',kr:'ACTIVE',reason:'DAILY_LOSS 2.7%'},
               chain:{techK:{k:0.412,kEff:0.395,t:6.2,n:18400},finalCal:{T:1.35,ece:0.021,eceRaw:0.048,n:400},blendK:{kTech:0.72,kNews:0.18,tTech:3.4,n:380},confK:{k:0.11,kEff:0.04,t:1.9,n:4200},dualShift:{shift:{bull:0.31,bear:-0.52,volatile:-0.07,dead:-0.09,mixed:0},n:7200},evByVol:4,protect:{cooldownMin:90,lowProfitLockMin:360,enabled:true}},r2:{bound:true,ageSec:42,v:{total:642,bytes:263914000,groups:{"대형모델":{n:12,bytes:210000000},"일봉 이력":{n:600,bytes:52000000},"단타 표본":{n:29,bytes:1900000},"단타 대기버퍼":{n:1,bytes:14000}},today:{day:"2026-08-04",files:29,pending:412}}},gate:{rows:[{reason:"ai_primary_gate",n:42,avgRet:2.31,winRate:0.62},{reason:"max_concurrent",n:18,avgRet:0.44,winRate:0.55},{reason:"senti_override",n:9,avgRet:-1.8,winRate:0.33}],byP:[{reason:"ai_primary_gate",n:820,avgP:0.58,hi:310,maxP:0.81}],scored:69},audit:{ok:false,checked:912,nIssues:3,issues:[{code:'QTY_MISMATCH',symbol:'us|NVDA',detail:'원장 10 vs 포지션 8'},{code:'LEDGER_NET_NEGATIVE',symbol:'kr|005930.KS',detail:'원장 순보유 -5'}]}},
          thr:{us:{n:2000,thr:0.612,fixed:0.55,floor:0.53,topPct:0.18},
               kr:{n:37,thr:null,fixed:0.55}}},
          [{symbol:'NVDA',rankP:0.71}]],
        // [V33.81] 신규 3모델 표시 — 값이 부분적으로 비어도 그려져야 한다.
        altPartial: [{ aiReady:true, scalp:{}, samples:{}, committee:{},
          alt:{flow:null, xalpha:{samples:0,minN:800,trained:false,trusted:false},
               stack:{samples:600,minN:600,trained:true,trusted:false,ic:0.19,icBlock:0.17,icT:0.62,n:600,fwdIC:null,fwdN:120,fwdReady:false,holdPass:false,minFwd:1500},
               memo:{samples:900,minN:4000,trained:false,trusted:false},
               backfill:null, scalpLev:{enabled:true,trusted:false,kelly:null,n:0,minKelly:0.05,maxMult:2,concMult:2,ddCut:6},
               dual:{samples:400,minN:1200,bull:null,bear:null},
               port:{all:{ready:false,n:4}}, tradeState:{us:'HALTED',kr:'ACTIVE',reason:null},
               chain:{techK:null,finalCal:null,dualShift:null,evByVol:0,protect:{cooldownMin:90,lowProfitLockMin:360,enabled:true}},r2:{bound:false,v:null,ageSec:null},gate:{rows:[],byP:[],scored:0},audit:{ok:true,checked:0,nIssues:0,issues:[]}},
          thr:{us:null, kr:{n:0,thr:null,fixed:0.55}} }, []],
        /* [V33.146] ★서버가 실제로 내려주는 모양★ — portfolioStatsNightly 는 all.profitFactor 를
           통화혼합이라 일부러 null 로 비운다(us/kr 은 유효). 종전 fixture 는 profitFactor:1.31 로
           채워 둬서 이 경로를 한 번도 안 밟았고, 실제 운영에서 패널이 통째로
           "표시 오류: null is not an object (evaluating 'P.profitFactor.toFixed')" 로 죽었다.
           ready:true 인데 개별 필드는 null 일 수 있다 — 그 조합을 여기서 강제한다.
           아래 정적 검사(서버 null 필드 ↔ fixture)가 이 목록이 서버와 어긋나면 실패시킨다. */
        portMixedCcy: [{ aiReady:true, scalp:{}, samples:{}, committee:{},
          alt:{ port:{ all:{ ready:true, n:212, winRate:0.523, nWin:111, nLoss:101,
                  avgWin:3.42, avgLoss:2.61, expectancy:0.544,
                  profitFactor:null, profitFactorMixedCcy:true,
                  profitFactorNote:'통화혼합(원+달러) — 금액 기준 PF 는 무의미. 통화중립 지표는 omega',
                  riskReturn:0.118, sd:4.1, maxLossStreak:6,
                  sqn:1.72, edgeT:1.72, edgeDf:180, edgePNeg:0.043,
                  sortino:1.21, omega:2.278,
                  tailRatio:null, payoff:null, kelly:null,
                  tradeSeqUlcer:6.2, tradeSeqUpi:null, tradeSeqMaxDD:18.4,
                  tradeSeqRet:112, spanDays:null, ts:Date.now() } },
                tradeState:null, chain:null, r2:null, gate:null, audit:null },
          thr:{} }, []],
        /* 전부 null — ready 만 참이고 나머지가 비어도 패널은 살아야 한다(서버 예외 시의 모양). */
        portAllNull: [{ aiReady:true, scalp:{}, samples:{}, committee:{},
          alt:{ port:{ all:{ ready:true, n:11, winRate:null, nWin:null, nLoss:null,
                  avgWin:null, avgLoss:null, expectancy:null, profitFactor:null,
                  riskReturn:null, maxLossStreak:null, omega:null, sortino:null,
                  tailRatio:null, payoff:null, kelly:null,
                  tradeSeqUlcer:null, tradeSeqUpi:null, tradeSeqMaxDD:null,
                  tradeSeqRet:null, spanDays:null } } },
          thr:{} }, []],
        nullMode: [null, null]
      };
      var errs = [];
      for (var k in CASES) {
        try { renderRailAiMode(CASES[k][0], CASES[k][1]); }
        catch (e) { errs.push(k + ': ' + e.message); }
      }
      ({ errs: errs, n: Object.keys(CASES).length });
    `;
    const res = new vm.Script(harness, { filename: "renderRailAiMode-runtime" })
      .runInNewContext({ Date, Math, JSON, Number, String, Object, Array, isNaN, parseInt, parseFloat });
    const errs = (res && res.errs) || [];
    if (errs.length) {
      rtBad = errs.length;
      for (const e of errs) console.error(`  FAIL runtime ${e}`);
    } else {
      console.log("  ok   renderRailAiMode 런타임 " + ((res && res.n) || 0) + "케이스");
    }
  }
} catch (e) {
  console.error("  WARN 런타임 검사 자체 실패:", e.message);
}

// ── [V33.146] 서버가 null 로 내려보내는 필드는 ★반드시★ 위 fixture 에 null 로 들어간다 ──
//   실제 사고: V33.135 가 서버에서 all.profitFactor 를 null 로 비웠는데(통화혼합이라 옳은 결정)
//   렌더러는 그대로 .toFixed 를 불렀다. 게이트 fixture 는 profitFactor:1.31 로 채워져 있어서
//   19개 게이트가 전부 통과한 채 배포됐고, 사용자 화면에서 패널이 통째로 죽었다.
//   원인은 렌더러 한 줄이 아니라 ★fixture 가 서버와 따로 논 것★ 이다. 그래서 여기서는
//   서버 코드에서 "null 이 될 수 있는 필드" 를 직접 뽑아 fixture 와 대조한다 —
//   서버가 새 필드를 비우면 이 검사가 먼저 깨진다.
try {
  const srcN = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const gateSelf = readFileSync(new URL("./check-html-js.mjs", import.meta.url), "utf8");
  const nul = new Set();
  // (1) portfolioStatistics 의 반환 리터럴 — `x: cond != null ? … : null`
  const retIdx = srcN.indexOf("ready: true, n: n, market: o.market");
  if (retIdx > 0) {
    const block = srcN.slice(retIdx, srcN.indexOf("ts: Date.now()", retIdx));
    for (const mm of block.matchAll(/(\w+):\s*[^,]*?!=\s*null\s*\?[^,]*?:\s*null/g)) nul.add(mm[1]);
    // (2) `let x = null` 로 선언된 변수를 그대로 싣는 필드(tradeSeqUpi 가 그렇다)
    const lets = new Set([...srcN.matchAll(/\blet\s+(\w+)\s*=\s*null\b/g)].map((x) => x[1]));
    for (const mm of block.matchAll(/(\w+):\s*(\w+)\s*,/g)) if (lets.has(mm[2])) nul.add(mm[1]);
  }
  // (3) 야간 집계가 사후에 비우는 필드 — `all.profitFactor = null`
  for (const mm of srcN.matchAll(/\b(?:all|us|kr)\.(\w+)\s*=\s*null\b/g)) nul.add(mm[1]);

  if (!nul.size) { console.error("  FAIL 서버 null 필드를 하나도 못 뽑았다 — 검사가 헛돈다"); rtBad += 1; }
  else {
    // fixture 는 이 파일 자신의 CASES 리터럴이다.
    const fixIdx = gateSelf.indexOf("portMixedCcy:");
    const fix = fixIdx > 0 ? gateSelf.slice(fixIdx, gateSelf.indexOf("nullMode:", fixIdx)) : "";
    const miss = [...nul].filter((f) => !new RegExp("\\b" + f + "\\s*:\\s*null\\b").test(fix));
    if (miss.length) {
      console.error(`  FAIL 서버가 비우는 필드가 fixture 에 없다: ${miss.join(", ")} — 렌더러가 그 경로를 한 번도 안 밟는다`);
      rtBad += 1;
    } else {
      console.log(`  ok   서버 null 가능 필드 ${nul.size}개(${[...nul].join(",")}) 전부 fixture 에서 실제로 렌더된다`);
    }
  }
} catch (e) {
  console.error("  FAIL null 필드 대조 검사 실패:", e.message);
  rtBad += 1;
}

// ── [V33.146] 렌더 실패가 '운용 상태'로 둔갑하면 안 된다 ────────────────────
//   실제 사고: renderRailAiMode 가 던지자 loadLive 의 ②번 leg 이 통째로 중단되고
//   catch(){} 가 삼켰다. paintLive 가 안 돌아 상단 배지·KPI 는 초기값 {} 을 그대로 읽고
//   "규칙 비상운용 · 위원회 가동 0 / 6" 이라고 적었다 — 실제로는 6/6 가동 중이었다.
//   사이드바 한 칸이 깨진 것과 매매엔진이 멈춘 것은 전혀 다른 사건인데 화면이 후자로 보고했다.
try {
  const hj = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  let cbad = 0;
  const chk = (re, ok, ng) => { if (re.test(hj)) console.log("  ok   " + ok); else { cbad++; console.error("  FAIL " + ng); } };
  chk(/try \{ renderRailAiMode\(mode, acc\.picks\); \}\s*\n\s*catch/,
    "레일 렌더가 던져도 본화면(배지·KPI·캐시)은 계속 그린다",
    "renderRailAiMode 가 격리되지 않았다 — 한 번 던지면 배지·KPI 가 초기값으로 굳어 거짓 상태를 보고한다");
  chk(/mode\.aiReady == null\s*\n\s*\?\s*'<span class="nlv-tag">운용모드 확인 중/,
    "운용모드 미확인과 '규칙 비상운용' 을 구분한다",
    "데이터가 오기 전에도 단정적으로 '규칙 비상운용' 이라 적는다 — 없는 사고를 만들어낸다");
  // [V33.149] 명부가 늘어 분모가 상수가 아니게 됐다 — 리터럴이 아니라 ★의도★ 를 검사한다.
  //   계약은 그대로다: committee 가 없으면 '0 / N'(전원 정지)이 아니라 '—'(미확인).
  chk(/\['위원회 가동', c \? on\+' \/ '\+tot[^\n]*: '—'/,
    "committee 가 없으면 '0 / N'(전원 정지)이 아니라 '—'(미확인)",
    "committee 가 비어도 숫자를 적는다 — 미확인을 전원 정지로 오보한다");
  // 타일과 목록이 다른 말을 하면 안 된다 — 판정은 cmState 한 곳에서만 나온다.
  chk(/function cmState\(key, mode\)/,
    "위원 상태 판정이 cmState 한 곳에 모여 있다(타일·목록이 같은 답을 쓴다)",
    "위원 상태 판정이 흩어져 있다 — 타일과 목록이 어긋난다");
  chk(/CMROSTER\.forEach\(function\s*\(r\)\s*\{[\s\S]{0,200}?cmState\(r\[0\], mode\)/,
    "KPI 타일이 신규 위원까지 포함한 전체 명부를 센다",
    "KPI 타일이 고전 6종만 센다 — 잠정합류로 투표 중인 신규 위원이 화면에서 지워진다");
  rtBad += cbad;
} catch (e) { console.error("  FAIL 거짓상태 보고 검사 실패:", e.message); rtBad += 1; }

// ── [V33.148] 폰 폭에서 엔진 파이프라인 단계 '이름' 이 살아남는가 ────────────
//   실제 사고: .pl-age 는 flex-shrink:0 인데 .pl-name 은 아니라, 칸이 좁으면 ★이름부터★ 굶는다.
//   폰 전용 규칙이 minmax(96px,1fr) 로 칸을 잘게 쪼개 두어서 430px 기기에서도 8/8 이 잘렸고,
//   '거래 사이클' 이 15px 로 줄어 "거…" 만 보였다. 8개 서브시스템 감시판이 무용지물이었다.
//   CI 에 브라우저가 없으므로 ★캐스케이드를 직접 걸어★ 폰 폭에서 어떤 선언이 이기는지 계산한다.
try {
  const hp = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  //   주석은 먼저 걷어낸다 — 선택자를 역방향으로 읽기 때문에 규칙 바로 앞 주석이 붙어 오면
  //   ".pipeline-grid" 와 일치하지 않아 그 선언을 통째로 놓친다(처음 판에서 실제로 놓쳤다).
  const css = [...hp.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
  // @media 블록을 스택으로 추적하며 .pipeline-grid 선언을 조건과 함께 모은다.
  //   ※ 중첩 중괄호를 정확히 세야 한다 — 안 세면 일반 규칙의 첫 '}' 가 @media 를 조기에 닫아
  //     min-width:1000px 짜리 터미널 밀도 규칙이 폰에도 적용되는 것처럼 오판한다(실제로 겪었다).
  const decls = [];
  {
    let depth = 0, i = 0;
    const media = [];                       // { cond, depth }
    const selOf = (openIdx) => {
      let s = openIdx - 1;
      while (s >= 0 && css[s] !== "}" && css[s] !== "{" && css[s] !== ";") s--;
      return css.slice(s + 1, openIdx).trim();
    };
    while (i < css.length) {
      if (css.startsWith("@media", i)) {
        const open = css.indexOf("{", i);
        if (open < 0) break;
        media.push({ cond: css.slice(i, open), depth: depth });
        depth++; i = open + 1; continue;
      }
      const ch = css[i];
      if (ch === "{") {
        const sel = selOf(i), end = css.indexOf("}", i);
        if (sel === ".pipeline-grid" && end > 0) {
          const maxes = media.map((m) => (m.cond.match(/max-width:\s*(\d+)px/) || [])[1]).filter(Boolean).map(Number);
          decls.push({ sel, body: css.slice(i + 1, end),
            maxW: maxes.length ? Math.min(...maxes) : Infinity,
            minW: Math.max(0, ...media.map((m) => +((m.cond.match(/min-width:\s*(\d+)px/) || [])[1] || 0))) });
          i = end + 1; continue;            // 규칙 전체를 소비 — depth 는 그대로
        }
        depth++; i++; continue;
      }
      if (ch === "}") {
        depth--;
        while (media.length && media[media.length - 1].depth >= depth) media.pop();
        i++; continue;
      }
      i++;
    }
  }
  // 390px(가장 흔한 폰)에서 이기는 선언 = 조건을 만족하는 것 중 ★파일 순서상 마지막★
  const W = 390;
  const win = decls.filter((d) => W <= d.maxW && W >= d.minW).pop();
  let pbad = 0;
  if (!decls.length) { pbad++; console.error("  FAIL .pipeline-grid 선언을 못 찾았다 — 검사가 헛돈다"); }
  else if (!win) { pbad++; console.error("  FAIL 390px 에서 적용되는 .pipeline-grid 선언이 없다"); }
  else {
    const cols = (win.body.match(/grid-template-columns:\s*([^;]+)/) || [])[1] || "";
    // 한 칸이 되거나(1fr/none), 최소폭이 넉넉해야(≥240px) 이름이 안 굶는다.
    const single = /^\s*(1fr|none)\s*$/.test(cols);
    const mm = +((cols.match(/minmax\(\s*(\d+)px/) || [])[1] || 0);
    if (single || mm >= 240) console.log(`  ok   폰(390px) 파이프라인 그리드 = "${cols.trim()}" — 단계 이름이 굶지 않는다`);
    else { pbad++; console.error(`  FAIL 폰에서 .pipeline-grid 가 "${cols.trim()}" — 칸이 좁아 .pl-age(shrink 불가)가 이름을 굶긴다`); }
  }
  if (/\.pl-name\{flex:1 1 auto;min-width:0;\}/.test(hp))
    console.log("  ok   .pl-name 이 남는 폭을 먼저 가져간다");
  else { pbad++; console.error("  FAIL .pl-name 에 flex:1 1 auto;min-width:0 이 없다 — 나이 문자열이 길면 이름이 사라진다"); }
  rtBad += pbad;
} catch (e) { console.error("  FAIL 파이프라인 폰 레이아웃 검사 실패:", e.message); rtBad += 1; }

// ── [V33.153] 구조 관측 모델 목록은 그 뷰에서만 보인다 ──────────────────────
//   작동 화면에서는 누를 이유가 없는 버튼 12개가 사이드바 세로 예산만 먹었다.
//   ★표시 여부와 활성 표시가 한 함수에서 나와야★ '보이는데 활성표시가 없는' 어긋난 상태가 없다.
try {
  const hr = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  let sbad = 0;
  if (/function syncRailModels\(active\)\{[\s\S]{0,320}?railModelsSec[\s\S]{0,120}?BVIEW === 'struct'/.test(hr))
    console.log("  ok   모델 목록 표시를 syncRailModels 가 BVIEW 로 정한다(활성 표시와 같은 곳)");
  else { sbad++; console.error("  FAIL 모델 목록 표시가 뷰와 연결돼 있지 않다 — 작동 화면에서도 버튼이 남는다"); }
  if (/id="railModelsSec" style="display:none;"/.test(hr))
    console.log("  ok   초기값이 숨김 — 부팅 직후 한 프레임 깜빡였다가 사라지지 않는다");
  else { sbad++; console.error("  FAIL 모델 목록 초기값이 '보임' — 작동 화면 부팅 시 깜빡인다"); }
  rtBad += sbad;
} catch (e) { console.error("  FAIL 모델 목록 표시 검사 실패:", e.message); rtBad += 1; }

// ── [V33.153] 위원회 구성은 깔때기 카드 ★안에 있으면 안 된다★ ────────────────
//   V33.149 는 '자리가 남아서' 깔때기 카드 안에 넣었는데, 그러자 히어로 두 카드의 무게가
//   무너졌다 — 왼쪽(최우선 후보)은 649px 중 대부분이 빈 공간이고 오른쪽만 빽빽했다.
//   질문 자체도 다르다: 깔때기는 "무엇을 걸렀나", 위원회는 "누가 판단했나".
try {
  const hh2 = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  let hbad = 0;
  const wrap = hh2.match(/<div class="nlv-funnel-wrap">[\s\S]*?<\/div>\s*<\/div>/);
  if (wrap && /nlvCommittee/.test(wrap[0])) {
    hbad++; console.error("  FAIL 위원회 구성이 깔때기 카드 안에 있다 — 히어로 두 카드의 무게가 다시 무너진다");
  } else console.log("  ok   위원회 구성이 깔때기 카드 밖(제 줄)에 있다 — 히어로 두 카드가 같은 무게를 갖는다");
  if (/<div class="nlv-cmrow">/.test(hh2)) console.log("  ok   위원회 전용 줄(.nlv-cmrow)이 있다");
  else { hbad++; console.error("  FAIL 위원회 전용 줄이 없다"); }
  if (/\.nlv-cmlist\{[^}]*repeat\(auto-fill,minmax\(/.test(hh2))
    console.log("  ok   위원회 열 수가 폭에 따라 자동(고정 2열이면 넓은 화면에서 늘어진다)");
  else { hbad++; console.error("  FAIL 위원회가 고정 열 수다 — 제 줄로 나온 이점을 못 쓴다"); }
  rtBad += hbad;
} catch (e) { console.error("  FAIL 히어로 배치 검사 실패:", e.message); rtBad += 1; }

// ── [V33.152] 위원회 구성 카드는 ★재질 토큰★ 으로만 칠한다 ──────────────────
//   실제로 겪은 문제: 처음 판은 #080d18/#14203a 같은 리터럴로 칠했고, 그래서 라이트 테마용
//   색을 ★또 한 벌★ 적어야 했다(html[data-theme="light"] 8줄). 두 벌은 반드시 드리프트한다 —
//   한쪽만 고치는 순간 한 테마에서만 깨지고, 그건 그 테마를 쓰는 사람만 본다.
//   토큰(--ap-*)으로 칠하면 라이트는 역할 재정의만으로 따라온다(실제로 그렇게 줄였다).
try {
  const hk = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const css = [...hk.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
  // .nlv-cm / .nlv-cmlist 를 대상으로 하는 규칙만 모은다
  const rules = [...css.matchAll(/([^{}]*\.nlv-cm(?:list)?\b[^{}]*)\{([^}]*)\}/g)];
  let cbad = 0;
  if (rules.length < 5) { cbad++; console.error(`  FAIL 위원회 카드 CSS 규칙을 ${rules.length}개밖에 못 찾았다 — 검사가 헛돈다`); }
  else {
    const hex = rules.filter((r) => /#[0-9a-fA-F]{3,8}\b/.test(r[2]) && !/var\(--[a-z-]+,\s*#/.test(r[2]));
    if (hex.length) {
      cbad++;
      console.error(`  FAIL 위원회 카드에 하드코딩 색 ${hex.length}건 — 라이트 테마용 CSS 를 또 적게 되고 두 벌은 드리프트한다`);
      console.error(`       예: ${hex[0][1].trim().slice(0, 60)} { ${hex[0][2].trim().slice(0, 60)} }`);
    } else console.log(`  ok   위원회 카드 CSS ${rules.length}개 규칙이 전부 재질 토큰 기반(라이트 테마가 따로 필요 없다)`);
    // 라이트 전용 덧칠이 다시 생기면 그것도 드리프트의 시작이다.
    const lightDupes = (css.match(/html\[data-theme="light"\][^{}]*\.nlv-cm\b/g) || []).length;
    if (lightDupes === 0) console.log("  ok   위원회 카드에 라이트 전용 덧칠이 없다 — 색 정의가 한 곳뿐이다");
    else { cbad++; console.error(`  FAIL 라이트 전용 .nlv-cm 규칙 ${lightDupes}건 — 색 정의가 두 곳으로 갈렸다`); }
  }
  /* 상태를 ★색만으로★ 말하지 않는다 — 색각 이상·흑백 캡처에서도 읽혀야 한다.
     [V33.219] 클래스 이름이 아니라 ★채널★ 을 센다. 종전엔 cm-dot·cs·cm-w 세 이름을 요구했는데,
     그러면 같은 보장을 더 나은 도형으로 바꿀 때(막대+점 → 채워지는 고리) 계약이 가로막는다.
     지켜야 하는 것은 이름이 아니라 "색 말고 두 가지 이상으로 말한다" 이다:
       · 글자 채널 — 상태 문구(.cs)
       · 기하 채널 — 길이/각도로 크기를 말하는 것(고리의 --w 호 길이, 또는 막대 폭) */
  {
    const textCh = /<span class="cs">/.test(hk);
    const geomCh = (/class="cm-ring"[^>]*--w:/.test(hk) || /--w:'\+/.test(hk))   // 고리 호 길이
                || /<span class="cm-w">/.test(hk);                               // 또는 종전 막대
    if (textCh && geomCh)
      console.log("  ok   상태를 색 외에 글자·기하(호 길이) 두 채널로 말한다(색각 이상·흑백에서도 읽힌다)");
    else {
      cbad++;
      console.error("  FAIL 상태 표시가 색에만 의존한다 — 글자 채널" + (textCh ? " O" : " X") +
                    " · 기하 채널" + (geomCh ? " O" : " X"));
    }
  }
  rtBad += cbad;
} catch (e) { console.error("  FAIL 위원회 카드 토큰 검사 실패:", e.message); rtBad += 1; }

// ── [V33.150] 구조 관측 탭 ↔ /api/nn-viz 라우팅 배선 ────────────────────────
//   탭만 늘리고 서버 라우팅을 안 고치면 그 탭은 DNN 구조를 보여준다(폴백이 mlDNNVizData 다).
//   조용히 틀린 그림을 보여주는 것이라 화면만 봐서는 알아채기 어렵다 — 배선을 강제한다.
try {
  const hv = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const sv = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  /* [V33.215] ★컨테이너를 정규식으로 자르지 않는다.★ 종전엔 `<div class="nnv-tabs"…첫 </div>`
     로 잘랐는데, 그 방식은 두 가지로 무너진다:
       ① 클래스에 수식어가 붙으면(`class="nnv-tabs nnv-nav"`) 아예 안 잡혀 탭이 0개가 된다.
       ② 안에 <div> 를 하나라도 중첩하면 첫 </div> 에서 끊겨 뒤쪽 탭이 검사에서 통째로 빠진다.
     ②가 특히 위험하다 — 검사는 계속 초록불인데 라우팅 없는 탭이 조용히 늘어난다.
     → id 로 찾아 여는/닫는 <div> 를 세어 정확한 범위를 잡는다. */
  const tabsBlock = (function () {
    /* 주석을 먼저 지운다 — 주석 본문이 태그를 언급하면(예: "<div> 를 중첩하지 않는다")
       여는/닫는 개수를 세는 이 로직이 어긋난다. 짝이 맞으면 우연히 통과하지만,
       한쪽만 적힌 순간 블록 경계가 엉뚱한 데서 끊겨 뒤쪽 탭이 통째로 빠진다. */
    const clean = hv.replace(/<!--[\s\S]*?-->/g, "");
    const i = clean.indexOf('id="nnvTabs"');
    if (i < 0) return "";
    const open = clean.lastIndexOf("<div", i);
    let d = 0, k = open;
    while (k < clean.length) {
      if (clean.startsWith("<div", k)) d++;
      else if (clean.startsWith("</div>", k)) { d--; if (!d) return clean.slice(open, k + 6); }
      k++;
    }
    return "";
  })();
  const tabs = [...tabsBlock.matchAll(/data-model="([^"]+)"/g)].map((m) => m[1]);
  /* [V33.206] ★창을 넓힌다 — 계약은 그대로다.★ 종전 정규식은 `if (path === "/api/nn-viz")`
     처럼 ★닫는 괄호까지★ 요구해서, 같은 경로를 쿼리로 가르는 분기
     (`if (path === "/api/nn-viz" && ...model === "overview")`)를 못 봤다.
     그러면 실제로 라우팅된 탭을 "라우팅 없음" 으로 잘못 잡는다. 검사가 봐야 하는 것은
     "그 모델 이름이 nn-viz 처리부 어딘가에서 실제로 갈라지는가" 이므로 그 범위를 다 담는다. */
  /* [V33.219] ★고정 길이 창(9000자)으로 자르지 않는다.★ 핸들러에 코드가 조금만 늘어도
     창을 넘어가 "라우팅이 없다" 는 거짓 실패가 난다(실제로 그렇게 났다). 더 나쁜 경우는
     반대다 — 창이 짧아 뒤쪽 분기를 못 보면 라우팅 없는 탭을 놓친다.
     시작(첫 nn-viz 분기)과 끝(DNN 폴백)을 실제 위치로 잡는다. */
  const route = (function () {
    const a = sv.indexOf('if (path === "/api/nn-viz"');
    if (a < 0) return "";
    const b = sv.indexOf("await mlDNNVizData(env.DB));", a);
    if (b < 0) return "";
    return sv.slice(a, b + "await mlDNNVizData(env.DB));".length);
  })();
  const linKeys = [...(sv.match(/const _LINVIZ = \{[\s\S]*?\n\};/) || [""])[0].matchAll(/^\s{2}(\w+):\s*\{/gm)].map((m) => m[1]);
  const missing = tabs.filter((t) => {
    // overview 는 선형/트리 렌더러가 아니라 ★전용 분기★ 로 간다(층 구조를 그리므로).
    if (t === "overview") return !route.includes('=== "overview"');
    if (t === "dnn" || t === "mind" || t === "memo") return !route.includes('"' + t + '"') && t !== "dnn";
    if (["gbdt", "xgb", "lgb", "cat"].includes(t)) return !route.includes('"' + t + '"');
    return !linKeys.includes(t);
  });
  let nbad = 0;
  if (!tabs.length) { nbad++; console.error("  FAIL 구조 관측 탭을 하나도 못 찾았다 — 검사가 헛돈다"); }
  else if (missing.length) { nbad++; console.error(`  FAIL 탭은 있는데 서버 라우팅이 없다: ${missing.join(", ")} — 그 탭은 조용히 DNN 구조를 보여준다`); }
  else console.log(`  ok   구조 관측 탭 ${tabs.length}종(${tabs.join(",")})이 전부 서버 라우팅과 이어져 있다`);
  // 프론트 MODELS(사이드바 목록)와 탭 목록이 어긋나면 사이드바에서 고른 모델이 활성표시가 안 된다.
  /* [V33.215] ★탭이 스크롤 뒤에 숨으면 없는 것과 같다.★ 실제로 그렇게 됐다:
     .nnv-tabs 가 overflow-x:auto 인데 스크롤바까지 감춰서(scrollbar-width:none +
     ::-webkit-scrollbar{display:none}), 13번째 탭(이중헤드 약세)이 오른쪽으로 밀려나면
     데스크톱에서는 ★존재를 알 수 있는 단서가 하나도 없었다★.
     계약: 스크롤바를 감추려면 줄바꿈해야 한다(grid 또는 flex-wrap:wrap). 둘 다 아니면 막는다.
     ※ 좁은 화면(모바일)의 가로 스크롤은 예외다 — 거기서는 스와이프가 자연스러운 단서다. */
  {
    const deskRule = (hv.match(/#page-nnviz \.nnv-tabs\{[\s\S]*?\}/) || [""])[0];
    const hidesBar = /scrollbar-width:\s*none/.test(deskRule) ||
      /#page-nnviz \.nnv-tabs::-webkit-scrollbar\{[^}]*display:\s*none/.test(hv);
    const wraps = /display:\s*grid/.test(deskRule) || /flex-wrap:\s*wrap/.test(deskRule);
    if (hidesBar && !wraps) {
      nbad++;
      console.error("  FAIL 구조 관측 탭이 스크롤바를 감춘 채 한 줄로 흐른다 — 밀려난 탭은 화면에서 사라진다(줄바꿈하게 할 것)");
    } else console.log("  ok   구조 관측 탭이 줄바꿈한다 — 스크롤 뒤로 숨는 탭이 없다");
  }
  const rail = [...((hv.match(/var MODELS = \[[\s\S]*?\];/) || [""])[0]).matchAll(/\['(\w+)'/g)].map((m) => m[1]);
  const diff = tabs.filter((t) => !rail.includes(t)).concat(rail.filter((r) => !tabs.includes(r)));
  if (!diff.length) console.log("  ok   사이드바 모델 목록과 탭 목록이 같다");
  else { nbad++; console.error(`  FAIL 사이드바/탭 목록 불일치: ${diff.join(", ")} — 고른 모델이 활성표시되지 않는다`); }
  /* ══ [V33.181] ★사이드바와 구조패널이 같은 사실을 달리 말하면 안 된다★ ══
     구조 관측 패널은 featVer 가 어긋난 모델을 '판 불일치 · v1 → v3 재학습 대기' 라고 정확히
     말하는데, 사이드바는 같은 순간에 '표본수집 980 / 800' 이라고 적었다(운영 스냅샷 실측).
     표본이 문턱을 넘었는데 '수집 중' 이라 하니, 왜 학습이 안 되는지 화면만 보고는 알 수 없다.
     ★두 패널이 같은 입력을 다르게 해석하는 것★ 이 이 저장소의 반복 사고라 계약으로 묶는다. */
  //   범위는 arow 선언부터 그 다음 선언(bfTxt)까지 — 처음엔 첫 `return [ico(` 까지로 잡았는데
  //   arow 는 맨 앞에 조기반환이 하나 있어 본문을 통째로 놓쳤다(검사가 헛돌았다).
  const railBody = (hv.match(/var arow = function[\s\S]*?var bfTxt/) || [""])[0];
  if (/o\.staleVer != null/.test(railBody)) console.log("  ok   사이드바가 판 불일치를 '표본수집' 이 아니라 판 불일치로 적는다");
  else { nbad++; console.error("  FAIL 사이드바가 판 불일치를 표본수집으로 뭉갠다 — 구조패널과 다른 말을 한다"); }
  if (/o\.samples >= o\.minN/.test(railBody)) console.log("  ok   사이드바가 '문턱 충족인데 미학습' 을 수집 중이라 적지 않는다");
  else { nbad++; console.error("  FAIL 표본이 문턱을 넘어도 '표본수집' 으로 적힌다 — 스냅샷의 980/800 모순이 되살아난다"); }
  // 서버가 그 판 정보를 실제로 내려주는지(프론트만 고치면 항상 null 이라 분기가 죽는다).
  const srcTxt = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  if (/staleVer:\s*\(m && Array\.isArray\(m\.w\)/.test(srcTxt)) console.log("  ok   서버가 위원별 staleVer/wantVer 를 내려준다");
  else { nbad++; console.error("  FAIL 서버가 staleVer 를 안 내려준다 — 사이드바 분기가 영원히 안 걸린다"); }
  rtBad += nbad;
} catch (e) { console.error("  FAIL 구조 관측 배선 검사 실패:", e.message); rtBad += 1; }

// ── [V33.150] 대시보드 경제지표 캘린더가 패널 밖으로 잘리지 않는가 ──────────
//   실제 증상: 7열 표(일시·영향·지표·실제·예상·이전·서프)가 요구하는 최소폭이
//   1fr:1fr 로 나눈 칸을 넘겨, 패널의 overflow-x 안으로 오른쪽 열이 숨었다.
//   헤드리스 실측(1024px): 표 523px vs 가용 414px → 109px 이 잘려 나갔다.
//   폭을 정한 건 값이 아니라 ★헤더 글자★ 였다("Expected" 65px vs 값 "49.2" 30px).
try {
  const hc = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  let ebad = 0;
  const cols = (hc.match(/\.cmbd-grid\{[^}]*grid-template-columns:\s*([^;]+);/) || [])[1] || "";
  const fr = [...cols.matchAll(/([\d.]+)fr/g)].map((x) => +x[1]);
  if (fr.length === 2 && fr[0] > fr[1] * 1.15)
    console.log(`  ok   경제지표 칸이 기술분석 칸보다 넓다 (${cols.trim()}) — 7열 표와 입력 한 줄에 같은 폭을 주지 않는다`);
  else { ebad++; console.error(`  FAIL .cmbd-grid 가 "${cols.trim()}" — 7열 표가 좁은 칸에 갇혀 오른쪽 열이 잘린다`); }
  if (/td\.econ-name\{[^}]*max-width:[^}]*text-overflow:\s*ellipsis/.test(hc))
    console.log("  ok   지표명 칸이 묶여 있다 — 긴 이름이 표 전체를 밀어내지 못한다");
  else { ebad++; console.error("  FAIL 지표명 칸에 max-width/ellipsis 가 없다 — 긴 지표명 하나가 표를 패널 밖으로 민다"); }
  if (/<th class="right" title="Expected[^"]*">예상<\/th>/.test(hc))
    console.log("  ok   숫자 열 헤더가 짧다(원 이름은 툴팁) — 헤더가 열 폭을 정하지 못한다");
  else { ebad++; console.error("  FAIL 숫자 열 헤더가 길다 — 값보다 헤더가 넓어 표가 밀려난다"); }
  rtBad += ebad;
} catch (e) { console.error("  FAIL 경제지표 캘린더 폭 검사 실패:", e.message); rtBad += 1; }

// ── [V33.123] AI 운영상태 스냅샷 다운로드 — 실제로 실행해 본다 ──────────────
//   버튼·핸들러·함수 셋 중 하나만 어긋나도 "눌러도 아무 일이 없는 버튼" 이 된다.
//   이 저장소는 그런 손잡이를 여러 번 만들었다(설정은 있는데 코드가 안 읽던 82개 키).
//   그래서 존재 확인이 아니라 ★fetch 를 모킹해 함수를 돌리고 결과 JSON 을 검사★ 한다.
//   특히 '일부 엔드포인트 실패' 는 반드시 시험한다 — 진단 파일이 필요한 상황은
//   대개 무언가 이미 고장난 상황이라, 하나 실패했다고 전체가 날아가면 쓸모가 없다.
try {
  const htmlS = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  // 버튼 · 핸들러 배선
  const wired = [
    [/id="btnDownloadAiStatus"/, "설정에 AI 운영상태 버튼이 있다"],
    [/_btnDlAiStatus\.addEventListener\('click', downloadAiStatus\)/, "버튼에 핸들러가 붙어 있다"],
    [/function downloadAiStatus\(\)/, "downloadAiStatus 가 정의돼 있다"],
    [/chk\.build = _BUILD_VER;/, null]   // 서버측은 아래에서 따로 본다
  ];
  let wbad = 0;
  for (const [re, what] of wired) {
    if (!what) continue;
    if (re.test(htmlS)) console.log("  ok   " + what);
    else { wbad++; console.error("  FAIL " + what + " — 눌러도 아무 일이 없는 버튼이 된다"); }
  }
  const srcS = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  if (/chk\.build = _BUILD_VER;/.test(srcS)) console.log("  ok   /api/selfcheck 가 build 를 내려준다(스냅샷 해석에 필요)");
  else { wbad++; console.error("  FAIL selfcheck 가 build 를 안 내려준다 — 스냅샷의 build 가 항상 null 이 된다"); }

  // 런타임 — fetch 모킹
  const bodyS = [...htmlS.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1]).find((t) => t.includes("function downloadAiStatus"));
  if (!bodyS) { wbad++; console.error("  FAIL downloadAiStatus 를 담은 스크립트를 못 찾았다"); }
  else {
    const fnSrc = bodyS.match(/function downloadJSON[\s\S]*?\n  \}\n/)[0]
                + bodyS.match(/function downloadAiStatus[\s\S]*?\n  \}\n/)[0];
    const runCase = async (fetchImpl) => {
      let captured = null; const toasts = [];
      const g = {
        toast: (m) => toasts.push(m), fetch: fetchImpl,
        Blob: class { constructor(parts) { captured = parts.join(""); } },
        URL: { createObjectURL: () => "blob:x", revokeObjectURL: () => {} },
        document: { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} }, getElementById: () => null },
        navigator: { userAgent: "gate" }, window: {}, setTimeout: (f) => f(),
        Date, JSON, Promise, String, Object, Array, Number, Math
      };
      const keys = Object.keys(g);
      const fn = new Function(...keys, fnSrc + "; return downloadAiStatus;")(...keys.map((k) => g[k]));
      fn();
      await new Promise((r) => setTimeout(r, 30));
      return { j: captured ? JSON.parse(captured) : null, toasts };
    };
    const okFetch = (u) => Promise.resolve({ ok: true, json: () => Promise.resolve(
      u === "/api/selfcheck" ? { build: "VTEST", serverTs: 111 } : { endpoint: u }) });
    const r1 = await runCase(okFetch);
    const want = ["aiMode", "aiSelfcheck", "selfcheck", "mlStatus", "pipeline"];
    const missing = want.filter((k) => !r1.j || r1.j[k] == null);
    if (!missing.length && r1.j.fetchErrors === 0 && r1.j.build === "VTEST")
      console.log("  ok   AI 운영상태 스냅샷 " + want.length + "항목 수집 · build 기록 · fetchErrors 0");
    else { wbad++; console.error("  FAIL 스냅샷 내용 이상 — 누락 " + missing.join(",") + " build " + (r1.j && r1.j.build) + " err " + (r1.j && r1.j.fetchErrors)); }

    // ★일부 실패해도 나머지는 살아야 한다★
    const mixFetch = (u) => u === "/api/ml-status" ? Promise.resolve({ ok: false, status: 500 })
                      : u === "/api/pipeline" ? Promise.reject(new Error("network down"))
                      : okFetch(u);
    const r2 = await runCase(mixFetch);
    /* [V33.181] 사유 문구에 ★소요시간★ 이 붙었으므로 완전일치가 아니라 포함으로 본다.
       사유가 남는지(계약)와 문구를 한 자도 못 바꾸게 하는 것(과잉구속)은 다르다. */
    const okPartial = r2.j && r2.j.fetchErrors === 2
      && r2.j.mlStatus && /^HTTP 500/.test(r2.j.mlStatus.__error)
      && r2.j.pipeline && /network down/.test(r2.j.pipeline.__error)
      && r2.j.aiMode && r2.j.aiMode.endpoint === "/api/ai-mode";
    if (okPartial) console.log("  ok   일부 실패해도 나머지는 수집되고 실패 사유가 파일에 남는다");
    else { wbad++; console.error("  FAIL 부분 실패 처리 이상: " + JSON.stringify(r2.j && { e: r2.j.fetchErrors, m: r2.j.mlStatus, p: r2.j.pipeline })); }
    // [V33.181] 소요시간이 성공·실패 모두에 남아야 '죽은 것'과 '느린 것'을 구분할 수 있다.
    const tm = r2.j && r2.j.timingsMs;
    if (tm && typeof tm.aiMode === "number" && typeof tm.mlStatus === "number" && typeof tm.pipeline === "number")
      console.log("  ok   경로별 소요시간(timingsMs)이 성공·실패 모두에 기록된다");
    else { wbad++; console.error("  FAIL 소요시간이 안 남는다 — 'Load failed' 만으로는 느린 건지 죽은 건지 못 가린다"); }
    if (r2.toasts.some((t) => /수집 실패/.test(t))) 
console.log("  ok   부분 실패를 사용자에게 알린다");
    else { wbad++; console.error("  FAIL 부분 실패인데 성공한 것처럼 알린다"); }
  }
  rtBad += wbad;
} catch (e) {
  console.error("  FAIL AI 운영상태 다운로드 검사 실패:", e.message);
  rtBad += 1;
}


// ══ [V33.144] AI 운용상태가 ★두뇌 화면 밖에서도★ 채워지는가 ══════════════════
//   사고: renderRailAiMode 를 부르는 곳이 loadLive 한 곳뿐이었고, loadLive 는 liveStart()
//   안에서만 돌며 liveStart 는 `id === 'nnviz'` 일 때만 호출됐다. 즉 AI 두뇌 화면에
//   들어가야만 채워지고 다른 화면에서는 초기 문구("확인 중…")가 그대로 남았다.
//   데스크톱은 그 화면 밖에서 레일이 숨겨져 티가 덜 났지만 ★모바일은 #mobAiMode 가
//   모든 화면에 보인다★ — 사용자가 본 "계속 로딩중" 이 그것이다.
//   (헤드리스 크로뮴으로 재현·검증했다: 수정 전 5케이스 전부 "확인 중…" 고착, 수정 후 전부 채워짐)
{
  let abad = 0;
  const aok = (m) => console.log("  ok   " + m);
  const abd = (m) => { abad++; console.error("  FAIL " + m); };
  const hh = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

  if (/function aiModeStart\(\)/.test(hh)) aok("두뇌 화면과 무관한 독립 로더(aiModeStart)가 있다");
  else abd("독립 로더가 없다 — 두뇌 화면에 들어가야만 AI 운용상태가 채워진다");

  if (/watchPages\(\);[\s\S]{0,400}?aiModeStart\(\);/.test(hh)) aok("부팅 시 조건 없이 시작한다");
  else abd("부팅 경로에서 aiModeStart 를 부르지 않는다 — 첫 화면이 두뇌가 아니면 영영 안 채워진다");

  const mm = hh.match(/if\(id === 'nnviz'\) liveStart\(\); else liveStop\(\);[\s\S]{0,320}/);
  if (mm && /aiModeStart\(\);/.test(mm[0])) aok("페이지 전환 시에도 로더가 유지된다(liveStop 과 함께 꺼지지 않는다)");
  else abd("페이지 전환에서 AI 운용상태 로더가 함께 멈춘다 — '계속 로딩중' 재발");

  if (/상태 조회 실패[\s\S]{0,120}?자동 재시도/.test(hh)) aok("조회 실패 시 사유를 적는다(초기 문구에 머물지 않는다)");
  else abd("조회 실패 시 초기 문구 그대로 남는다 — 무엇이 일어났는지 화면이 말하지 않는다");

  // [V33.145] 세 갈래 실패를 각각 막았는지 — 늦은 DOM · 응답 지연 · 렌더 예외
  if (/function aiModePump\(\)/.test(hh) && /if\(!aiModeTargets\(\)\.length\) return;/.test(hh))
    aok("대상 DOM 이 늦게 생겨도 펌프가 다시 그린다(요소 없으면 조용히 return 하던 경로)");
  else abd("늦게 생긴 DOM 을 다시 그리지 않는다 — 첫 페인트가 무효면 최대 2분간 '확인 중…'");
  if (/new AbortController\(\)/.test(hh) && /응답 지연/.test(hh))
    aok("응답이 12초를 넘으면 끊고 '응답 지연' 으로 표시한다(무한 대기 없음)");
  else abd("fetch 에 시간 제한이 없다 — 응답이 안 오면 영원히 로딩중");
  if (/◌ 표시 오류/.test(hh))
    aok("렌더러가 던지면 예외 메시지를 화면에 적는다(삼키지 않는다)");
  else abd("렌더 예외를 삼킨다 — 초기 문구가 그대로 남는다");
  const gateIdx = hh.indexOf("railGate();"), startIdx = hh.indexOf("aiModeStart();");
  if (gateIdx > 0 && startIdx > gateIdx)
    aok("aiModeStart 가 railGate(레일 DOM 생성) ★뒤★ 에 온다");
  else abd("aiModeStart 가 railGate 앞에 있다 — 첫 페인트 때 #railAiMode 가 아직 없다");
  if (/am\.id = 'mobAiMode'[\s\S]{0,400}?aiModeRepaint\(\)/.test(hh))
    aok("모바일 #mobAiMode 생성 직후 곧바로 다시 그린다");
  else abd("모바일 요소 생성 후 재페인트가 없다 — 다음 폴링(2분)까지 '확인 중…'");

  if (/luxAiModeCache/.test(hh)) aok("마지막 성공값을 캐시해 즉시 표시한다");
  else abd("캐시가 없다 — 매번 네트워크를 기다리며 '확인 중…' 이 보인다");

  // [V33.145] 판 버전 표식 — src 의 _BUILD_VER 와 ★반드시★ 같아야 한다.
  //   다르면 배너가 영원히 뜨거나(거짓 경보) 영원히 안 뜬다(캐시 문제를 못 잡는다).
  const src2 = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const mv = (hh.match(/<meta name="lux-build" content="([^"]+)"/) || [])[1];
  const sv = (src2.match(/const _BUILD_VER = "([^"]+)"/) || [])[1];
  if (mv && sv && mv === sv) aok(`판 표식 일치 (${mv}) — 서버 build 와 비교해 캐시 문제를 화면이 알린다`);
  else abd(`판 표식 불일치: index.html "${mv}" vs src "${sv}" — 배너가 거짓으로 뜨거나 안 뜬다`);
  if (/lux-build-banner/.test(hh) && /location\.replace\(location\.pathname \+ '\?v='/.test(hh))
    aok("새 버전 배너가 쿼리스트링으로 캐시를 우회한다(단순 reload 는 인앱 브라우저가 또 캐시를 준다)");
  else abd("버전 불일치 배너가 없거나 캐시 우회를 안 한다");

  rtBad += abad;
}

/* ── [V33.198] 렌더러가 자기 스코프에 없는 도우미를 부르지 않는가 ─────────────
   실측 사고: V33.195 가 사이드바 렌더러의 has() 를 두뇌관측 렌더러(NNV_render)에 그대로
   갖다 썼다. 두 렌더러는 서로 다른 스코프라 has 는 그 자리에 존재하지 않는다.
   런타임에 ReferenceError → then() 안이라 프로미스 거부 → openNnViz 의 catch 가
   ★"엔진이 응답하지 않습니다"★ 를 띄웠다. ★그동안 서버는 HTTP 200 을 0.96초에 정상
   반환하고 있었다★(엔드포인트 실측). 화면이 엉뚱한 곳을 탓해 원인을 서버에서 찾게 만들었다.
   문법 검사로는 절대 안 잡힌다 — 호출 자체는 문법적으로 완전히 정상이다. */
console.log("\n⑨ 렌더러 스코프 — 도우미가 그 자리에 있는가");
{
  let sbad = 0;
  const sok = (m) => console.log("  ok   " + m);
  const sbd = (m) => { sbad++; console.error("  FAIL " + m); };
  const hv9 = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const HELPERS = ["has", "pct", "esc", "chip", "n0", "col", "ico"];
  const SCOPES = [["두뇌관측(NNV)", "window.openNnViz", "// [V12 재디자인] 전 층 가시화"]];
  for (const [nm, a, b] of SCOPES) {
    const i0 = hv9.indexOf(a), i1 = hv9.indexOf(b, i0);
    if (i0 < 0 || i1 < 0) { sbd(nm + " 스코프를 찾지 못했다 — 표식이 바뀌었으면 이 게이트도 함께 고칠 것"); continue; }
    const seg = hv9.slice(i0, i1);
    const declared = new Set();
    for (const m of (seg.match(/function\s+([A-Za-z_$][\w$]*)\s*\(/g) || []))
      declared.add(m.replace(/function\s+/, "").replace(/\s*\($/, ""));
    for (const m of (seg.match(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*function/g) || []))
      declared.add(m.replace(/\b(?:var|let|const)\s+/, "").replace(/\s*=\s*function$/, ""));
    let miss = 0;
    for (const h of HELPERS) {
      const used = new RegExp("[^\\w$.]" + h + "\\s*\\(").test(seg);
      if (used && !declared.has(h)) { sbd(nm + " 이 " + h + "() 를 쓰는데 그 스코프에 선언이 없다 — 런타임 ReferenceError"); miss++; }
    }
    if (!miss) sok(nm + " 스코프가 쓰는 도우미가 전부 그 안에 선언돼 있다 (" + [...declared].filter((d) => HELPERS.includes(d)).join(", ") + ")");
  }
  // catch 문구가 원인을 단정하면 안 된다 — 통신 실패와 렌더 예외 둘 다 이 catch 로 온다.
  if (/화면을 그리는 중 오류가 났습니다\(엔진은 응답했습니다\)/.test(hv9))
    sok("조회 실패 문구가 통신 실패와 렌더 오류를 구분해 적는다");
  else sbd("조회 실패를 무조건 '엔진이 응답하지 않습니다' 로 적는다 — 원인을 엉뚱한 곳으로 돌린다");
  rtBad += sbad;
}

process.exit((bad + rtBad) ? 1 : 0);
