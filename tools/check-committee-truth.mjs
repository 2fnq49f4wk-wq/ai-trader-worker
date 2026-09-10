/* [V33.339] 위원 명단이 ★한 입으로 말하는가★ — 판정과 사유의 단일 출처
 *
 *   사용자 지시: "판 불일치랑 검증미달 잡아라 결함 아직도 있다" (그리고 진단 스냅샷 "이거 해결해").
 *
 *   2026-09-10 04:07 운영 스냅샷에서 같은 세 모델(XGB/LGB/Cat)을 두고 화면 세 곳이 달랐다:
 *     · aiMode.committee.xgb : trusted true · promoted true · w 0.4766
 *     · alt.roster.xgb       : tier reject · mult 0 · why "검증 미달 — 억제" · featVer null
 *     · 실제 투표            : 불참 (위원회 n=1, GBDT 뿐)
 *   자가진단은 "XGB 미합류 accLB 51.46% (문턱 50.5%)" — ★문턱보다 높은 숫자를 사유로★ 적었다.
 *   진짜 이유는 셋 중 어디에도 없었다: 세 모델 다 판(featVer)이 낡아 빠진 것이다.
 *
 *   이 검사가 무는 것:
 *     ① 합류 판정과 사유는 _boosterAdmit 한 곳에서만 나온다
 *     ② 부스터 행도 ★판 불일치를 말할 수 있다★ (featVerOk 를 true 로 박아 두지 않는다)
 *     ③ 화면이 '가동' 이라 적는 기준 = 실제 투표 기준
 *     ④ 판정 함수를 ★실제로 돌려★ 사유가 상황마다 갈리는지 본다
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.error("  FAIL " + m); };

// ── ① 판정이 한 곳에만 있는가 ──────────────────────────────────────────
{
  if (/function _boosterAdmit\(/.test(S)) ok("_boosterAdmit — 부스터 합류 판정이 이름을 가진 한 함수다");
  else bad("★부스터 합류 판정 함수가 없다★ — 읽는 곳마다 조건을 다시 적게 된다");
  if (/async function _boosterDiag\(/.test(S)) ok("_boosterDiag — 화면·자가진단이 읽는 창구가 하나다");
  else bad("★사유를 꺼내는 창구가 없다★");
  /* 종전 문구가 ★값으로★ 남아 있으면 어딘가가 아직 자기 말로 사유를 적고 있다는 뜻이다.
     (주석 안의 인용은 '전에 이랬다' 는 기록이라 잡지 않는다 — 잡으면 기록을 지우게 된다.) */
  if (!/(why|reason)\s*:[^\n]*"검증 미달 — 억제"/.test(S))
    ok("고정 사유 문구 '검증 미달 — 억제' 를 값으로 쓰는 곳이 없다 — 사유는 계산된다");
  else bad("★'검증 미달 — 억제' 를 아직 사유 값으로 박아 쓴다★ — 판 불일치를 그 문장으로 덮는다");
}

// ── ② 부스터 행이 판 불일치를 말할 수 있는가 ───────────────────────────
{
  const i0 = S.indexOf('[["xgb", "XGB"], ["lgb", "LGB"], ["cat", "CatBoost"]].forEach');
  if (i0 < 0) bad("★부스터 명단 행을 못 찾았다 — 이 검사가 아무것도 안 보고 있다★");
  else {
    const blk = S.slice(i0, i0 + 900);
    if (/featVerOk:\s*true\b/.test(blk))
      bad("★부스터 행이 featVerOk 를 true 로 박아 둔다★ — 판이 낡아도 화면은 문턱 탓을 한다");
    else ok("부스터 행이 featVerOk 를 판정 결과에서 받는다");
    if (/featVer:\s*\(d\.featVer/.test(blk) && /wantVer:\s*LUXML\.featVer/.test(blk))
      ok("부스터 행이 모델 판·요구 판을 함께 싣는다 — 화면이 '15 ≠ 17' 을 그대로 보여 준다");
    else bad("★부스터 행에 판 번호가 없다★ — 사람이 원인을 화면에서 셀 수 없다");
    if (/why:\s*on \? "합의 가중 ×0\.8" : \(d\.why/.test(blk))
      ok("미합류 사유를 판정 함수에서 그대로 옮긴다");
    else bad("★명단이 사유를 자기 말로 다시 적는다★");
  }
}

// ── ③ 화면의 '가동' 기준 = 실제 투표 기준 ──────────────────────────────
{
  const i0 = S.indexOf("const _st = function (nm) {");
  if (i0 < 0) bad("★aiMode 위원회 상태 블록을 못 찾았다★");
  else {
    const blk = S.slice(i0, i0 + 1100);
    if (/trusted:\s*!!\(live && t\.trusted\)/.test(blk))
      bad("★화면이 업로드 시점 도장(trusted)만 읽는다★ — 그 뒤 판이 올라가 빠진 모델도 '가동' 이라 적는다");
    else ok("화면이 업로드 시점 도장을 그대로 믿지 않는다");
    if (/const on = !!d\.live;/.test(blk) && /trusted:\s*on,/.test(blk))
      ok("화면의 trusted 가 실제 투표 여부(_boosterDiag.live)와 같은 값이다");
    else bad("★화면 trusted 가 실제 투표와 다른 근거로 정해진다★");
    if (/w:\s*on \?/.test(blk)) ok("가중도 불참이면 0 으로 나간다 — 안 쓰는 지분이 화면에 남지 않는다");
    else bad("★불참인데 가중이 화면에 남는다★");
  }
}

// ── ④ 자가진단이 통과한 숫자를 사유로 적지 않는가 ──────────────────────
{
  if (/미합류 accLB "/.test(S))
    bad("★자가진단이 아직 'accLB X% (문턱 Y%)' 로 사유를 대신한다★ — 문턱 위 숫자가 사유가 된다");
  else ok("자가진단이 accLB 를 사유 자리에 놓지 않는다");
  if (/" 미합류 — " \+ d\.why/.test(S)) ok("자가진단이 판정 함수의 사유를 그대로 옮긴다");
  else bad("★자가진단이 사유를 자기 말로 다시 적는다★");
}

// ── ⑤ ★판정 함수를 실제로 돌려 본다★ — 문자열 검사만으로는 동작을 모른다 ──
{
  const i0 = S.indexOf("function _boosterAdmit(");
  const i1 = S.indexOf("async function _boostersCached(DB)");
  if (i0 < 0 || i1 < 0 || i1 <= i0) bad("★판정 함수 본문을 못 잘라냈다 — 실행 검사를 못 한다★");
  else {
    const ctx = {
      LUXML: { featVer: 17 },
      GBDT: { trustFloor: 0.505, icPathAccFloor: 0.49 },
      ICGATE: { provisional: { tMin: 1.65 } },
      _num: (v, d) => (typeof v === "number" && isFinite(v)) ? v : d,
      console
    };
    vm.createContext(ctx);
    vm.runInContext(S.slice(i0, i1), ctx);
    const A = ctx._boosterAdmit;
    /* 스냅샷 실측 그대로: 문턱은 넘었는데 판이 낡았다. */
    const stale = A({ trusted: true, gbdtAccLB: 0.5146, featVer: 16, wGbdt: 0.4766 }, null);
    if (!stale.ok && /판 불일치/.test(stale.why) && /16/.test(stale.why) && /17/.test(stale.why))
      ok("판이 낡으면 '판 불일치(16 ≠ 17)' 라 말한다 — 문턱 얘기를 하지 않는다");
    else bad(`★판 불일치를 그렇게 말하지 않는다★ (ok=${stale.ok} why=${stale.why})`);
    if (stale.featVerOk === false) ok("판 불일치가 featVerOk=false 로도 나간다 — 화면이 색을 다르게 칠할 수 있다");
    else bad("★판이 낡았는데 featVerOk 가 false 가 아니다★");

    const low = A({ trusted: true, gbdtAccLB: 0.4836, featVer: 17, valICt: 0.4 }, null);
    if (!low.ok && /검증 미달/.test(low.why) && /48\.36/.test(low.why))
      ok("정확도가 정말 모자라면 그때 '검증 미달' 이라 말하고 실제 숫자를 적는다");
    else bad(`★검증 미달을 그렇게 말하지 않는다★ (why=${low.why})`);

    const good = A({ trusted: true, gbdtAccLB: 0.5146, featVer: 17, wGbdt: 0.4766 }, null);
    if (good.ok && good.why === null) ok("문턱·판 둘 다 맞으면 통과한다 — 검사가 무조건 막는 게 아니다");
    else bad(`★정상 모델까지 막는다★ (why=${good.why})`);

    const icPath = A({ trusted: true, gbdtAccLB: 0.4950, featVer: 17, valICt: 2.1 }, null);
    if (icPath.ok) ok("IC 경로(정확도 바닥 통과 + 블록IC 유의)도 그대로 열려 있다");
    else bad(`★IC 경로가 닫혔다★ (why=${icPath.why})`);

    const shadow = A(null, { trusted: true, gbdtAccLB: 0.53, featVer: 17 });
    if (!shadow.ok && /섀도우/.test(shadow.why)) ok("승격 안 된 섀도우는 '섀도우' 라 말한다");
    else bad(`★섀도우를 구분하지 못한다★ (why=${shadow.why})`);

    const none = A(null, null);
    if (!none.ok && /모델 없음/.test(none.why)) ok("아예 없으면 '모델 없음' — 셋(없음·판·문턱)이 안 뭉개진다");
    else bad(`★모델 없음을 구분하지 못한다★ (why=${none.why})`);
  }
}

// ── ⑥ 준비 안 된 단계에 완료 도장을 찍지 않는가 (committee_cal 이 두 판을 건너뛴 원인) ──
{
  const i0 = S.indexOf("async function mlCalibrateCommittee(DB)");
  const i1 = S.indexOf("async function", i0 + 40);
  const blk = (i0 >= 0 && i1 > i0) ? S.slice(i0, i1) : "";
  if (!blk) bad("★보정 단계 본문을 못 찾았다★");
  else {
    const bails = blk.match(/return\s+(?:"\\u27F3 " \+ )?"\[CAL\][^"]*"/g) || [];
    const naked = bails.filter((b) => !/\\u27F3/.test(b) && !/위원회 보정/.test(b));
    if (bails.length >= 3) ok(`보정 단계의 이탈 경로 ${bails.length}곳을 모두 본다`);
    else bad(`★이탈 경로가 ${bails.length}곳뿐 — 검사가 볼 게 없다★`);
    if (naked.length === 0) ok("표본·모델이 아직 없어 물러날 때 전부 재시도 신호(⟳)를 남긴다");
    else bad(`★완료 도장이 찍히는 이탈 경로 ${naked.length}곳★ ${naked.join(" | ")} — 그날 내내 보정이 꺼진다`);
    if (/return null;/.test(blk))
      bad("★null 로 물러나는 경로가 남아 있다★ — _stg 는 null 을 '오늘 할 일 끝' 으로 읽는다");
    else ok("null 로 조용히 물러나는 경로가 없다");
  }
}

if (fails) { console.error(`check-committee-truth: ${fails} FAIL`); process.exit(1); }
console.log("check-committee-truth: OK");
