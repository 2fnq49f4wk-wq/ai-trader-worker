// [V33.390] ★매수와 매도가 같은 위원회·같은 입력으로 판단하는가★
//
//   청산 호출부 주석은 "진입을 주도하는 위원회(GBDT/DNN/MIND)로 보유 포지션도 재평가" 였다.
//   그때 위원은 셋이었다. 그 뒤 위원회는 아홉이 됐고 ★그 호출만 안 따라왔다.★
//     · seqFeat·flowFeat·xaFeat 미전달 → SEQ·FLOW·XALPHA 는 청산 결정에 한 번도 참여 못 했다.
//       (피처가 없으면 조용히 불참한다 — 화면은 그동안 계속 "가동 중" 이라고 말했다)
//     · sectorCloses 미전달 → 미국 종목의 sectorRs20·sectorBeta 가 청산 때만 중립이었다.
//   즉 ★같은 종목·같은 순간에 진입과 매도가 다른 값을 봤다.★
//   이 게이트는 두 호출부의 인자 집합을 ★비교★ 한다 — 한쪽만 고쳐지는 날을 막는 장치다.
import fs from "node:fs";
const src = fs.readFileSync("src/index.js", "utf8");
let bad = 0;
const ok = (m) => console.log("  ok   " + m);
const no = (m) => { console.error("  FAIL " + m); bad++; };

// ── 호출부의 옵션 객체에서 키 집합을 뽑는다(괄호 균형으로 잘라 낸다 — 정규식 한 줄로는 못 센다)
function optKeys(fromIdx) {
  const i = src.indexOf("mlDeepDecide(", fromIdx);
  if (i < 0) return null;
  let depth = 0, j = src.indexOf("(", i);
  const start = j;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) break; }
  }
  const args = src.slice(start + 1, j);
  const b = args.indexOf("{");
  if (b < 0) return { keys: new Set(), at: i };
  const body = args.slice(b + 1, args.lastIndexOf("}"));
  const keys = new Set();
  let d2 = 0;
  for (const part of body.split(",")) {
    // 중첩 객체/호출 안의 콜론은 세지 않는다
    const m = part.match(/^\s*([A-Za-z_$][\w$]*)\s*:/);
    if (d2 === 0 && m) keys.add(m[1]);
    for (const ch of part) { if (ch === "{" || ch === "(") d2++; else if (ch === "}" || ch === ")") d2--; }
    if (d2 < 0) d2 = 0;
  }
  return { keys, at: i };
}

// 진입(전체 위원회)과 청산 — runTradingCycle 안의 두 호출을 찾는다.
const iCycle = src.indexOf("async function runTradingCycle(");
if (iCycle < 0) { no("위원회대칭: runTradingCycle 을 못 찾겠다"); }
else {
  const exit = optKeys(iCycle);                       // 첫 호출 = 청산(AI_EXIT)
  const entry = exit ? optKeys(exit.at + 20) : null;  // 그다음 = 진입
  if (!exit || !entry) no("위원회대칭: 매매 사이클 안의 mlDeepDecide 호출 두 곳을 못 찾겠다");
  else {
    // 청산 호출이 정말 청산인지 확인한다 — 순서만 믿으면 코드가 바뀔 때 조용히 엉뚱한 걸 비교한다.
    const around = src.slice(Math.max(0, exit.at - 6000), exit.at);   // 주석이 길어져도 문맥을 놓치지 않게 넉넉히
    if (!/committeeExit/.test(around)) no("위원회대칭: 첫 호출이 청산 경로가 아니다 — 비교 대상이 어긋났다");
    else ok("청산 호출부를 committeeExit 문맥으로 확인했다");

    /* ★위원의 참석 여부를 가르는 인자★ 는 반드시 양쪽에 다 있어야 한다.
       모델 인자(flowModel 등)는 없으면 DB 에서 채우지만, ★피처★ 는 폴백이 없다 —
       안 넘기면 그 위원은 그냥 불참한다. 그래서 피처가 핵심이다. */
    const MUST = ["seqFeat", "flowFeat", "xaFeat", "seqModel", "flowModel", "xaModel",
                  "stackModel", "memoModel", "dualBull", "dualBear", "shock", "evCtx",
                  "applyEventPrior", "market", "sym", "portStats", "techK", "finalCal"];
    const missing = MUST.filter((k) => entry.keys.has(k) && !exit.keys.has(k));
    if (missing.length)
      no("위원회대칭: 청산 호출에 " + missing.join("·") + " 가 없다 — 매수와 매도가 다른 위원회로 판단한다");
    else ok("청산 호출이 진입과 같은 위원 인자를 전부 넘긴다(" + MUST.length + "종)");

    const onlyExit = [...exit.keys].filter((k) => !entry.keys.has(k));
    if (onlyExit.length) no("위원회대칭: 청산에만 있는 인자 " + onlyExit.join("·") + " — 반대 방향의 비대칭이다");
    else ok("청산에만 있는 인자는 없다");
  }
}

// ── 피처 조립도 같아야 한다 — 위원이 같아도 입력이 다르면 다른 모델이다 ──────────
{
  const iX = src.indexOf("const _fx = mlBuildFeatures({");
  if (iX < 0) no("위원회대칭: 청산 경로의 피처 조립부를 못 찾겠다");
  else {
    const blk = src.slice(iX, src.indexOf("});", iX));
    if (!/sectorCloses:/.test(blk))
      no("위원회대칭: 청산 피처에 sectorCloses 가 없다 — 미국 종목의 섹터 상대강도 2종이 청산 때만 중립이 된다");
    else ok("청산 피처가 sectorCloses 를 넘긴다(진입과 같은 입력)");
    for (const k of ["idxCloses", "xsPanel", "barsAgo", "obsTs", "regime", "market"])
      if (!new RegExp(k + "\\s*:").test(blk)) no("위원회대칭: 청산 피처에 " + k + " 가 없다");
    ok("청산 피처가 진입과 같은 축(지수·횡단면·시점·국면·시장)을 넘긴다");
  }
}

// ── 빠진 위원의 사유가 ★기록★ 되는가 ────────────────────────────────────────
//   catch 가 비어 있으면 셋을 구분할 수 없다: 미승격 / 피처 없음 / 던짐.
{
  const i0 = src.indexOf("async function mlDeepDecide(");
  const i1 = src.indexOf("if (!experts.length) return null;", i0);
  const blk = i0 >= 0 && i1 >= 0 ? src.slice(i0, i1) : "";
  if (!blk) no("위원회대칭: 위원 조립부를 못 찾겠다");
  else {
    const silent = (blk.match(/catch \(e\) \{\}/g) || []).length;
    const named = (blk.match(/catch \(e\) \{ _skip\(/g) || []).length;
    if (named < 7) no(`위원회대칭: 위원 조립 catch 중 사유를 적는 것이 ${named}곳뿐이다 — 던져서 빠진 위원을 못 본다`);
    else ok(`위원 조립 catch ${named}곳이 사유를 적는다`);
    if (silent > 3) no(`위원회대칭: 조용한 catch 가 ${silent}곳 — 위원이 조용히 빠질 자리가 남아 있다`);
    else ok(`조용한 catch ${silent}곳(위원 합류와 무관한 캐시·진단 경로만)`);
    for (const nm of ["mind", "dnn", "gbdt", "boost", "seq", "flow", "xalpha", "memo", "rule"])
      if (!new RegExp('_skip\\("' + nm + '"').test(blk)) no("위원회대칭: " + nm + " 의 불참 사유를 안 적는다");
    ok("위원 9종 전부 불참 사유를 적는다");
    // ★피처 미제공★ 을 ★미승격★ 과 다른 말로 적는가 — 같은 말로 적으면 이번 버그를 또 못 본다.
    for (const nm of ["seq", "flow", "xalpha"])
      if (!new RegExp('_skip\\("' + nm + '", "[^"]*피처 미제공').test(blk))
        no("위원회대칭: " + nm + " 가 '피처 미제공' 을 따로 적지 않는다 — 호출부 누락을 미승격과 못 가른다");
    ok("피처 미제공(호출부 누락)을 미승격과 다른 사유로 적는다");
  }
}

// ── 결석 명부가 ★결정 결과에 실려 나가는가★ ─────────────────────────────────
{
  const n = (src.match(/experts: _expOut, absent: _absent/g) || []).length;
  if (n < 4) no(`위원회대칭: absent 를 싣는 반환이 ${n}곳뿐이다 — 기권 경로에서 결석이 사라진다`);
  else ok(`결정 반환 ${n}곳 전부가 결석 명부를 싣는다`);
  if (!/사유 미기록\(조립부가 이 자리를 안 지난다\)/.test(src))
    no("위원회대칭: 정원 대비 미참석자를 채워 넣지 않는다 — 빈칸을 '정상' 으로 읽게 된다");
  else ok("정원(STACK_SLOTS) 대비 빈칸도 사유로 채운다");
}

// ── 청산은 ★지갑을 열지 않는다★ ─────────────────────────────────────────────
//   보유 종목마다 매 사이클(1분) 도는 경로다. 여기서 네트워크를 타면 비용이 조용히 샌다.
{
  const iF = src.indexOf("if (FLOWML.enabled && __flowModel && __flowModel.trusted)");
  const blk = iF >= 0 ? src.slice(iF, iF + 400) : "";
  if (!blk) no("위원회대칭: 청산 경로의 FLOW 조립부를 못 찾겠다");
  else if (!/noFetch:\s*true/.test(blk))
    no("위원회대칭: 청산 FLOW 가 noFetch 가 아니다 — 보유 종목마다 매 사이클 네트워크를 탄다");
  else ok("청산 FLOW 는 캐시만 쓴다(noFetch) — 못 만들면 사유를 남기고 불참");
  if (!/_enrich\.seqMs < _num\(SEQML\.maxCycleBudgetMs/.test(src.slice(iF - 1200, iF)))
    no("위원회대칭: 청산 SEQ 가 사이클 예산을 안 본다 — 진입 쪽 SEQ 를 굶길 수 있다");
  else ok("청산 SEQ 가 진입과 같은 사이클 예산을 나눠 쓴다");
}

console.log(bad ? `\n위원회 대칭 게이트 실패 ${bad}건` : "\n위원회 대칭 게이트 통과");
process.exit(bad ? 1 : 0);
