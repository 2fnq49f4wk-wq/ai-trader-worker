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
    const okPartial = r2.j && r2.j.fetchErrors === 2
      && r2.j.mlStatus && r2.j.mlStatus.__error === "HTTP 500"
      && r2.j.pipeline && r2.j.pipeline.__error === "network down"
      && r2.j.aiMode && r2.j.aiMode.endpoint === "/api/ai-mode";
    if (okPartial) console.log("  ok   일부 실패해도 나머지는 수집되고 실패 사유가 파일에 남는다");
    else { wbad++; console.error("  FAIL 부분 실패 처리 이상: " + JSON.stringify(r2.j && { e: r2.j.fetchErrors, m: r2.j.mlStatus, p: r2.j.pipeline })); }
    if (r2.toasts.some((t) => /수집 실패/.test(t))) console.log("  ok   부분 실패를 사용자에게 알린다");
    else { wbad++; console.error("  FAIL 부분 실패인데 성공한 것처럼 알린다"); }
  }
  rtBad += wbad;
} catch (e) {
  console.error("  FAIL AI 운영상태 다운로드 검사 실패:", e.message);
  rtBad += 1;
}

process.exit((bad + rtBad) ? 1 : 0);
