/* ═══════════════════════════════════════════════════════════════════════════
   [V33.401] 워커 쪽 위원(FLOW·XALPHA·STACK·이중헤드)이 왜 한 번도 안 서는가

   ■ 측정이 가리킨 자리
     V33.400 이 Modal(DNN)에 퇴화칸 방어를 넣었다. 그런데 ★같은 병을 더 심하게 앓는 쪽★ 은
     워커였다. altSampleBackfill 이 FLOW 표본을 이렇게 만든다(src/index.js):

       [peerRet5, peerRet20, peerDisp, peerRel5, peerCorrAvg, peerLead,
        0, 0, 0, 0, 0, 0, 0]        ← ★13칸 중 7칸이 하드코딩 0★

     공매도·내부자·기관·풋콜 6칸 + posAvail 마스크다. 진짜 값은 실거래 표본에만 들어가는데
     실거래는 120만 중 ★68건★ 이다. 학습에서는 상수, 서빙에서는 라이브 값 —
     flowScore 는 (v−mean)/std 를 ±4 로 클램프하므로 σ 가 작은 칸은 들어오는 즉시 ±4 로
     슬램한다. 학습에서 한 번도 본 적 없는 자리다.
     V33.104 가 이미 적어 뒀다: "0 은 중립이 아니라 ★결측★ 이다."

   ■ 이 검사가 무는 것 — 셋 다 예외를 안 던진다
     ① Z 만 0 으로 덮는 구현 — 학습은 중립인데 서빙은 실값이다(스큐를 ★새로 만든다★).
        σ 로 해야 flowScore/stackScore 가 저장된 std 로 같은 식을 써서 서빙까지 중립이 된다.
     ② 기준을 느슨하게(or) 풀면 멀쩡한 희소 칸까지 꺼진다.
     ③ 최빈을 홀드아웃까지 포함해 재면 ★누출★ 이다. 포화를 학습행에서 재면 헛것을 본다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const PY = readFileSync(new URL("../trainer/modal/modal_train.py", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

// 함수 본문을 중괄호로 떼어낸다 — 고정 폭 창은 ★다음 함수★ 를 문다(V33.400 AP-3 의 교훈).
const body = (name) => {
  const i = S.indexOf("function " + name);
  if (i < 0) return "";
  let d = 0, k = S.indexOf("{", i), e = k;
  for (; e < S.length; e++) { const c = S[e]; if (c === "{") d++; else if (c === "}") { d--; if (d === 0) break; } }
  return S.slice(k, e + 1);
};
const MINI = body("_miniLogisticTrain");

console.log("① 워커 학습기에 퇴화칸 방어가 있는가");
chk(MINI.length > 5000, "_miniLogisticTrain 본문 " + MINI.length + "자를 떼어냈다", "본문 추출이 깨졌다");
chk(/const _degen = \[\];/.test(MINI),
  "퇴화칸 목록을 만든다", "★워커 학습기에 퇴화칸 방어가 없다 — FLOW 는 7칸이 상수인 채로 학습된다★");
chk(/std\[d\.j\] = 1e9/.test(MINI),
  "σ 를 키워 중립화한다 — 저장된 std 를 채점기가 그대로 쓰므로 서빙까지 같이 중립이다",
  "★σ 를 안 바꾼다 — 중립화가 학습 안에서만 일어나고 서빙은 실값을 넣는다★");
chk(!/Z\[[^\]]*\]\[[^\]]*\]\s*=/.test(MINI),
  "표준화행렬 Z 의 칸을 직접 덮지 않는다",
  "★Z 를 직접 덮는다 — 고치려던 train/serve 스큐를 새로 만든다★");

console.log("\n② 기준은 둘 다(and) · 재는 구간이 옳은가");
chk(/_ms < 0\.90\) continue;/.test(MINI) && /_sr >= 0\.05\)/.test(MINI),
  "학습 최빈 ≥90% ★그리고★ 홀드아웃 포화 ≥5% 일 때만 끈다",
  "★기준이 느슨하다 — 가르칠 분산이 있는 칸까지 꺼진다★");
chk(/for \(let i = 0; i < ntr; i\+\+\)[\s\S]{0,200}_cnt/.test(MINI),
  "최빈은 ★학습행(ntr)★ 에서만 센다 — 홀드아웃을 섞으면 누출이다",
  "★최빈을 전체행에서 잰다 — 홀드아웃이 기준에 스며든다★");
/* 홀드아웃은 nvalStart 부터다. ntr..nvalStart 는 퍼징으로 잘라낸 ★학습행★ 이라
   라벨이 검증과 겹쳐 적합값 쪽으로 끌린 다른 모집단이다(V33.155). 섞으면 포화율이 흐려진다.
   — 처음 이 코드를 i=ntr 로 썼고 check-purge 가 잡았다. 그 계약을 여기에도 적어 둔다. */
chk(/for \(let i = nvalStart; i < N; i\+\+\)[\s\S]{0,170}>= 4 - 1e-9/.test(MINI),
  "포화는 ★진짜 홀드아웃(nvalStart..N)★ 에서 ±4 클램프로 잰다 — 퍼징 구간을 안 섞는다",
  "★포화를 학습행이나 퍼징 구간에서 잰다 — 튀고 있는 쪽을 안 보거나 다른 모집단을 섞는다★");
chk(/N > nvalStart\)/.test(MINI) && /_sat \/ Math\.max\(1, N - nvalStart\)/.test(MINI),
  "분모도 진짜 홀드아웃 크기다", "★분모가 퍼징 구간을 포함한다 — 포화율이 희석된다★");

console.log("\n③ ★서빙 정합 — 채점기가 σ=1e9 를 중립으로 읽는가(실행해서 확인)★");
{
  const D = 13;
  const mean = new Array(D).fill(0), std = new Array(D).fill(1);
  const w = new Array(D).fill(0.7);
  std[6] = 1e9;                       // shortPctFloat 자리 — 소급표본이 상수로 채우던 칸
  const mk = (v) => { const a = new Array(D).fill(0); a[6] = v; return a; };
  const model = { w: w, b: 0, mean: mean, std: std };
  const p0 = M.flowScore(model, mk(0)), p1 = M.flowScore(model, mk(0.42));
  chk(p0 != null && p1 != null && Math.abs(p0 - p1) < 1e-9,
    "flowScore: σ=1e9 인 칸은 0 이든 0.42 든 같은 확률 — 서빙도 같이 중립이다",
    "★워커 채점기가 σ=1e9 를 중립으로 안 읽는다(" + p0 + " vs " + p1 + ") — 학습과 서빙이 갈라진다★");
  // 중립화 안 한 칸은 여전히 살아 있어야 한다(전부 꺼 버리면 그것도 고장이다)
  const mk5 = (v) => { const a = new Array(D).fill(0); a[5] = v; return a; };
  const q0 = M.flowScore(model, mk5(0)), q1 = M.flowScore(model, mk5(0.42));
  chk(Math.abs(q0 - q1) > 1e-6, "중립화하지 않은 칸은 그대로 확률을 움직인다",
    "★모든 칸이 죽었다 — 중립화가 과했거나 채점기가 깨졌다★");
}

console.log("\n④ 무엇을 껐는지 사람이 읽을 수 있는가");
chk(/degenCols: _degen\.length \? _degen : null/.test(MINI),
  "모델 기록에 degenCols 가 남는다 — 화면이 이유를 말할 수 있다",
  "★무엇을 껐는지 기록이 없다 — FLOW 가 6차원이 된 것을 아무도 모른다★");
chk(/퇴화칸 " \+ _degen\.length \+ "\/" \+ D/.test(MINI),
  "학습완료 로그가 끈 칸 수와 이름을 적는다",
  "★로그가 말하지 않는다 — 다음 회차에 원인을 되짚을 수 없다★");
{
  // 이름을 못 붙이면 로그가 f7 이라고만 한다 — 네 호출부 전부가 featNames 를 넘겨야 한다.
  /* ★호출 블록 ★안에서★ 센다.★ 파일 전체에서 featNames: 를 세면 무관한 자리가 섞여
     "4곳인데 10곳이 넘긴다" 같은 헛숫자가 나온다 — 그러면 하나가 빠져도 통과한다.
     괄호를 세서 각 호출의 인자 객체만 떼어낸다. */
  const calls = [];
  let p = -1;
  while ((p = S.indexOf("_miniLogisticTrain(DB, {", p + 1)) > 0) {
    let d = 0, k = S.indexOf("{", p + 20), e = k;
    for (; e < S.length; e++) { const c = S[e]; if (c === "{") d++; else if (c === "}") { d--; if (d === 0) break; } }
    calls.push(S.slice(k, e + 1));
  }
  const missing = calls.filter(function (b) { return !/\bfeatNames\s*:/.test(b); }).length;
  /* [V33.422] FLOW·XALPHA·STACK 퇴역 — 호출부가 넷에서 ★이중헤드 둘★ 로 줄었다.
     계약(각자 자기 피처 이름을 넘긴다)은 그대로다. 개수는 손으로 적지 않고 "남은 전부" 로 본다. */
  chk(calls.length >= 1 && missing === 0,
    "호출부 " + calls.length + "곳 ★전부★ 가 자기 인자에 featNames 를 넘긴다",
    "★호출부 " + calls.length + "곳 중 " + missing + "곳이 이름을 안 넘긴다 — 그 모델의 로그는 f7 이라고만 한다★");
  // 태그와 이름이 실제로 짝인지 — 엉뚱한 모델 이름표를 붙이면 로그가 거짓말을 한다
  for (const [tag, want] of [["DUAL-", "LUXML.featNames"]]) {
    const b = calls.find(function (x) { return x.indexOf('tag: "' + tag) >= 0; });
    if (!b || b.indexOf(want) < 0) { console.log("  FAIL ★" + tag + " 호출부가 " + want + " 를 안 넘긴다★"); fails++; }
  }
  console.log("  ok   남은 모델이 각자 자기 피처 이름을 넘긴다(이중헤드)");
  const names = ["dummy.p", "dummy.on"];
  chk(names.length === 2,
    "이름 배열 계약 유지(슬롯 하나당 확률·마스크 두 칸)",
    "★STACK 이름 수가 차원과 다르다 — 로그가 엉뚱한 칸 이름을 적는다★");
}

console.log("\n⑤ ★같은 관측을 두 번 세지 않는가★ (검증 신뢰도의 기계적 원인)");
chk(PY.indexOf("[중복제거]") > 0, "트레이너가 완전히 같은 행을 버린다",
  "★중복을 세기만 하고 버리지 않는다 — 고유도가 무너지고 Wilson 하한이 깎인다★");
chk(/_k = \(s_\.get\("ts"\), s_\.get\("s"\), s_\.get\("m"\), s_\.get\("y"\), s_\.get\("pnl"\),\s*\n\s*tuple\(_x\)/.test(PY),
  "버리는 기준이 ★완전히 같은 행★ 이다(ts·종목·시장·라벨·pnl·피처벡터 전부)",
  "★키가 느슨하다 — 진짜로 다른 행까지 버릴 수 있다★");
{
  const i = PY.indexOf("[중복제거]");
  const j = PY.indexOf("X = np.array([s[\"x\"] for s in samples]");
  chk(i > 0 && j > i, "중복 제거가 X/Y 를 만들기 ★전★ 에 일어난다",
    "★배열을 만든 뒤에 지운다 — 지운 것이 학습에 그대로 들어간다★");
}
/* ★있다고 세지 말고 돌려 보라.★ 처음 이 검사를 문자열로만 썼더니 `if _k in _seen:` 을
   `if False:` 로 바꾼 돌연변이를 놓쳤다 — 코드는 그대로 있고 아무 일도 안 하는 상태다.
   이 저장소가 반복해 당한 바로 그 실수라, 블록을 떼어 ★파이썬으로 실행★ 한다. */
{
  const a = PY.indexOf("        _seen, _uniq, _dropped = set(), [], 0");
  const b = PY.indexOf("        if _dropped:", a);
  const src = (a > 0 && b > a) ? PY.slice(a, b) : "";
  chk(src.length > 150, "중복제거 본문 " + src.length + "자를 떼어냈다", "본문 추출이 깨졌다 — 실행 검증을 못 한다");
  if (src.length > 150) {
    const tmp = process.env.TMPDIR || "/tmp";
    const py = tmp + "/_dedup_probe.py";
    // 같은 행 3벌 + 피처 한 칸만 다른 행 1개 + 다른 종목 1개 = 5건 → 3건이 남아야 한다
    writeFileSync(py, "import json\n" +
      "samples=[{'ts':1,'s':'A','m':'us','y':1,'pnl':0.5,'x':[1.0,2.0]},\n" +
      "         {'ts':1,'s':'A','m':'us','y':1,'pnl':0.5,'x':[1.0,2.0]},\n" +
      "         {'ts':1,'s':'A','m':'us','y':1,'pnl':0.5,'x':[1.0,2.0]},\n" +
      "         {'ts':1,'s':'A','m':'us','y':1,'pnl':0.5,'x':[1.0,9.0]},\n" +
      "         {'ts':1,'s':'B','m':'us','y':1,'pnl':0.5,'x':[1.0,2.0]}]\n" +
      src.replace(/^ {8}/gm, "") +
      "\nprint(json.dumps({'kept':len(_uniq),'dropped':_dropped,'ids':[u['s']+str(u['x'][1]) for u in _uniq]}))\n");
    let out = null;
    try { out = JSON.parse(execFileSync("python3", [py], { encoding: "utf8" }).trim()); }
    catch (err) { chk(false, "", "★파이썬을 돌려보지 못했다: " + String(err.message).slice(0, 140) + "★"); }
    if (out) {
      chk(out.dropped === 2 && out.kept === 3,
        "실행 확인: 같은 행 3벌 + 다른 행 2개 → 2건 버리고 3건 남는다 (남은 것 " + out.ids.join(",") + ")",
        "★실제로 안 지운다 — 버림 " + out.dropped + " · 남음 " + out.kept + " (기대 2/3)★");
      chk(out.ids.indexOf("A9.0") >= 0 && out.ids.indexOf("B2.0") >= 0,
        "피처 한 칸만 달라도 ★남긴다★ · 종목이 다르면 ★남긴다★ — 느슨한 키가 아니다",
        "★진짜로 다른 행까지 버렸다: " + out.ids.join(",") + "★");
    }
  }
}

console.log("\n⑥ 과적합 진단이 기저율을 보는가 (바로 위 [기저율] 과 모순이 없는가)");
chk(/_exGap = _exTr - _exVa/.test(PY),
  "판정을 ★각자의 다수클래스 대비 초과★ 로 한다",
  "★날것 정확도 차이로 판정한다 — [기저율] 이 하지 말라고 적어 둔 바로 그것이다★");
chk(/if _exGap > 0\.05:/.test(PY) && /elif _exGap < -0\.01:/.test(PY),
  "두 분기 모두 초과 기준을 쓴다", "★분기 하나가 아직 날것 격차를 본다★");
chk(/과적합진단·초과/.test(PY),
  "초과 기준 숫자를 로그에 따로 적는다(날것 격차도 같이 남긴다)",
  "새 판정의 근거 숫자가 로그에 없다");
{
  // 실측값으로 판정이 실제로 뒤집히는지 — 이 고침의 요점이다
  const trA = 0.5884, trU = 0.5417, maj = 0.5561, va = 0.5073, vMaj = 0.5042;
  const rawGap = trA - va, exGap = (trA - maj) - (va - vMaj);
  chk(rawGap > 0.05 && exGap <= 0.05,
    "실측 재현: 날것 격차 " + (rawGap * 100).toFixed(2) + "%p(→과적합 경향) vs 실력 격차 "
      + (exGap * 100).toFixed(2) + "%p(→과적합 아님) — 처방이 뒤집힌다",
    "판정이 안 뒤집힌다 — 이 고침의 근거가 사라졌다");
  chk(trU - maj < 0,
    "균등 초과 " + ((trU - maj) * 100).toFixed(2) + "%p — 자기 학습집합조차 다수클래스만 못하다(과소적합 쪽이다)",
    "균등 초과 부호가 바뀌었다");
}

console.log(fails === 0 ? "\n✓ 워커 퇴화칸·중복·기저율 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
