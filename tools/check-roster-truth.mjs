/* [V33.363] ★화면이 자기 자신을 반박했다 — 뱃지와 본문이 반대였다★
 *
 *   사용자 화면 실측(2026-09-15 14:18·14:19):
 *
 *   ① 부스터 3종 — 뱃지 "모델 판 불일치" / 바로 아래 본문 "재학습은 돌고 있다 —
 *      featVer 17 모델이 47분 전 도착했으나 승격 거절: IC 경로 — 정확도 하한 42.61% < 49%".
 *      ★판은 이미 와 있다.★ "판 불일치" 는 '기다리면 된다' 로 읽히고, 사실은 '기다려도 안 된다' 다.
 *      원인: 뱃지를 가르는 featVerOk 가 ★낡은 승격기록(featVer 15)★ 에서 나왔다.
 *
 *   ② MIND — 사이드바 "모델 없음 — 학습 미완료" / 본문 "정식 합류 ×1.00". 정반대다.
 *      원인: '저장돼 있는가' 를 두 곳이 다른 조건으로 판정했다.
 *          diag        : mfm && mmeta            ← fm 을 요구
 *          buildRoster : mmeta && (mfm || trees) ← 트리도 인정
 *      실측 experts=["tree"] — 지금 MIND 는 트리 코어다. 그리고 채점기 mlMindScore 는
 *      V33.249 부터 트리 코어를 지원한다 → ★roster 가 맞고 diag 가 틀렸다.★
 *
 *   ③ "성능 미달" 이 스스로를 설명하지 않았다. 점추정 48.21% 인데 하한 42.61% —
 *      그 5.6%p 차이는 ★유효표본 222★ 를 뜻한다(원시 22만). 모델이 나쁜 게 아니라
 *      잴 수가 없는 것이다(I-2). 화면이 그 말을 안 하면 사람은 문턱을 만지러 간다.
 */
import { readFileSync } from "node:fs";
import { _boosterAdmit, LUXML } from "../src/index.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "✗ FAIL ") + m); if (!c) fail++; };
const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const W = LUXML.featVer, NOW = Date.now();

// ── ① 현재 판이 와 있으면 뱃지가 '판 불일치' 가 아니어야 한다 ──────────────────
//     rosterCls: featVerOk === false → "off"(판 불일치) / 아니면 tier 로 갈린다.
{
  const live = { featVer: W - 2, gbdtAccLB: 0.5225, trusted: true, wGbdt: 0.4, trainedAt: NOW - 96 * 3600000 };
  const LIVE_CASES = [   // ★스크린샷의 실제 수치 그대로★
    ["XGB", 0.4261, 0.4821, "IC 경로 — 정확도 하한 42.61% < 49% (동전보다 못한 쪽을 IC 로 덮지 않는다)"],
    ["LGB", 0.4537, 0.5101, "IC 경로 — 정확도 하한 45.37% < 49% (동전보다 못한 쪽을 IC 로 덮지 않는다)"],
    ["CAT", 0.3621, 0.4165, "정확도 하한 0.3621 < 0.6303 · 유효 IC 0.0041 < 0.015"]
  ];
  for (const [nm, lb, acc, reason] of LIVE_CASES) {
    const ext = { featVer: W, gbdtAccLB: lb, gbdtAcc: acc, valN: 222, valNRaw: 220000,
                  valUniq: 0.001, trusted: false, trainedAt: NOW - 47 * 60000, reason: reason };
    const a = _boosterAdmit(live, ext);
    ok(a.featVerOk === true && a.featVer === W,
       `${nm} — 현재 판(${W})이 와 있으므로 featVerOk=true · featVer=${a.featVer} (뱃지가 '판 불일치' 가 아니게 된다)`);
    ok(a.activeFeatVer === W - 2,
       `${nm} — 실제로 투표 자격이 있는 판은 ${a.activeFeatVer} 로 ★따로 남긴다★(숨기지 않는다)`);
    ok(a.ok === false, `${nm} — 그래도 합류는 안 한다(거절은 그대로)`);
    ok(/유효표본 222\/220000/.test(a.why),
       `${nm} — 하한이 왜 눌렸는지 말한다(유효표본 222/220,000)`);
    ok(/I-2/.test(a.why), `${nm} — 결함 번호까지 지목한다`);
    ok(a.why.indexOf((acc * 100).toFixed(2)) >= 0,
       `${nm} — 점추정 ${(acc * 100).toFixed(2)}% 를 함께 적는다(하한만 보면 모델을 탓하게 된다)`);
  }
}

// ── ② 진짜 판 불일치(현재 판이 안 왔다)는 종전대로 '판 불일치' 여야 한다 ────────
{
  const live = { featVer: W - 2, gbdtAccLB: 0.52, trusted: true, trainedAt: NOW - 96 * 3600000 };
  const a = _boosterAdmit(live, null);
  ok(a.featVerOk === false && a.featVer === W - 2,
     "현재 판 수신분이 없으면 종전대로 featVerOk=false — ★진짜 판 불일치는 그대로 판 불일치★");
  ok(/재학습 대기/.test(a.why), `사유도 종전대로 — "${a.why}"`);
  const old = _boosterAdmit(live, { featVer: W - 3, trusted: false, trainedAt: NOW - 200 * 3600000, reason: "옛 거절" });
  ok(old.featVerOk === false, "옛 판 수신분으로는 실효 판이 되지 않는다");
}

// ── ③ 정상 모델은 아무것도 안 바뀐다(회귀 없음) ───────────────────────────────
{
  const good = { featVer: W, gbdtAccLB: 0.60, trusted: true, wGbdt: 0.5, trainedAt: NOW };
  const a = _boosterAdmit(good, null);
  ok(a.ok === true && a.why == null && a.featVerOk === true && a.featVer === W,
     "정상 승격 모델은 종전 그대로");
  ok(a.activeFeatVer === W, "activeFeatVer 도 현재 판");
}

// ── ④ MIND — '저장돼 있는가' 가 ★한 곳★ 에서만 답하는가 ──────────────────────
{
  ok(/function _mindStored\(probe\)/.test(src), "공용 술어 _mindStored 가 있다");
  const m = /function _mindStored\(probe\) \{[\s\S]*?\n\}/.exec(src);
  ok(!!m, "그 술어를 잘라냈다");
  if (m) {
    const _num = (v, d) => (typeof v === "number" && isFinite(v)) ? v : d;
    const f = eval("(" + m[0].replace(/^function _mindStored/, "function") + ")");
    ok(f({ mmeta: "object", mfm: "object", mtrees: null }) === true, "fm 코어 → 저장됨");
    ok(f({ mmeta: "object", mfm: null, mtrees: 120 }) === true,
       "★트리 코어(fm 없음) → 저장됨★ — mlMindScore 가 실제로 채점하는 모양이다(V33.249)");
    ok(f({ mmeta: null, mfm: "object" }) === false, "meta 가 없으면 결합을 못 한다 → 미저장");
    ok(f({ mmeta: "object", mfm: null, mtrees: 0 }) === false, "코어가 아예 없으면 미저장");
    ok(f(null) === false, "probe 자체가 없으면 미저장");
  }
  /* ★두 곳이 같은 술어를 부르는지★ — 이게 이 절의 요점이다(V33.301 의 재발 방지). */
  const callers = (src.match(/_mindStored\(/g) || []).length;
  ok(callers >= 3, `_mindStored 호출 ${callers}곳(정의 1 + diag + buildRoster) — 두 화면이 같은 답을 낸다`);
  ok(!/stored: !!\(_probe && _probe\.mfm && _probe\.mmeta\)/.test(src),
     "diag 의 옛 술어(fm 을 요구하던 것)가 사라졌다");
  /* 채점기와 같은 규칙인지 — 코어 선택 조건을 직접 확인한다 */
  ok(/const _isTree = !mind\.fm && Array\.isArray\(mind\.trees\) && mind\.trees\.length > 0;/.test(src),
     "채점기는 fm 이 없으면 트리로 채점한다 — 술어가 그 사실과 맞는다");
}

// ── ⑤ roster 가 두 판을 모두 싣는가 ─────────────────────────────────────────
{
  const add = src.slice(src.indexOf("const add = function (key, name, role, o) {"),
                        src.indexOf("e.state = rosterCls(e);"));
  ok(/activeFeatVer:/.test(add), "roster 항목이 activeFeatVer 를 싣는다");
  ok(/core:/.test(add), "MIND 코어 종류(fm/tree)도 싣는다 — '모델 없음' 오해를 막는다");
  const bst = src.slice(src.indexOf('[["xgb", "XGB"], ["lgb", "LGB"], ["cat", "CatBoost"]]'),
                        src.indexOf('[["xgb", "XGB"], ["lgb", "LGB"], ["cat", "CatBoost"]]') + 900);
  ok(/activeFeatVer: \(d\.activeFeatVer != null\)/.test(bst), "부스터 행이 그 값을 넘긴다");
}

// ── ⑥ 근거 카드가 ★단일 출처(state)★ 로 갈리는가 — 이 파일만 tier 를 봤다 ──────
{
  const ev = readFileSync(new URL("../public/model-evidence.js", import.meta.url), "utf8");
  ok(/function tierText\(r\)/.test(ev), "뱃지 글자를 내는 함수가 하나 있다");
  ok(/card\.querySelector\('\.evidence-tier'\)\.textContent=tierText\(r\);/.test(ev),
     "뱃지가 그 함수만 쓴다(여기서 다시 판정하지 않는다)");
  ok(!/r\.featVerOk===false\?'모델 판 불일치'/.test(ev), "옛 판정(featVerOk 로 직접 갈리던 것)이 사라졌다");

  /* ★함수를 잘라 실제로 돌린다.★ 스크린샷의 조합을 그대로 넣어 본다. */
  const m = /function tierText\(r\)\{[\s\S]*?\n  \}/.exec(ev);
  ok(!!m, "그 함수를 잘라냈다");
  if (m) {
    const f = eval("(" + m[0].replace(/^function tierText/, "function") + ")");
    ok(f({ state: "on", trained: true }) === "정식 합류", "on → 정식 합류");
    ok(f({ state: "prov", trained: true }) === "잠정 합류", "prov → 잠정 합류");
    ok(f({ state: "bad", tier: "reject", trained: true }) === "성능 미달", "bad(reject) → 성능 미달");
    ok(f({ state: "bad", tier: "pending", trained: true }) === "검증 대기", "bad(pending) → 검증 대기");
    ok(f({ state: "off", trained: false }) === "학습 대기", "off + 미학습 → 학습 대기");
    ok(f({ state: "off", trained: true }) === "모델 판 불일치", "off + 학습됨 → 판 불일치(진짜 그럴 때만)");
    /* ★스크린샷 그대로의 모순 조합★ — tier 로 갈리면 "정식 합류 ×0.00" 이 나온다 */
    ok(f({ state: "bad", tier: "full", trained: true, mult: 0 }) === "성능 미달",
       "★tier 가 full 이어도 state 가 bad 면 '성능 미달'★ — 종전엔 '정식 합류 ×0.00' 이 나왔다");
    ok(f({ state: "bad", tier: "reject", trained: true, featVerOk: false }) === "성능 미달",
       "state 가 이미 판정을 담고 있으므로 featVerOk 를 또 보지 않는다");
  }
  ok(/수신 판 v/.test(ev) && /승격돼 있는 판 v/.test(ev),
     "수신 판과 승격된 판이 다르면 그 사실을 적는다(숨기지 않는다)");
  ok(/if\(r\.core\)measures\.push/.test(ev), "MIND 코어 종류를 적는다");
}

console.log(fail ? "\n명부 정직성 계약 위반 " + fail + "건 — 배포 차단" : "\n  ok   명부 정직성 계약 통과");
process.exit(fail ? 1 : 0);
