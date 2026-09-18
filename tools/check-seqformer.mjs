/* ═══════════════════════════════════════════════════════════════════════════
   [V33.267] SEQ — Transformer 인코더. 요청은 "DNN 을 Transformer 로 승급".

   ■ 왜 할 수 있었나
     표본이 이미 (종목, 시각)을 갖고 있어서, 트레이너가 같은 종목의 과거 표본을
     시간순으로 쌓으면 [L,D] 시퀀스가 나온다. ★익스포트도 워커도 안 고친다.★

   ■ 비용은 문제가 아니었다 — 재보고 정했다
     L=16·d=32·1층·2헤드 = 종목당 곱셈 약 19만 회.
     현행 DNN 은 763,345 파라미터 × 6시드 = 460만 회. ★25배 싸다.★

   ■ 진짜 위험은 ★학습·추론 불일치★ 다
     이 저장소가 반복해 당한 자리다(V32.11 BatchNorm 접기가 그 흔적).
     그래서 이 검사는 성능을 묻지 않는다 — ★워커 JS 가 정말 그 수식인가★ 만 묻는다.
     numpy 로 같은 수식을 독립 구현해 무작위 가중치로 대조한다. 두 구현이 우연히
     같은 값을 낼 확률은 없다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const code = S.split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

// ── 무작위 모델 생성(재현 가능한 시드)
let _s = 12345;
const rnd = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff * 2 - 1; };
const mat = (r, c) => Array.from({ length: r }, () => Array.from({ length: c }, () => rnd() * 0.5));
const vec = (n, f) => Array.from({ length: n }, () => (f == null ? rnd() * 0.5 : f));
const D = 12, d = 8, L = 5, Hh = 2;
const model = {
  featVer: 1, L, D, d, heads: Hh,
  mean: vec(D), std: vec(D).map(v => Math.abs(v) + 0.5),
  Win: mat(d, D), bin: vec(d), pos: mat(L, d),
  ln1g: vec(d, 1).map(() => 1 + rnd() * 0.2), ln1b: vec(d),
  Wq: mat(d, d), bq: vec(d), Wk: mat(d, d), bk: vec(d),
  Wv: mat(d, d), bv: vec(d), Wo: mat(d, d), bo: vec(d),
  ln2g: vec(d).map(v => 1 + v * 0.2), ln2b: vec(d),
  W1: mat(d * 4, d), b1: vec(d * 4), W2: mat(d, d * 4), b2: vec(d),
  lng: vec(d).map(v => 1 + v * 0.2), lnb: vec(d),
  Wh: vec(d), bh: rnd()
};
const seq = Array.from({ length: L }, () => Array.from({ length: D }, () => rnd() * 3));

console.log("① 워커 JS 가 정말 그 수식인가 — numpy 독립구현과 대조");
{
  const js = M.seqFormerScore(model, seq);
  chk(js != null && isFinite(js) && js > 0 && js < 1, "워커 추론이 확률을 낸다: " + (js == null ? "null" : js.toFixed(8)),
    "워커 추론이 값을 못 낸다: " + js);

  const shim = `
import sys, json, math
import numpy as np
inp = json.load(sys.stdin); m = inp["m"]; seq = np.array(inp["seq"], dtype=np.float64)
L=m["L"]; D=m["D"]; d=m["d"]; H=m["heads"]; dh=d//H
A=lambda k: np.array(m[k], dtype=np.float64)
def ln(v,g,b):
    mu=v.mean(); s=((v-mu)**2).mean()
    return (v-mu)/math.sqrt(s+1e-5)*g+b
z=np.clip((seq-A("mean"))/np.where(A("std")>1e-9,A("std"),1.0),-6,6)
Hm=z@A("Win").T+A("bin")+A("pos")
a=np.stack([ln(Hm[t],A("ln1g"),A("ln1b")) for t in range(L)])
q=a@A("Wq").T+A("bq"); k=a@A("Wk").T+A("bk"); v=a@A("Wv").T+A("bv")
ctx=np.zeros((L,d))
for h in range(H):
    o=h*dh
    sc=(q[:,o:o+dh]@k[:,o:o+dh].T)/math.sqrt(dh)
    e=np.exp(sc-sc.max(axis=1,keepdims=True)); w=e/e.sum(axis=1,keepdims=True)
    ctx[:,o:o+dh]=w@v[:,o:o+dh]
Hm=Hm+(ctx@A("Wo").T+A("bo"))
b2=np.stack([ln(Hm[t],A("ln2g"),A("ln2b")) for t in range(L)])
Hm=Hm+(np.maximum(b2@A("W1").T+A("b1"),0)@A("W2").T+A("b2"))
last=ln(Hm[L-1],A("lng"),A("lnb"))
zz=float(last@A("Wh")+m["bh"])
print(json.dumps({"p": 1/(1+math.exp(-zz))}))
`;
  let ref;
  try { ref = JSON.parse(execFileSync("python3", ["-c", shim], { input: JSON.stringify({ m: model, seq }), encoding: "utf8" })); }
  catch (e) { console.log("  FAIL numpy 참조 실행 실패(그러면 대조할 수 없다): " + String(e.message).slice(0, 160)); fails++; ref = null; }
  if (ref) {
    const diff = Math.abs(js - ref.p);
    chk(diff < 1e-9, "numpy 독립구현과 일치 — JS " + js.toFixed(10) + " vs numpy " + ref.p.toFixed(10) + " (오차 " + diff.toExponential(1) + ")",
      "★두 구현이 다르다★ JS " + js + " vs numpy " + ref.p + " (오차 " + diff.toExponential(2) + ") — 배포하면 트레이너와 다른 모델이 된다");
  }
}

console.log("\n② 각 부품이 실제로 결과를 바꾸는가 (죽은 배선이 아닌가)");
{
  const base = M.seqFormerScore(model, seq);
  const tweak = (k, f) => { const c = JSON.parse(JSON.stringify(model)); f(c); return M.seqFormerScore(c, seq); };
  const parts = [
    ["pos(위치임베딩)", (c) => { c.pos = c.pos.map(r => r.map(() => 0)); }],
    ["Wq(질의)", (c) => { c.Wq = c.Wq.map(r => r.map(() => 0)); }],
    ["Wv(값)", (c) => { c.Wv = c.Wv.map(r => r.map(() => 0)); }],
    ["Wo(출력사영)", (c) => { c.Wo = c.Wo.map(r => r.map(() => 0)); }],
    ["W1(FFN)", (c) => { c.W1 = c.W1.map(r => r.map(() => 0)); }],
    ["ln1(노름)", (c) => { c.ln1g = c.ln1g.map(() => 1); c.ln1b = c.ln1b.map(() => 0); }],
    ["mean/std(표준화)", (c) => { c.mean = c.mean.map(() => 0); c.std = c.std.map(() => 1); }]
  ];
  let dead = [];
  for (const [name, f] of parts) { const v = tweak(name, f); if (v == null || Math.abs(v - base) < 1e-12) dead.push(name); }
  chk(dead.length === 0, "부품 " + parts.length + "종이 전부 결과에 영향을 준다",
    "결과를 안 바꾸는 부품(배선이 죽었다): " + dead.join(", "));
}

console.log("\n③ 시퀀스를 정말 시퀀스로 읽는가");
{
  const p1 = M.seqFormerScore(model, seq);
  const rev = seq.slice().reverse();
  chk(Math.abs(M.seqFormerScore(model, rev) - p1) > 1e-9,
    "순서를 뒤집으면 값이 달라진다 — 시간 구조를 실제로 쓴다",
    "★순서를 뒤집어도 같다 — 시퀀스 모델이 아니라 집계기다★(위치임베딩·마지막시점 읽기 확인)");
  // 마지막 시점만 읽는가 — 맨 앞 행만 바꿔도 어텐션 때문에 값은 변하지만, 맨 뒤를 바꾸면 더 크게 변해야 한다
  const chgFirst = seq.map((r, i) => i === 0 ? r.map(v => v + 5) : r);
  const chgLast = seq.map((r, i) => i === L - 1 ? r.map(v => v + 5) : r);
  const dF = Math.abs(M.seqFormerScore(model, chgFirst) - p1);
  const dL = Math.abs(M.seqFormerScore(model, chgLast) - p1);
  chk(dL > dF, "마지막 시점 변화(" + dL.toExponential(1) + ")가 첫 시점(" + dF.toExponential(1) + ")보다 크게 반영된다",
    "마지막 시점이 더 중요하게 반영되지 않는다 — 예측 시점을 읽는 구조가 아니다");
  // 짧은 시퀀스는 가장 오래된 행으로 채운다(0 으로 채우면 없는 과거를 지어낸다)
  const short = seq.slice(L - 2);
  chk(M.seqFormerScore(model, short) != null, "짧은 시퀀스도 예외 없이 처리한다(앞을 최고참 행으로 채움)",
    "짧은 시퀀스에서 null");
}

console.log("\n④ 승격은 정합을 통과해야만 — 성적이 좋아도 다른 모델이면 안 받는다");
{
  const ep = code.slice(code.indexOf('path === "/api/seq-import"'), code.indexOf('path === "/api/seq-import"') + 5200);
  chk(/if \(maxDiff == null\)/.test(ep) && /probe 없음/.test(S),
    "probe 가 없으면 거부한다(정합을 확인할 수 없으면 승격 없음)", "probe 없이도 저장한다");
  chk(/if \(maxDiff > _num\(SEQML\.probeTol, 0\.03\)\)/.test(ep),
    "정합 오차가 허용치를 넘으면 ★저장 자체를 거부★ 한다", "정합 실패 모델을 저장한다");
  /* [V33.292] 인자에 무실력 기준점이 붙었다. 계약은 "DNN 과 같은 함수로 판정한다" 다. */
  chk(/const ad = _dnnAdmit\(lb, icT, 0\.5/.test(ep),
    "승격 판정은 DNN 과 ★같은 자★ 를 쓴다(정확도 길 · IC 길)", "별도 판정 기준을 만들었다 — 자가 갈라진다");
  chk(/shapeErr/.test(ep) && /형상 불일치/.test(S),
    "형상 검사 — 잘못된 구조는 매 종목 null 을 뱉는 조용한 무력화가 된다", "형상 검사가 없다");
  chk(/featVer 불일치/.test(ep), "판 불일치 거부", "옛 판 모델을 받는다");
}

console.log("\n⑤ 트레이너가 워커와 같은 순서로 계산하는가");
{
  const PY = readFileSync(new URL("../trainer/modal/modal_train.py", import.meta.url), "utf8");
  const py = PY.split("\n").filter(l => !/^\s*#/.test(l)).join("\n");
  /* ★쓰지 않는다는 것을 '언급' 과 '사용' 으로 가른다.★ 처음엔 이름만 찾았는데,
     트레이너 독스트링에 "nn.TransformerEncoderLayer 를 쓰지 않는다" 라고 적어둔
     그 문장에 걸려 실패했다. #주석은 걸렀지만 독스트링은 안 걸러졌다.
     세어야 할 것은 이름이 아니라 ★호출★ 이다 — 뒤에 여는 괄호가 붙는가. */
  chk(!/nn\.(TransformerEncoderLayer|MultiheadAttention|TransformerEncoder)\s*\(/.test(py),
    "고수준 트랜스포머 모듈을 ★호출하지★ 않는다(내부 규약 역추적 금지)",
    "★고수준 모듈을 호출한다 — 내부 규약이 워커 JS 와 어긋나도 알 수 없다★");
  chk(/h = self\.win\(x\) \+ self\.pos/.test(py), "입력사영 + 위치 순서가 워커와 같다", "입력 단계 순서가 다르다");
  chk(/h = h \+ self\.o\(ctx\)/.test(py) && /h = h \+ self\.f2\(torch\.relu\(self\.f1\(self\.ln2\(h\)\)\)\)/.test(py),
    "프리노름 잔차 구조가 워커와 같다(LN→attn→+ , LN→FFN→+)", "잔차/노름 위치가 워커와 다르다");
  chk(/for blk in self\.blocks:/.test(py) && /h = blk\(h\)/.test(py),
    "블록을 N개 쌓는다(층을 늘리면 실제로 반복한다)", "블록이 하나로 고정돼 있다 — 층 설정이 무의미하다");
  chk(/"blocks": blocks/.test(py) && /for bk_ in net\.blocks\]/.test(py) && /"layers": len\(blocks\)/.test(py),
    "블록 전부를 내보내고 층 수도 함께 적는다", "일부 블록만 내보내거나 층 수를 안 적는다");
  /* ★소스만 보고는 부족하다.★ net.blocks[:1] 같은 변이는 위 정규식을 그대로 통과할 수 있다.
     서버가 ★적힌 층 수와 실제 블록 수가 다르면 거부★ 하는지를 함께 못 박는다 —
     그러면 반쪽 모델은 소스가 어떻게 생겼든 저장되지 않는다. */
  chk(/_declL != null && _declL !== _blks\.length/.test(code) && /층 수 불일치/.test(S),
    "★적힌 층 수 ≠ 실제 블록 수★ 면 업로드를 거부한다(반쪽 모델이 조용히 앉지 않는다)",
    "층 수와 블록 수가 달라도 저장한다 — 워커가 반쪽 모델을 돌리게 된다");
  chk(/self\.head\(self\.lnf\(h\[:, -1, :\]\)\)/.test(py), "마지막 시점만 읽는다(워커와 동일)", "풀링 방식이 워커와 다르다");
  chk(/np\.lexsort\(\(TS, SYM\)\)/.test(py), "시퀀스를 종목→시각 순으로 쌓는다", "정렬 기준이 없다 — 시간이 섞인다");
  chk(/win = np\.concatenate\(\[np\.full\(L - len\(win\), win\[0\]/.test(py),
    "짧으면 가장 오래된 행으로 채운다(워커와 같은 규칙)", "패딩 규칙이 워커와 다르다 — 짧은 시퀀스에서 값이 갈린다");
  chk(/mean = X\[_tri\]\.mean/.test(py),
    "표준화 통계를 ★학습 구간에서만★ 구한다", "검증 구간이 표준화에 샌다 — 그만큼 낙관적으로 나온다");
}

console.log("\n⑥ ★저장만 하고 아무도 안 읽으면 그건 모델이 아니라 로그다★ — 읽는 쪽 배선");
{
  /* ①-a ★소스를 읽지 않고 위원회를 직접 돌린다.★
     처음엔 experts.push({name:"seq" 라는 문장을 찾았는데, 그 앞에 if(false) 를
     붙이는 변이가 통과했다 — 이 저장소에서 반복해 당한 자리다(주석·죽은코드 매칭).
     세어야 할 것은 문장이 아니라 ★결과★ 다: 돌려서 experts 에 seq 가 들어오는가.
     DB 스텁은 prepare 에서 던진다 — getState 류는 전부 try/catch 라 기본값으로 떨어지고,
     그래서 다른 위원은 아무도 참여하지 않는다(SEQ 표만 남는다). */
  const stubDB = { prepare() { throw new Error("검사용 스텁 — 상태 없음"); } };
  const FD = M.LUXML.featNames.length;
  const bigSeq = Array.from({ length: model.L }, () => Array.from({ length: FD }, () => rnd() * 2));
  const bigModel = Object.assign({}, model, {
    D: FD, featVer: M.LUXML.featVer, trusted: true, w: 0.3, valAccLB: 0.52, admitPath: "acc",
    mean: vec(FD), std: vec(FD).map(v => Math.abs(v) + 0.5), Win: mat(model.d, FD)
  });
  const runCommittee = async (opts) => {
    try {
      return await M.mlDeepDecide(stubDB, new Array(FD).fill(0.1), Object.assign({
        guard: null, mind: null, trust: null, gbdtTrust: null, boosters: [], dnn: null, gbdt: null,
        cal: null, evstats: null
      }, opts));
    } catch (e) { return { _threw: String(e && e.message) }; }
  };
  const withSeq = await runCommittee({ seqModel: bigModel, seqFeat: bigSeq });
  const noSeq = await runCommittee({ seqModel: bigModel, seqFeat: null });
  /* ★진짜 위험한 건 '없음' 이 아니라 '망가짐' 이다.★ 없으면 조립기가 null 을 주고 끝이지만,
     폭이 틀린 시퀀스는 그럴듯하게 생겼다 — 그걸 채점하면 아무 숫자나 나온다. */
  const badSeq = await runCommittee({ seqModel: bigModel, seqFeat: [[1, 2, 3], [4, 5, 6]] });
  const names = (r) => ((r && Array.isArray(r.experts)) ? r.experts.map(e => e.name) : []);
  chk(names(withSeq).includes("seq"),
    "★위원회를 실제로 돌리면★ 명부에 seq 표가 들어온다 (" + JSON.stringify(names(withSeq)) + ")",
    "돌려 보니 seq 표가 없다 — 배선이 죽어 있다: " + JSON.stringify(withSeq && withSeq._threw ? withSeq._threw : names(withSeq)));
  chk(!names(noSeq).includes("seq"),
    "시퀀스를 못 만든 종목에서는 ★조용히 불참★ 한다(반쪽 입력으로 억지 투표 없음)",
    "시퀀스가 없는데도 seq 가 투표한다");
  chk(!names(badSeq).includes("seq"),
    "폭이 틀린 시퀀스는 채점하지 않는다(그럴듯한 쓰레기 표가 안 들어간다)",
    "★폭이 틀린 시퀀스로도 투표한다 — 아무 숫자나 위원회에 들어간다★");
  {
    const flat = Object.assign({}, bigModel, { Wh: vec(model.d, 0), bh: 0 });  // 항상 p=0.5 를 내는 모델
    const r = await runCommittee({ seqModel: flat, seqFeat: bigSeq });
    chk(!names(r).includes("seq"),
      "확률이 0.5 에 붙어 있으면(정보 0) 표를 넣지 않는다", "정보가 없는 0.5 표를 위원회에 넣는다");
  }
  chk(/const pS = seqFormerScore\(sm, opts\.seqFeat\)/.test(code),
    "채점은 워커 추론기(seqFormerScore) 그 함수를 쓴다", "다른 경로로 채점한다 — 정합 probe 가 지키는 함수가 아니다");
  // ①-b 읽는 쪽 승격 게이트 — V33.191 에서 부스터로 겪은 자리다
  const rd = code.slice(code.indexOf("async function _seqCached"), code.indexOf("async function _seqCached") + 1800);
  chk(/getState\(DB, "seq_trust"/.test(rd) && /t\.trusted && _num\(t\.wSeq, 0\) > 0/.test(rd),
    "읽는 쪽에도 승격 게이트가 있다(저장 시점 판정만 믿지 않는다)", "읽는 쪽 게이트가 없다 — 이미 앉아 있는 모델이 그대로 투표한다");
  chk(rd.indexOf('getState(DB, "seq_trust"') < rd.indexOf('getBigState(DB, "seq_model"'),
    "작은 레코드로 먼저 거른다(승격 못 한 모델 때문에 수백 KB 를 매번 읽지 않는다)",
    "게이트보다 큰 모델을 먼저 읽는다");
  // ①-c 라이브 호출부 배선
  chk(/seqFeat: __seqFeat, seqModel: __seqModel/.test(code),
    "라이브 결정 호출부가 시퀀스와 모델을 함께 넘긴다", "호출부 배선이 없다 — 위원회 코드가 영원히 안 돌아간다");
  chk(/if \(__seqModel && _enrich\.seqMs < _num\(SEQML\.maxCycleBudgetMs/.test(code),
    "★승격된 모델이 있을 때만★, 그리고 사이클 총량 안에서만 시퀀스를 굽는다",
    "모델 유무·사이클 예산과 무관하게 시퀀스를 만든다 — 순수 낭비이거나 사이클을 먹는다");
  /* ★상한이 실측보다 낮으면 그건 방어가 아니라 조용한 무력화다.★
     실측 3.0ms(320봉·L16) 대비 여유가 없으면 워커가 조금만 느려도 전 종목이 기권하고,
     모델은 있는데 표는 영원히 0 이 된다 — 이 저장소가 반복해 당한 자리다. */
  chk(M.SEQML.maxSeqBudgetMs >= 20,
    `종목당 상한 ${M.SEQML.maxSeqBudgetMs}ms 는 실측(약 3ms)의 여러 배다`,
    `종목당 상한 ${M.SEQML.maxSeqBudgetMs}ms 가 실측(약 3ms)에 너무 붙어 있다 — 워커가 조금만 느려도 전 종목이 기권한다`);
  chk(/_enrich\.seqBuilt \+ "종목 "/.test(code) && /기권 " \+ _enrich\.seqSkip/.test(code),
    "사이클 로그에 SEQ 조립 건수·기권 건수가 남는다(0건이면 눈에 띈다)",
    "★조립 건수가 로그에 안 남는다 — SEQ 가 한 번도 안 돌아도 아무도 못 알아챈다★");
}

console.log("\n⑦ 시퀀스 조립이 정말 '그 봉' 을 담는가 — 순서·정렬·예산");
{
  const D = M.LUXML.featNames.length;
  const iDay = M.LUXML.featNames.indexOf("dayPct");
  if (iDay < 0) { console.log("  FAIL dayPct 피처가 사라졌다 — 이 검사의 기준점이 없다"); fails++; }
  const n = 200, L = 8;
  // 지그재그 종가 — 봉마다 dayPct 가 서로 다르게 나오도록(오프바이원이 숨을 곳을 없앤다)
  const closes = Array.from({ length: n }, (_, i) => 100 + i * 0.7 + (i % 3) * 1.9 + (i % 7) * 0.4);
  const arr = (f) => closes.map((c, i) => f(c, i));
  const days = Array.from({ length: n }, (_, i) => 20000 + i);
  const base = { closes, volumes: arr((c, i) => 1e6 + i * 1000), opens: arr((c) => c * 0.995),
                 highs: arr((c) => c * 1.01), lows: arr((c) => c * 0.99), days,
                 idxCloses: null, sectorCloses: null, xsPanel: null, regime: "BULL", market: "us" };
  const live = new Array(D).fill(-999);
  const seq = M.seqBuildFeat(base, live, L, 5000);
  chk(Array.isArray(seq) && seq.length === L, `길이 L(${L})짜리 시퀀스를 만든다`, "시퀀스를 못 만든다");
  if (Array.isArray(seq) && seq.length === L) {
    chk(seq[L - 1] === live,
      "★마지막 자리는 이미 만들어 둔 라이브 벡터 그 자체★ (다시 구우면 다른 위원과 다른 입력을 본다)",
      "마지막 자리가 라이브 벡터가 아니다 — 위원마다 다른 입력을 본다");
    // 각 자리가 정확히 '끝에서 k 봉 전' 인지 dayPct 로 못 박는다
    let mism = 0;
    for (let t = 0; t < L - 1; t++) {
      const k = L - 1 - t, e = n - k;
      const want = (closes[e - 2] > 0) ? (closes[e - 1] / closes[e - 2] - 1) * 100 : 0;
      if (Math.abs(seq[t][iDay] - want) > 1e-9) mism++;
    }
    chk(mism === 0, "자리 t 가 정확히 '끝에서 L−1−t 봉 전' 을 담는다(순서·오프바이원 고정)",
      `자리와 봉이 어긋난다 (${mism}/${L - 1}자리) — 시간순이 뒤집혔거나 한 봉씩 밀렸다`);
    const uniq = new Set(seq.slice(0, L - 1).map((r) => r[iDay].toFixed(9)));
    chk(uniq.size === L - 1, "자리마다 서로 다른 봉이다(같은 값을 L 번 복사하지 않는다)",
      "여러 자리가 같은 봉을 담고 있다 — 시퀀스가 아니라 복사본이다");
  }
  // 예산 초과 시 ★반쪽 시퀀스를 넘기지 않는다★
  chk(M.seqBuildFeat(base, live, L, -1) === null,
    "시간 예산을 넘기면 그 종목은 기권한다(반쪽 시퀀스로 억지 투표를 시키지 않는다)",
    "예산을 넘겨도 반쪽 시퀀스를 넘긴다 — 그 표는 잡음이다");
  // 이력이 모자라면 아예 시작하지 않는다
  chk(M.seqBuildFeat(Object.assign({}, base, { closes: closes.slice(0, 20) }), live, L, 5000) === null,
    "이력이 모자라면 시작하지 않는다", "짧은 이력으로도 피처를 만든다 — 룩백이 없는 값이 실린다");
  // 달력은 ★진짜 봉 날짜★ 로 — 날짜를 빼서 때우면 15봉 전이 6일쯤 어긋난다
  chk(/obsTs: days \? _num\(days\[e - 1\], 0\) \* 86400000 : null/.test(code),
    "과거 자리의 달력 피처는 봉별 실제 날짜에서 나온다(없으면 '모른다')",
    "달력 입력을 날짜 빼기로 지어낸다 — 학습 때 붙은 달력과 다른 값이 실린다");
  const iF = M.LUXML.featNames.indexOf("fomcKnown");
  if (iF >= 0 && Array.isArray(seq)) {
    const noDays = M.seqBuildFeat(Object.assign({}, base, { days: null }), live, L, 5000);
    chk(noDays && noDays[0][iF] === 0 && seq[0][iF] === 1,
      "날짜가 없으면 달력을 '모른다'(0)로 두고, 있으면 실제로 채운다",
      "날짜 유무가 달력 피처에 반영되지 않는다");
  }
}

console.log("\n⑧ 화면이 '왜 SEQ 가 안 실리는지' 를 말할 수 있는가");
{
  chk(/committee(C)?\.push\(_sr\)/.test(code), "위원 명단에 SEQ 줄이 들어간다", "명단에 SEQ 가 없다 — 왜 없는지 물어볼 단서가 화면에 안 남는다");
  const row = M._seqRosterRow({ trusted: true, wSeq: 0.3, seqAccLB: 0.52, L: 16, d: 32, heads: 2,
                                admitPath: "ic", featVer: M.LUXML.featVer, probeMaxDiff: 0.001 });
  chk(row && row.trusted === true && row.w === 0.3 && /IC 경로 잠정/.test(row.role),
    "IC 경로로 들어온 위원은 화면에 '잠정' 으로 적힌다", "잠정 합류를 정식과 같게 적는다");
  const stale = M._seqRosterRow({ trusted: true, wSeq: 0.3, seqAccLB: 0.52, featVer: M.LUXML.featVer - 1 });
  chk(stale && stale.trusted === false && stale.w === 0,
    "옛 판 모델은 명단에 남되 ★안 실린다고★ 적는다(조용히 사라지지 않는다)",
    "옛 판 모델을 실리는 것처럼 적는다");
  chk(M._seqRosterRow(null) === null, "레코드가 없으면 줄을 지어내지 않는다", "없는 위원을 명단에 적는다");
}

console.log("\n⑨ 트레이너 본류가 실제로 이 학습을 부르는가");
{
  const PY2 = readFileSync(new URL("../trainer/modal/modal_train.py", import.meta.url), "utf8");
  const py2 = PY2.split("\n").filter(l => !/^\s*#/.test(l)).join("\n");
  chk(/_train_and_upload_seq\(BASE, KEY, HDR, X, Y, TS, SYM, featver, D, UNIQ, cfg\)/.test(py2),
    "본류가 SEQ 학습을 호출한다(정의만 해 두면 영원히 안 돈다)", "정의만 있고 아무도 안 부른다");
  chk(/enabled: !!SEQML\.enabled, L: SEQML\.L, d: SEQML\.d, heads: SEQML\.heads,[\s\S]{0,60}layers: SEQML\.layers/.test(code),
    "형상(층 포함)은 워커가 내려준다 — 두 곳에 따로 적으면 언젠가 갈라진다", "트레이너가 형상을 스스로 정한다");
}

console.log("\n⑩ ★용량을 말로 정하지 않는다★ — 재서 정하는 고리가 있는가");
{
  const PY3 = readFileSync(new URL("../trainer/modal/modal_train.py", import.meta.url), "utf8");
  const py3 = PY3.split("\n").filter(l => !/^\s*#/.test(l)).join("\n");
  chk(/def fit_seq\(dm_, Hh_, nl_/.test(py3) && /for \(cd, ch, cl\) in cands/.test(py3),
    "후보 구성들을 ★같은 표본·같은 분할★ 로 학습해 겨룬다", "구성이 하나뿐이다 — 크기를 고른 근거가 없다");
  // [V33.388] 자만 같으면 되는 게 아니었다 — 종전엔 ★검증행★ 하한(r_[0])으로 후보를 고르고
  //   그 값을 그대로 승격 점수로 올렸다(고른 자로 채점). 자(유효표본 Wilson 하한)는 그대로 두고
  //   ★행만★ 보정구간으로 옮긴다(r_[5] = lbs_). 검증행은 채점에만 쓴다.
  chk(!/if best is None or r_\[0\] > best\[0\]/.test(py3),
    "승자를 ★검증행★ 하한으로 고르지 않는다", "검증행으로 고르고 그 검증행으로 채점한다 — 점수가 부푼다");
  chk(/if best is None or r_\[5\] > best\[5\]/.test(py3),
    "이기는 기준은 ★유효표본 Wilson 하한 × 보정행★ (워커 승격 게이트와 같은 자·다른 행)", "다른 자로 이긴 걸 고른다");
  chk(/lbs_, _ = _lb\(_infer\(ca\), yca, neffc\)/.test(py3),
    "선택근거(lbs_)가 ★보정구간 예측★ 에서 나온다", "이름만 바꾸고 검증행을 담았다");
  chk(/cal_frac=0\.10,\s*tag="SEQ"/.test(PY3),
    "SEQ 분할이 보정구간을 실제로 뗀다(cal_frac)", "보정구간이 비어 전부 검증으로 떨어진다");
  chk(/★검증\(보정구간 \{len\(_cali\)\}건으로 모자라다 — 이 회차 SEQ 점수는 부풀어 있다\)★/.test(PY3),
    "보정구간이 모자라면 ★부풀었다고 말한다★", "조용히 검증행으로 떨어진다");
  chk(/api\/seq-arch/.test(py3), "이긴 구성을 서버로 되돌려 준다(측정이 버려지지 않는다)", "측정하고 버린다 — V33.204 에서 그랬다");
  const ep = code.slice(code.indexOf('path === "/api/seq-arch"'), code.indexOf('path === "/api/seq-arch"') + 2600);
  /* ★메시지 문자열을 찾으면 안 된다.★ if 를 죽여도 문구는 남아 통과한다(그 변이가 실제로
     통과했다). 세어야 할 것은 ★비교식★ 이다 — 보내온 d/heads/layers 가 표의 1등과 같은가. */
  chk(/if\(!top\|\|Math\.floor\(_num\(top\.d,0\)\)!==dW\|\|Math\.floor\(_num\(top\.heads,0\)\)!==hW\|\|Math\.floor\(_num\(top\.layers,0\)\)!==lW\)/.test(ep.replace(/\s/g, "")),
    "저장 전에 ★승자가 정말 표의 1등인지★ 비교한다", "보내온 값을 그대로 앉힌다 — 근거 없는 형상이 다음 학습을 정한다");
  chk(/featVer 불일치/.test(ep), "판이 다르면 안 받는다(옛 판에서 잰 용량은 다른 문제의 답이다)", "판을 안 본다");
  chk(/_num\(_sa\.featVer, -1\) === LUXML\.featVer/.test(code),
    "내려줄 때도 판을 다시 본다", "저장된 값을 판 확인 없이 내려준다");
  chk(/seq: Object\.assign\(/.test(code) && /arch && arch\.seq/.test(code),
    "측정이 있으면 측정을, 없으면 기본값을 내려준다", "측정 없이도 측정한 척한다");
}

console.log(fails === 0 ? "\n✓ SEQ Transformer 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
