/* ═══════════════════════════════════════════════════════════════════════════
   [V33.279] STACK 홀드아웃 경계 되감기 — 문을 열되 누출 쪽으로는 열지 않는다.

   ■ 무엇이 있었나 (운영 실측, 매 Modal 실행마다 반복)
       ⑨ STACK 경계 통지 실패 409: kept 2026-05-24 · rejected 2026-01-29
     종전 규칙은 minTs 를 "여기까지 썼다" 는 ★누적 워터마크★ 로 보고 뒤로 못 가게 막았다.
     그런데 이 값의 뜻은 그게 아니다 — "★지금 이 모델들이★ ts ≥ minTs 를 학습한 적 없다"
     이고, 그래서 payload 에 models 가 같이 온다. 전문가는 실행마다 전부 다시 학습되고,
     표본 풀이 커지면 마지막 20% 홀드아웃은 시간상 더 과거로 뻗는다 — 앞당겨지는 게 정상이다.
     세대가 다른 두 주장을 시각만으로 비교해 막으니, STACK 이 넉 달치를 영영 못 썼다.

   ■ 고친 규칙 — 되감기는 ★세대 교체가 확인될 때만★
     "이 창을 기록한 뒤 전문가가 전부 다시 학습됐는가". 판정은 ★가장 오래된★ 전문가
     기준이다(하나라도 안 바뀌었으면 그 모델에겐 여전히 in-sample 이다) — max 가 아니라 min.

   ■ 이 검사가 무는 것
     ① 전진은 종전대로 통과
     ② 되감기: 전원 재학습됐으면 통과 · 하나라도 낡았으면 ★거부★
     ③ 모르는 모델 이름이 섞이면 거부(모르면 안 믿는다)
     ④ 판정이 min 인가 — max 로 바뀌면 낡은 전문가 하나를 놓친다
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

/* 핸들러의 판정부를 그대로 떼어 돌린다 — 규칙을 검사에 옮겨 적지 않는다. */
const seg = /let _rewindOK = false, _oldest = 0;[\s\S]*?\n      \}\n/.exec(S);
chk(!!seg, "되감기 판정부를 소스에서 떼어 왔다", "판정부를 못 찾는다 — 검사가 헛돈다");

const DAY = 86400000, T0 = Date.parse("2026-08-01T00:00:00Z");
function run({ mt, pv, prevAt, models, trained }) {
  let out = null;
  const _num = (v, d) => (v == null || !isFinite(+v) ? d : +v);
  const getStates = async (_db, keys) => { const o = {}; for (const k of keys) if (trained[k] != null) o[k] = { trainedAt: trained[k] }; return o; };
  const body = { models };
  const _prev = { minTs: pv, ts: prevAt };
  const env = { DB: null };
  const Response = { json: (b, i) => { out = { body: b, status: (i && i.status) || 200 }; return out; } };
  const fn = new Function("_num", "getStates", "body", "_prev", "env", "Response", "_mt", "_pv", "cors",
    "return (async function(){ " + seg[0] + " return { rewindOK: _rewindOK, rejected: null }; })();");
  return fn(_num, getStates, body, _prev, env, Response, mt, pv, {}).then(r => ({ r, out }));
}

const M = ["dnn", "gbdt", "boost", "mind"];
const KEYS = { dnn: "dnn_trust", gbdt: "gbdt_model", boost: "lgb_trust", mind: "mind_model" };
const allAt = t => { const o = {}; for (const m of M) o[KEYS[m]] = t; return o; };

console.log("\n① 전진(경계가 앞으로) — 종전대로 통과하는가");
{
  const { out } = await run({ mt: T0, pv: T0 - 30 * DAY, prevAt: T0 - 30 * DAY, models: M, trained: allAt(T0) });
  chk(out === null, "앞으로 가는 경계는 판정부를 건드리지 않는다(그대로 통과)", "전진이 막혔다");
}

console.log("\n② 되감기 — 세대 교체가 확인되면 열리는가");
{
  const prevAt = T0 - 30 * DAY;
  const { r, out } = await run({ mt: T0 - 120 * DAY, pv: T0 - 60 * DAY, prevAt, models: M, trained: allAt(T0) });
  chk(r.rewindOK && out === null,
    "전문가 전원이 창 기록 이후 재학습됐으면 경계를 앞당긴다 — STACK 이 넉 달치를 되찾는다",
    "세대가 교체됐는데도 거부한다 — 고침이 작동하지 않는다");
}

console.log("\n③ 되감기 — 낡은 전문가가 하나라도 남으면 ★거부★ 하는가 (누출 방어)");
{
  const prevAt = T0 - 30 * DAY;
  for (const stale of M) {
    const tr = allAt(T0); tr[KEYS[stale]] = prevAt - DAY;    // 이 하나만 창보다 낡았다
    const { r, out } = await run({ mt: T0 - 120 * DAY, pv: T0 - 60 * DAY, prevAt, models: M, trained: tr });
    chk(!r.rewindOK && out && out.status === 409,
      `${stale} 가 낡으면 거부한다(409) — 그 모델에겐 아직 in-sample 이다`,
      `★${stale} 가 낡았는데도 열어 준다 — 누출이 재발한다★`);
  }
  // 기록이 아예 없는 전문가도 낡은 것으로 본다(모르면 안 믿는다).
  const tr = allAt(T0); delete tr[KEYS.mind];
  const { r, out } = await run({ mt: T0 - 120 * DAY, pv: T0 - 60 * DAY, prevAt, models: M, trained: tr });
  chk(!r.rewindOK && out && out.status === 409,
    "학습 기록이 없는 전문가가 있으면 거부한다(모르면 안 믿는다)", "기록 없는 전문가를 통과시킨다");
}

console.log("\n④ 모르는 모델 이름이 섞이면 거부하는가");
{
  const prevAt = T0 - 30 * DAY;
  const { r, out } = await run({ mt: T0 - 120 * DAY, pv: T0 - 60 * DAY, prevAt,
    models: M.concat(["웬수"]), trained: allAt(T0) });
  chk(!r.rewindOK && out && out.status === 409,
    "이름을 모르는 모델이 끼면 거부한다 — 확인 못 한 것을 확인했다고 하지 않는다",
    "★모르는 모델이 있어도 열어 준다★");
}

console.log("\n⑤ 판정이 min 인가 — max 면 낡은 전문가 하나를 놓친다");
{
  chk(/if \(t < _oldest\) _oldest = t;/.test(S),
    "가장 오래된 전문가를 기준으로 판정한다(min)", "★max 로 판정한다 — 낡은 전문가 하나가 묻힌다★");
  chk(/_rewindOK = isFinite\(_oldest\) && _oldest > _num\(_prev && _prev\.ts, 0\);/.test(S),
    "기준은 '창을 기록한 시각' 이다", "되감기 기준이 다른 값이다");
  chk(/rewound: _rewindOK/.test(S) && /세대 교체로 경계를/.test(S),
    "되감았다는 사실이 응답과 로그에 남는다 — 조용히 열지 않는다", "되감기가 기록에 안 남는다");
}

console.log("\n⑥ 경계가 열린 뒤 ★그 구간에 실제로 닿는가★ (V33.279 만으로는 못 닿았다)");
{
  /* 실측: 경계는 200 으로 통과했는데(2026-05-24 → 2026-01-30) 그 다음 소급생성은 +1건,
     경로도 에폭이었다. 홀드아웃 커서가 ★id 고수위★ 라, 새로 열린 넉 달치는 ts 가 더
     과거라 id 가 더 작고 → id > 커서 가 통째로 걸러냈다. 문은 열렸는데 못 지나갔다. */
  chk(/const _cov = _num\(_ocSt\.covFromTs, 0\);/.test(S),
    "커서가 '어디부터 훑었는가(covFromTs)' 를 함께 기록한다", "★어디부터 훑었는지 기록이 없다 — 빈 구간을 알 수 없다★");
  chk(/if \(_oofMinTs > 0 && _cov > 0 && _oofMinTs < _cov\) \{/.test(S),
    "경계가 '훑은 시작' 보다 앞당겨지면 빈 구간 경로로 간다", "빈 구간 경로가 없다 — 열린 구간에 못 닿는다");
  chk(/WHERE ts >= \? AND ts < \? AND id > \? AND featver = \?/.test(S),
    "빈 구간 질의가 ★두 시각 사이★ 만 훑는다(전체 되감기가 아니다)", "빈 구간 질의가 범위를 안 건다");
  /* ★사본이 생기면 안 된다★ — 그 구간은 종전 경계 아래라 한 번도 안 훑은 곳이어야 한다. */
  chk(/ts >= \? AND ts < \?/.test(S) && !/ts >= \? AND id > \? AND featver = \?[\s\S]{0,80}gapId/.test(S),
    "빈 구간과 평소 구간이 겹치지 않는다(ts < 이미훑은시작) — 사본이 생길 수 없다",
    "두 구간이 겹친다 — 같은 행을 두 번 만든다");
  chk(/if \(_gapTo > 0\) \{[\s\S]{0,220}gapId: lastId/.test(S),
    "빈 구간 회차는 ★구간 커서만★ 전진시킨다(평소 커서는 안 건드린다)",
    "★빈 구간이 평소 커서를 앞으로 튀게 한다 — 신규 수확분을 건너뛴다(V33.205 와 같은 사고)★");
  chk(/covFromTs: _covPrev,\s*gapId: lastId/.test(S),
    "빈 구간 중에는 '훑은 시작' 을 안 바꾼다(다 메운 뒤에 넓힌다)", "커버 시작을 성급히 넓힌다 — 구간을 건너뛴다");
  chk(/covFromTs: _oofMinTs, gapId: 0/.test(S),
    "빈 구간을 다 메우면 '훑은 시작' 을 새 경계까지 넓히고 평소 경로로 돌아간다", "구간 소진 처리가 없다");
  chk(/★신규개방구간 /.test(S),
    "빈 구간을 메우는 중이라는 사실이 로그에 남는다 — '왜 옛 표본이 늘지' 를 다음에 안 묻는다",
    "빈 구간 메우기가 조용히 돈다");
}

console.log(fails === 0 ? "\n✓ 홀드아웃 경계 되감기 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
