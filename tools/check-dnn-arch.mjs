/* ═══════════════════════════════════════════════════════════════════════════
   [V33.260] 잰 값이 다음 학습에 반영되지 않았다 — 그래서 매번 같은 답이 나왔다

   운영 실측(/api/ai/selfcheck):
       DNN  trusted:false  wDnn:0  accLB:0.4727     ← ★동전 던지기보다 낮다★
       GBDT 0.5415 · XGB 0.5354 · LGB 0.5324 · Cat 0.5409   (같은 표본·같은 판)

   데이터에 신호가 없는 게 아니다. 트리들은 같은 51만 표본에서 3~4%p 를 뽑는다.
   이 구성이 그 신호를 못 잡는 것이다. 그런데 그 사실은 ★이미 측정돼 있었다★ —
   V33.204 의 깊이 스윕이 2026-08-22 에 10층 49.3% vs 2층 53.3% 를 기록했다.

   문제는 그 측정이 ★아무 데도 저장되지 않는다★ 는 것이었다. 스윕은 사람이 부를
   때만 돌고, 승자를 그 실행 안에서만 쓰고 버린다. 6시간마다 도는 정기 실행은
   여전히 cfg.hidden(10층)으로 학습한다. 재는 자를 만들어 놓고 눈금을 안 읽는 셈이다.

   그리고 규제. 워커는 dropout 0.42 · l2 9e-4 를 실어 보내는데 트레이너가 표본 수
   사다리로 ★매번 덮어썼다★ — 그 손잡이는 Modal 경로에서 한 번도 쓰인 적이 없다.
   사다리 맨 윗칸은 표본 18만 시절 값인데 지금은 51만이다.

   이 검사가 묻는 것은 "성능이 좋아졌나" 가 아니다(그건 다음 학습이 답한다).
   ★측정 → 저장 → 다음 학습에 반영★ 이라는 고리가 실제로 닫혀 있는가만 본다.
   고리가 끊기면 무엇을 재든 아무 일도 일어나지 않는다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const PY = readFileSync(new URL("../trainer/modal/modal_train.py", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const pyCode = PY.split("\n").filter(l => !/^\s*#/.test(l)).join("\n");

console.log("① 고리가 닫혀 있는가 — 측정 → 저장 → 반영");
{
  chk(/\/api\/dnn-arch/.test(S) && /setState\(env\.DB,\s*DNNARCH\.stateKey/.test(S),
    "워커에 구성 저장 엔드포인트가 있다(/api/dnn-arch)", "잰 구성을 저장할 곳이 없다 — 측정이 또 버려진다");
  chk(/requests\.post\(BASE \+ "\/api\/dnn-arch"/.test(pyCode),
    "트레이너가 스윕 승자를 실제로 올린다", "스윕이 승자를 올리지 않는다 — 실행이 끝나면 사라진다");
  chk(/_mlExportConfig\(_arch\)/.test(S) && /hidden:\s*\(A && A\.hidden\) \|\| DNN\.hidden/.test(S),
    "다음 학습이 받는 config.hidden 이 저장된 측정값이다", "config 가 여전히 상수만 내보낸다 — 반영이 안 된다");
}

console.log("\n② 근거가 없을 때는 지시가 기본값인가");
{
  // 10층은 V33.193 에서 사용자 지시로 되돌린 값이다. 측정이 없으면 그 값이어야 한다.
  const d0 = M._dnnArchDecide(null, null, 0);
  chk(JSON.stringify(d0.hidden) === JSON.stringify(M.DNN.hidden),
    "측정 기록이 없으면 기본값(" + M.DNN.hidden.length + "층)으로 돈다 — 지시를 덮어쓰지 않는다",
    "측정이 없는데 기본값이 아니다: " + d0.hidden.join("-"));
  chk(d0.measured === false, "그 상태를 '기본값' 이라고 표시한다", "측정값과 기본값을 구분하지 않는다");

  const FV = M.LUXML.featVer;
  const d1 = M._dnnArchDecide({ hidden: [128, 64], featVer: FV, n: 500000, ts: Date.now() },
                              { trusted: true }, 500000);
  chk(JSON.stringify(d1.hidden) === "[128,64]" && d1.measured === true,
    "측정 기록이 있으면 그 구성으로 돈다", "측정값이 있는데 반영되지 않는다: " + d1.hidden.join("-"));

  const d2 = M._dnnArchDecide({ hidden: [128, 64], featVer: FV - 1, n: 500000, ts: Date.now() },
                              { trusted: true }, 500000);
  chk(JSON.stringify(d2.hidden) === JSON.stringify(M.DNN.hidden),
    "판(featVer)이 다른 측정값은 쓰지 않는다 — 피처가 바뀌면 답도 바뀐다",
    "옛 판의 측정값을 그대로 쓴다");
}

console.log("\n③ 스윕을 언제 켜는가 — 신뢰할 때 태우지 않고, 못 믿을 때 방치하지 않는다");
{
  const FV = M.LUXML.featVer, now = Date.now();
  const rec = (o) => Object.assign({ hidden: [128, 64], featVer: FV, n: 500000, ts: now }, o || {});

  /* ★가드끼리 서로를 가리지 않게 케이스를 격리한다.★ 처음엔 ts=now 로 썼는데,
     그러면 '신뢰' 가지를 죽여도 바로 아래 '방금 쟀다' 가지가 대신 sweep=false 를
     돌려줘서 변이가 안 잡혔다. 신뢰 가지만이 유일하게 막을 수 있는 상태로 만든다:
     오래됐고(40h) 규모도 같아서, 신뢰하지 않으면 반드시 스윕이 켜지는 조건. */
  const _onlyTrust = rec({ ts: now - 40 * 3600000 });
  chk(M._dnnArchDecide(_onlyTrust, { trusted: false }, 500000).sweep === true,
    "(대조) 같은 조건에서 신뢰하지 않으면 스윕이 켜진다", "대조군이 안 켜진다 — 아래 검사가 무의미해진다");
  chk(M._dnnArchDecide(_onlyTrust, { trusted: true }, 500000).sweep === false,
    "신뢰 중이면 스윕하지 않는다(정상일 때 추가 GPU 비용 0)", "신뢰하는데도 스윕한다 — 돈만 태운다");
  chk(M._dnnArchDecide(null, { trusted: false }, 500000).sweep === true,
    "이 판에서 잰 적이 없고 못 믿으면 스윕한다", "못 믿는데 재지도 않는다 — 영원히 그대로다");
  chk(M._dnnArchDecide(rec({ ts: now - 2 * 3600000 }), { trusted: false }, 500000).sweep === false,
    "방금 쟀으면 같은 조건에서 조르지 않는다(무한 스윕 방지)", "2시간 전에 쟀는데 또 스윕한다");
  chk(M._dnnArchDecide(rec({ ts: now - 40 * 3600000 }), { trusted: false }, 500000).sweep === true,
    "충분히 지났고 여전히 못 믿으면 다시 잰다", "하루가 지나도 재시도하지 않는다");
  chk(M._dnnArchDecide(rec({ ts: now - 1000 }), { trusted: false }, 900000).sweep === true,
    "표본 규모가 크게 변하면(50만→90만) 다시 잰다 — 규모가 다르면 답도 다르다",
    "표본이 배로 늘었는데 옛 측정을 그대로 쓴다");

  // 사유를 항상 남긴다 — 조용히 켜고 끄면 나중에 아무도 답할 수 없다
  for (const c of [[null, { trusted: false }, 1], [rec(), { trusted: true }, 1]]) {
    const d = M._dnnArchDecide(c[0], c[1], c[2]);
    if (!(typeof d.why === "string" && d.why.length > 4)) { console.log("  FAIL 판단 사유가 비어 있다"); fails++; }
  }
  console.log("  ok   켜든 끄든 사유를 문장으로 남긴다");
}

console.log("\n④ 규제도 잴 수 있는 축이 되었는가");
{
  chk(/def fit_arch\(dims, tag="", reg=None\)/.test(pyCode),
    "fit_arch 가 규제를 인자로 받는다", "규제가 여전히 바깥 변수 캡처다 — 규제 축으로는 비교 자체가 불가능하다");
  chk(/_reg_base\s*=\s*dict\(/.test(pyCode),
    "사다리값을 기준(_reg_base)으로 남겨 후보 비교의 원점으로 쓴다", "기준 규제가 없다");
  chk(/reg_cands\s*=/.test(pyCode) && /규제 현행/.test(PY),
    "후보에 ★현행★ 이 포함된다 — 완화가 낫다고 단정하지 않는다",
    "현행을 후보에서 뺐다 — 그러면 비교가 아니라 교체다");
  chk(/fit_arch\(\[D\] \+ list\(_dwin\["hidden"\]\) \+ \[1\], rtag, reg=rcfg\)/.test(pyCode),
    "이긴 깊이 위에서만 규제를 흔든다(좌표하강 — 전조합은 예산 초과)",
    "규제 후보가 깊이 승자에 붙지 않는다");
}

console.log("\n⑤ 승자 주장을 서버가 검산하는가");
{
  /* ★조건식을 고정한다 — 본문 문구만 보면 안 된다.★ 변이 시험에서 이 자리를
     `if (false)` 로 죽여 봤더니 문구가 그대로 남아 검사를 통과했다. 죽은 코드를
     살아 있다고 세는 것은 이 저장소에서 이미 여러 번 당한 실패다. */
  chk(/if\s*\(top\s*>\s*_lb\s*\+\s*1e-9\)/.test(S),
    "순위표 최상위와 승자 하한을 비교하는 조건식이 살아 있다(top > _lb)",
    "검산 조건식이 없거나 죽었다 — 트레이너가 보낸 승자를 그대로 받는다");
  chk(/let top = -1; for \(const r of rk\)/.test(S),
    "순위표를 실제로 훑어 최상위를 구한다", "최상위 계산이 사라졌다");
  chk(/featVer 불일치/.test(S.slice(S.indexOf('"/api/dnn-arch"'))),
    "판이 다른 측정은 거부한다", "옛 판의 측정을 그대로 저장한다");
  chk(/hidden 이 형식에 안 맞는다/.test(S),
    "층 수·폭 범위를 검사한다(잘못된 구성이 저장되면 다음 학습이 통째로 죽는다)",
    "hidden 형식 검사가 없다");
}

console.log("\n⑥ DNN 만 valAcc 가 null 이던 필드 이름 어긋남");
{
  chk(/o\.gbdtAcc != null \? o\.gbdtAcc : o\.dnnAcc/.test(S),
    "dnn_trust 의 dnnAcc 도 읽는다 — 화면이 '학습 안 됨' 으로 오해시키지 않는다",
    "여전히 valAcc/gbdtAcc 만 본다 — DNN 은 영원히 null 이다");
}

console.log(fails === 0 ? "\n✓ DNN 구성 측정-반영 고리 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
