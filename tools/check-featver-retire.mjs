/* [V33.360] ★판이 지난 모델 기록은 은퇴시킨다 + 표본을 지우기 전에 R2 로 옮긴다★
 *
 *   사용자 보고: "피쳐판 일치 안하는거도 수정해" / "d1이 한계면 r2에 옮기는것도 고려해봐".
 *
 *   ① 판 불일치 — 실측(2026-09-15 01:49): XGB·LGB·CAT 이 전부 이 상태였다.
 *        alt.roster.xgb   : featVer ★15★ · wantVer 17 · featVerOk false
 *        externalTrain.xgb: activeFeatVer ★15★ · 방금 온 것은 featVer 17(품질로 거절)
 *      승격 기록이 옛 판에 얼어붙어 ★영원히★ 남는다. featVer 가 다르면 피처 배열이 달라
 *      다시는 투표할 수 없는 모델인데도. 지워도 거래 동작은 안 바뀐다 —
 *      `_boosterAdmit` 이 이미 막고 있기 때문이다. 바뀌는 건 "없는 걸 있다고 말하지 않는다".
 *
 *   ② 표본 상한 — 총 1,123,768 / 상한 1,200,000. ★곧 닿는다.★ 닿으면 종전엔 그냥 DELETE 였다.
 *      수확 표본은 그날의 시장 상태로 만들어진 것이라 ★다시 만들 수 없다.★
 *      → R2 에 부은 뒤에 지운다. R2 쓰기가 실패하면 ★지우지 않는다.★
 */
import { readFileSync } from "node:fs";
import { mlRetireStaleFeatVer, LUXML } from "../src/index.js";

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "✗ FAIL ") + m); if (!c) fail++; };
const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");

/* state 를 기억하는 가짜 D1 + 가짜 R2 */
function fake(seed) {
  const st = new Map(Object.entries(seed || {}).map(([k, v]) => [k, JSON.stringify(v)]));
  const del = [];
  const DB = {
    st, del,
    prepare: (sql) => ({
      bind: (...b) => ({
        first: async () => { const v = st.get(b[0]); return v == null ? null : { v }; },
        all: async () => ({ results: [] }),
        run: async () => {
          if (/DELETE FROM state WHERE k = \?/.test(sql)) { del.push(b[0]); st.delete(b[0]); return { meta: { changes: 1 } }; }
          if (/DELETE FROM state WHERE k >= \? AND k < \?/.test(sql)) { del.push(b[0] + "*"); return { meta: { changes: 0 } }; }
          if (/INSERT INTO state/.test(sql)) { st.set(b[0], b[1]); return { meta: {} }; }
          if (/INSERT INTO logs/.test(sql)) return { meta: { last_row_id: 1 } };
          return { meta: {} };
        }
      }),
      first: async () => null, all: async () => ({ results: [] })
    })
  };
  return DB;
}

const WANT = LUXML.featVer, OLD = WANT - 2;

// ── ① 옛 판 기록은 은퇴한다 ──────────────────────────────────────────────────
{
  const DB = fake({
    xgb_trust: { featVer: OLD, trusted: true, gbdtAccLB: 0.52 },
    lgb_trust: { featVer: WANT, trusted: true, gbdtAccLB: 0.52 },     // 현재판 — 건드리면 안 된다
    cat_trust: { trusted: true, gbdtAccLB: 0.52 },                     // 판 미기록 — 모르면 안 지운다
    xgb_trust_ext: { featVer: WANT, trusted: false }                   // 섀도우 — 건드리면 안 된다
  });
  const msg = await mlRetireStaleFeatVer(DB);
  ok(/은퇴 1/.test(msg), `옛 판 1건만 은퇴했다 — "${msg}"`);
  ok(!DB.st.has("xgb_trust"), "옛 판 xgb_trust 를 지웠다");
  ok(DB.del.indexOf("xgb_model") >= 0, "본문 xgb_model 도 함께 지웠다(못 쓰는 모델이 자리를 먹지 않게)");
  ok(DB.del.indexOf("xgb_model:meta") >= 0 && DB.del.indexOf("xgb_model:chunk:*") >= 0,
     "메타·D1 청크까지 지웠다(반쪽 상태를 안 남긴다)");
  ok(DB.st.has("lgb_trust"), "★현재판 기록은 안 건드린다★");
  ok(DB.st.has("cat_trust"), "★판을 모르는 기록은 안 건드린다(모르면 안 지운다)★");
  ok(DB.st.has("xgb_trust_ext"), "★섀도우(방금 온 현재판)는 안 건드린다 — 다음 승격 후보다★");
}

// ── ② 아무것도 안 낡았으면 아무것도 안 한다 ──────────────────────────────────
{
  const DB = fake({ xgb_trust: { featVer: WANT, trusted: true }, lgb_trust: { featVer: WANT } });
  const msg = await mlRetireStaleFeatVer(DB);
  ok(/은퇴 0/.test(msg) && DB.del.length === 0, `전부 현재판이면 삭제 0건 — "${msg}"`);
}

// ── ③ 은퇴가 파이프라인에 실제로 걸려 있는가(두 경로 모두) ────────────────────
{
  ok(/\["retirefv", function \(DB\) \{ return mlRetireStaleFeatVer\(DB\); \}\]/.test(src),
     "야간 파이프라인 단계 목록에 retirefv 가 있다");
  ok(/_stg\("retirefv"/.test(src), "크론 경로에도 retirefv 가 걸려 있다");
  const i = src.indexOf('_stg("retirefv"'), j = src.indexOf('_stg("pooluniq"');
  ok(i > 0 && j > 0 && i < j, "학습기들 ★앞★ 에 돈다(뒤면 오늘 밤 판정이 옛 기록을 한 번 더 본다)");
}

// ── ④ 표본을 지우기 전에 R2 로 옮기는가 ──────────────────────────────────────
{
  const blk = src.slice(src.indexOf("if (over > 0) {"), src.indexOf("if (over > 0) {") + 2600);
  ok(blk.indexOf("ml/archive/") >= 0, "보관 키가 ml/archive/ 아래다");
  ok(/_R2a\.put\(/.test(blk), "지울 행을 R2 에 붓는다");
  const putAt = blk.indexOf("_R2a.put("), delAt = blk.indexOf("DELETE FROM ml_samples");
  ok(putAt > 0 && delAt > 0 && putAt < delAt, "★R2 쓰기가 DELETE 보다 먼저다★ — 순서가 뒤집히면 보관 전에 사라진다");
  ok(/if \(_arch > 0\) \{/.test(blk), "보관에 성공한 건수만큼만 지운다");
  ok(/삭제하지 않았다/.test(blk), "★보관이 실패하면 지우지 않고 ERROR 를 남긴다★(되돌릴 수 없는 삭제를 막는다)");
  ok(/fromTs/.test(blk) && /toTs/.test(blk) && /"n":|n: _old\.length/.test(blk),
     "보관 파일에 기간·건수를 함께 적는다(나중에 무엇을 보관했는지 알 수 있게)");
  ok(/ml\/archive\//.test(src.slice(src.indexOf('g = "표본 보관함"') - 80, src.indexOf('g = "표본 보관함"') + 40)),
     "R2 상태 화면이 보관함을 별도 그룹으로 센다");
}

// ── ⑤ 옛 판 표본 정리도 인덱스를 타는가(I-1 과 같은 함정) ─────────────────────
{
  /* ★주석은 제외하고 센다★ — I-1 을 설명하는 주석 안에 그 철자가 일부러 적혀 있다.
     주석을 먼저 지운 뒤 남은 코드에서만 찾는다(따옴표 기준 파싱은 JS 소스에서 잘 깨진다). */
  const noComment = src
    .replace(/\/\*[\s\S]*?\*\//g, " ")          // 블록 주석
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");        // 줄 주석(:// URL 은 건드리지 않는다)
  const hits = [...noComment.matchAll(/featver\s*!=\s*\?/gi)];
  ok(hits.length === 0, hits.length === 0
    ? "코드(주석 제외)에 `featver != ?` 0건 — 그 철자는 인덱스를 못 탄다(I-1)"
    : `\`featver != ?\` 가 ${hits.length}건 남아 있다`);
  /* 대조군 — 이 검사가 진짜로 잡는지 보인다(주석 제거가 과해 다 지워버리면 공허하게 통과한다) */
  ok(/featver\s*<\s*\?/i.test(noComment),
     "대조군 — 주석 제거 뒤에도 `featver < ?`(고친 철자)는 코드에 남아 있다");
}

console.log(fail ? "\n판 은퇴·보관 계약 위반 " + fail + "건 — 배포 차단" : "\n  ok   판 은퇴·보관 계약 통과");
process.exit(fail ? 1 : 0);
