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
  chk(/_ocSt\.covFromTs/.test(S),
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

/* ══ ⑦ [V33.289] ★조각검사로는 V33.286 이 안 돈다는 걸 못 잡았다★ ═════════════════
   ⑥ 은 전부 정규식이다. 코드 조각은 전부 있었고 게이트는 초록불이었는데, 운영에서는
   빈 구간 경로가 ★한 번도 안 돌았다★:
       [STACK-BF] +2표본 (★에폭★경로 · 커서 1770747, 에폭 1770744, 누적 32480)
   원인은 조각이 아니라 조각들 사이였다 — covFromTs 의 최초값을 저장부가 ★지금 경계★ 로
   적어, 홀드아웃 회차가 한 번 돌면 "다 훑었다" 고 스스로 선언하고 구간을 봉인했다.
   그래서 여기서는 ★함수를 실제로 돌려서 어떤 행을 읽는지★ 를 본다.
   (V33.284 에서 SEQ 3D 가 통째로 안 그려지는데 네 검사가 전부 통과한 것과 같은 종류다.) */
console.log("\n⑦ 실제로 돌려서 — 열린 구간의 행을 정말 읽는가 (조각이 아니라 동작)");
{
  const M = await import("../src/index.js");
  const FV = M.STACKML.featVer, LFV = M.LUXML.featVer;
  const OLD_B = Date.parse("2026-05-24T00:00:00Z");   // 종전 경계 — 여기서부터만 훑어 뒀다
  const NEW_B = Date.parse("2026-01-30T00:00:00Z");   // V33.279 가 앞당긴 새 경계

  /* 빈 구간 질의가 ★행을 돌려주는★ 상태를 만든다 — 빈 배열을 주면 "구간 소진" 이라
     평소 경로로 넘어가는 것이 정상 동작이라, 경로 분기를 못 본다. 전문가 스텁은 안 두므로
     함수는 행을 읽은 직후 "채점 가능한 전문가가 없다" 로 빠진다 — 우리가 보려는 건
     ★어떤 행을 읽었는가★ 하나다. */
  const GAPROW = [{ id: 7, ts: NEW_B + 1000, market: "kr", symbol: "005930.KS",
                    feat: "[]", label: 1, pnl_pct: 1 }];
  function db(oofCursor, oofMinTs, epochRows) {
    const seen = { gap: null, plain: null, epoch: null, minTsAsked: 0 };
    const state = {
      stack_expert_epoch: { id: 100 },
      stack_bf_cursor: { lastId: 5000, made: 32478 },
      stack_oof_window: { minTs: NEW_B, n: 6931, models: ["dnn", "gbdt", "boost", "mind"] },
      stack_oof_cursor: oofCursor
    };
    return { _seen: seen, prepare(sql) {
      const st = { _a: [],
        bind(...a) { st._a = a; return st; },
        async first() {
          if (/SELECT v FROM state WHERE k = \?/.test(sql)) {
            const v = state[st._a[0]]; return v === undefined ? null : { v: JSON.stringify(v) };
          }
          if (/COUNT\(\*\) AS c FROM stack_samples/.test(sql)) return { c: 6931 };
          if (/MIN\(ts\) AS m FROM stack_samples/.test(sql)) { seen.minTsAsked++; return { m: oofMinTs }; }
          if (/MAX\(id\) AS m FROM ml_samples/.test(sql)) return { m: 20000 };
          return null;
        },
        async all() {
          if (/FROM ml_samples WHERE ts >= \? AND ts < \? AND id > \?/.test(sql)) { seen.gap = st._a.slice(); return { results: GAPROW }; }
          if (/FROM ml_samples WHERE ts >= \? AND id > \?/.test(sql)) { seen.plain = st._a.slice(); return { results: [] }; }
          if (/FROM ml_samples WHERE id > \?/.test(sql)) { seen.epoch = st._a.slice(); return { results: epochRows || [] }; }
          return { results: [] };
        },
        async run() { return { success: true }; } };
      return st;
    }, async batch(a) { for (const x of a) await x.run(); return []; } };
  }

  // (가) 운영이 갇혀 있던 바로 그 상태 — covFromTs 기록 없음 + 이미 만든 표본은 종전 경계부터.
  {
    const d = db({ lastId: 9000, fv: FV }, OLD_B, []);
    await M.stackSampleBackfill(d, {});
    const g = d._seen.gap;
    chk(d._seen.minTsAsked > 0,
      "covFromTs 가 없으면 ★이미 만든 홀드아웃 표본의 최소 ts★ 로 잰다(추측하지 않는다)",
      "★covFromTs 최초값을 재지 않는다 — 저장부가 적는 값을 그대로 믿으면 구간이 봉인된다★");
    chk(!!g, "빈 구간 질의가 ★실제로 발행된다★",
      "★빈 구간 질의가 안 나간다 — 열린 넉 달치에 여전히 못 닿는다(운영에서 본 그 상태)★");
    if (g) {
      chk(g[0] === NEW_B && g[1] === OLD_B,
        `읽는 구간이 새 경계~종전 훑은 시작 사이다 (${new Date(g[0]).toISOString().slice(0, 10)} ~ ${new Date(g[1]).toISOString().slice(0, 10)})`,
        "★구간이 틀렸다: " + JSON.stringify(g) + "★");
      chk(g[2] === 0, "구간 커서는 0 에서 시작한다(그 구간은 한 번도 안 훑었다)", "구간 커서가 0 이 아니다: " + g[2]);
      chk(g[3] === LFV, `표본 판(featVer ${LFV})으로 거른다`, "표본 판을 안 거른다");
      chk(d._seen.plain === null,
        "빈 구간이 남아 있는 동안에는 평소 질의를 안 쓴다(id 고수위가 그 구간을 걸러내니까)",
        "평소 질의로 새 나간다 — 그러면 또 못 닿는다");
    }
  }

  // (나) 빈 구간이 없으면(이미 새 경계부터 훑었다) 빈 구간 경로로 가면 안 된다 — 사본이 생긴다.
  {
    const d = db({ lastId: 9000, fv: FV }, NEW_B, []);
    await M.stackSampleBackfill(d, {});
    chk(d._seen.gap === null && d._seen.plain !== null,
      "빈 구간이 없으면 평소 경로로 간다 — 이미 훑은 곳을 다시 훑지 않는다(사본 방지)",
      "★빈 구간이 없는데도 빈 구간 경로로 간다 — 같은 행이 두 번 표본이 된다★");
  }

  // (다) 기록된 covFromTs 가 있으면 그대로 쓴다(잰 값이 기록을 덮어쓰면 안 된다).
  {
    const REC = Date.parse("2026-04-01T00:00:00Z");
    const d = db({ lastId: 9000, fv: FV, covFromTs: REC }, OLD_B, []);
    await M.stackSampleBackfill(d, {});
    chk(d._seen.minTsAsked === 0 && d._seen.gap && d._seen.gap[1] === REC,
      "기록된 covFromTs 가 있으면 재지 않고 그대로 쓴다(기록 > 추정)",
      "★기록을 무시하고 다시 잰다 — 이미 훑은 구간을 또 훑는다★");
  }

  // (라) 홀드아웃 창 통지가 아직 없으면 아무 것도 열지 않는다.
  {
    const d = db({ lastId: 9000, fv: FV }, OLD_B, [{ id: 101, ts: OLD_B, feat: "[]" }]);
    await M.stackSampleBackfill(d, {});
    chk(d._seen.gap === null,
      "에폭 경로에 읽을 행이 있으면 그 회차는 종전대로 에폭을 쓴다(신규 수확분을 건너뛰지 않는다)",
      "★에폭 행이 있는데 빈 구간으로 새 나간다 — 신규 수확분이 에폭 갱신에 묻힌다★");
  }
}

console.log(fails === 0 ? "\n✓ 홀드아웃 경계 되감기 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
