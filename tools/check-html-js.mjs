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
        partial: [{ aiReady:true, phase:{us:'RANGE'}, scalp:{}, samples:{}, committee:{} }, []],
        full:    [{ aiReady:true,
          phase:{us:'TREND_UP',kr:'MELTUP',dayUs:1.2,dayKr:11.7,r5Us:0.4,r5Kr:6,erUs:0.1,erKr:0.2,ts:Date.now()},
          xmkt:{semi1d:-3.2,semi5d:-8.1},
          sectors:{TECH:{etf:'XLK',d1:-1.4,d5:-3.2}},
          scalp:{need:3000,collected:0,n:0,observed:412,observedToday:412,labeled:180,
                 pending:232,filesToday:0,store:'R2',live:true,trusted:false,trained:false,
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
               audit:{ok:false,checked:912,nIssues:3,issues:[{code:'QTY_MISMATCH',symbol:'us|NVDA',detail:'원장 10 vs 포지션 8'},{code:'LEDGER_NET_NEGATIVE',symbol:'kr|005930.KS',detail:'원장 순보유 -5'}]}},
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
               audit:{ok:true,checked:0,nIssues:0,issues:[]}},
          thr:{us:null, kr:{n:0,thr:null,fixed:0.55}} }, []],
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

process.exit((bad + rtBad) ? 1 : 0);
