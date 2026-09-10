/* [V33.334] 학습표본 제자리 이관 — ★표본을 죽이지 않고 판을 올렸는가★
 *
 *   사용자 지시: "피처 통합하는데 이거 학습표본 안 죽게 기존에 있는 데이터로 dma 스토캐스틱
 *   전부 계산해서 학습표본에 넣은 다음에 학습시켜 모델들 안죽게 잘처리해봐".
 *
 *   종전 방식은 featVer 를 올리고 옛 표본을 버린 뒤 딥이력에서 다시 수확하는 것이었다.
 *   되긴 하지만 ★며칠 동안 위원 전원이 굶는다★ — 표본이 0 에서 다시 자라기 때문이다.
 *   그래서 지우지 않고 옮긴다. 이 검사가 무는 것은 그 이관의 세 가지 성질이다:
 *     ① 앞칸이 한 칸도 밀리지 않는다 (밀리면 51만 표본의 뜻이 통째로 어긋난다 — 복구 불가)
 *     ② 이력이 없으면 지어내지 않고 dsKnown=0 으로 "모른다"고 적는다
 *     ③ ★이관이 끝나기 전엔 구판 정리가 멈춘다★ — 안 그러면 이관 대상이 먼저 지워진다
 */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.error("  FAIL " + m); };
const code = S.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
const names = M.LUXML.featNames, D = names.length, SN = M.DS_FEATS.length;

// ── ① 그 시점 값을 실제 이력에서 되계산하는가 ───────────────────────────
{
  /* ★거래일만 담긴 배열★ 로 만든다 — 실제 daily 캐시가 그렇다(주말·공휴일에는 봉이 없다).
     연속 배열로 시험하면 휴장 보정을 시험한 게 아니라 아무것도 시험하지 않은 것이 된다. */
  const closes = [], highs = [], lows = [], days = [];
  const day0 = Math.floor(Date.parse("2025-01-02T00:00:00Z") / 86400000);
  let dcur = day0;
  for (let i = 0; i < 300; i++) {
    const c = 100 + i * 0.35 + Math.sin(i / 5) * 2.2;
    closes.push(c); highs.push(c * 1.012); lows.push(c * 0.988); days.push(dcur);
    dcur += ((i % 5) === 4) ? 3 : 1;              // 금요일 다음은 월요일(주말 2일 건너뛴다)
  }
  const at = 200;
  const ts = days[at] * 86400000;
  const bi = M._dsBarIndex(days, ts);
  if (bi === at) ok(`표본 ts 로 봉 위치를 정확히 찾는다(${at}번째 봉)`);
  else bad(`봉 위치를 못 찾는다: ${bi} (기대 ${at})`);
  // 주말·공휴일에 찍힌 ts 는 ★직전 거래일 봉★ 으로 내려가야 한다
  const fri = days.indexOf(days.find((d, i) => (i % 5) === 4 && i > 100));
  const satTs = (days[fri] + 2) * 86400000;
  if (M._dsBarIndex(days, satTs) === fri) ok("주말에 찍힌 ts 는 직전 거래일 봉을 쓴다(허용오차 안)");
  else bad(`휴장 보정이 안 된다: ${M._dsBarIndex(days, satTs)} (기대 ${fri})`);
  if (M._dsBarIndex(days, ts + 40 * 86400000) !== -1) {
    // 40일 뒤에도 봉이 있으면 그 봉을 쓰는 게 맞다 — 허용오차는 '봉이 없을 때'의 이야기다.
    const gapTs = (days[days.length - 1] + 40) * 86400000;
    if (M._dsBarIndex(days, gapTs) === -1) ok("마지막 봉에서 40일이나 지난 ts 는 -1 — 엉뚱한 봉을 갖다 쓰지 않는다");
    else bad("허용오차 밖인데도 봉을 갖다 쓴다");
  } else ok("허용오차 밖 ts 에는 -1 을 준다");
  if (M._dsBarIndex(null, ts) === -1 && M._dsBarIndex(days, 0) === -1) ok("days 나 ts 가 없으면 -1");
  else bad("결측 입력에 -1 을 안 준다");

  const v = M._dsFeats(closes.slice(0, at + 1), highs.slice(0, at + 1), lows.slice(0, at + 1));
  if (v.dsKnown === 1 && v.dmaPct > 0 && v.stochSlowK >= 0 && v.stochSlowK <= 100)
    ok(`이력이 있으면 실측값을 낸다(dmaPct ${v.dmaPct.toFixed(2)}% · %K ${v.stochSlowK.toFixed(0)} · dsKnown 1)`);
  else bad("실측값 계산이 틀렸다: " + JSON.stringify(v));
  const short = M._dsFeats(closes.slice(0, 30), null, null);
  if (short.dsKnown === 0 && short.stochSlowK === 50 && short.dmaPct === 0)
    ok("이력이 모자라면 중립 + dsKnown=0 — 지어내지 않고 '모른다'고 적는다");
  else bad("짧은 이력에서 값을 지어낸다: " + JSON.stringify(short));
}

// ── ② ★앞칸이 밀리지 않는가★ — 밀리면 복구 불가능한 사고다 ─────────────
{
  const oldVec = Array.from({ length: D - SN }, (_, j) => j * 0.5 - 3);
  const vals = { dmaPct: 1.5, dmaGap: -0.4, stochSlowK: 72.5, stochSlowD: 68.1, dsKnown: 1 };
  const nx = M._featBackfillX(oldVec, Date.parse("2026-05-05T00:00:00Z"), vals);
  if (nx && nx.length === D && oldVec.every((v, j) => nx[j] === v))
    ok(`옛 ${D - SN}칸이 한 칸도 안 밀리고 ${D}칸이 된다`);
  else bad("★앞칸이 밀렸다 — 기존 표본 전체의 뜻이 어긋난다★");
  const tailOk = M.DS_FEATS.every((n, i) => nx[D - SN + i] === vals[n]);
  if (tailOk) ok("새 5칸이 featNames 꼬리 순서 그대로 실린다");
  else bad("새 값이 이름 순서와 어긋나게 실린다");
  const neu = M._featBackfillX(oldVec, Date.parse("2026-05-05T00:00:00Z"), null);
  if (neu && neu[names.indexOf("dsKnown")] === 0 && neu[names.indexOf("stochSlowK")] === 50)
    ok("값을 못 구하면 중립으로 폭만 맞추고 dsKnown=0 을 남긴다");
  else bad("중립 채움이 잘못됐다");
}

// ── ③ ★이관이 끝나기 전엔 구판을 지우지 않는가★ ────────────────────────
{
  if (/const _migPend = await mlFeatMigPending\(DB\);/.test(code) &&
      /if \(_migPend\) \{[\s\S]{0,400}\} else \{[\s\S]{0,600}DELETE FROM ml_samples WHERE id IN/.test(code))
    ok("ml_samples 구판 정리가 이관 완료 여부를 ★먼저 물어본다★");
  else bad("★구판 정리가 이관을 모른 채 돈다 — 이관 대상이 먼저 지워진다★");
  if (/if \(!_migPend\) try \{\n\s*const _altPrune = \[/.test(code))
    ok("ml_samples_st 등 나머지 표 정리도 같은 조건에 걸린다");
  else bad("alt 표 정리가 이관과 무관하게 돈다 — 단타 표본이 먼저 지워진다");
  // 모르면 지우지 않는다 — 상태를 못 읽을 때의 기본값
  /* ★이관 중에는 학습도 미뤄야 한다.★ 반쪽 표본으로 배우면 정확도가 낮게 나오고
     신뢰게이트가 모델을 강등시킨다 — 데이터는 멀쩡한데 위원이 내려앉는 사고다. */
  if (/if \(await mlFeatMigPending\(DB\)\) \{\n\s*return "\[ML\] 표본 이관 중/.test(S))
    ok("야간 학습이 이관 중이면 보류한다 — 반쪽 표본으로 배워 모델이 강등되는 것을 막는다");
  else bad("★이관 중에도 학습이 돈다 — 옮겨진 일부만 보고 배워 모델이 강등된다★");
  const src = S.slice(S.indexOf("async function mlFeatMigPending(DB)"), S.indexOf("async function mlMarketHarvestNightly"));
  if (/catch \(e\) \{ return true; \}/.test(src) && /if \(!st\) return true;/.test(src))
    ok("상태를 못 읽거나 아직 시작 전이면 '이관 중'으로 본다 — 모르면 지우지 않는다");
  else bad("상태를 모를 때 지우는 쪽으로 기운다");
}

// ── ④ 이관을 ★실제로 돌려★ 표본이 살아남는지 본다 ──────────────────────
{
  const day0 = Math.floor(Date.parse("2025-01-02T00:00:00Z") / 86400000);
  const closes = [], highs = [], lows = [], days = [];
  for (let i = 0; i < 300; i++) {
    const c = 100 + i * 0.3 + Math.sin(i / 6) * 2;
    closes.push(c); highs.push(c * 1.01); lows.push(c * 0.99); days.push(day0 + i);
  }
  const daily = { closes, highs, lows, days, ts: Date.now() };
  const rows = [];
  for (let i = 0; i < 40; i++) {
    rows.push({ id: i + 1, ts: (day0 + 120 + i) * 86400000, symbol: "AAA",
      feat: JSON.stringify(Array.from({ length: D - SN }, (_, j) => (j + i) % 7)), featver: M.LUXML.featVer - 1 });
  }
  // 이력이 없는 종목 — 버리지 않고 중립으로 살아남아야 한다
  for (let i = 0; i < 10; i++) {
    rows.push({ id: 100 + i, ts: (day0 + 150) * 86400000, symbol: "NOHIST",
      feat: JSON.stringify(Array.from({ length: D - SN }, () => 1)), featver: M.LUXML.featVer - 1 });
  }
  // ★일봉 캐시를 실제로 심어 둔다★ — 안 심으면 전부 '이력 없음'으로 떨어져,
  //   "실측값을 되계산한다"는 이 검사의 핵심이 아무것도 시험하지 않게 된다.
  const state = { "daily:AAA": JSON.stringify(daily) };
  const DB = {
    prepare(sql) {
      const q = { sql, args: [] };
      q.bind = (...a) => { q.args = a; return q; };
      q.first = async () => {
        if (/FROM state WHERE k = \?/.test(sql)) { const v = state[q.args[0]]; return v ? { v } : null; }
        return null;
      };
      q.all = async () => {
        if (/FROM (ml_samples|ml_samples_st) WHERE featver = \? AND id > \?/.test(sql)) {
          const tb = /ml_samples_st/.test(sql) ? "st" : "main";
          if (tb === "st") return { results: [] };
          const [fv, lastId, lim] = q.args;
          return { results: rows.filter((r) => r.featver === fv && r.id > lastId)
            .sort((a, b) => a.id - b.id).slice(0, lim) };
        }
        return { results: [] };
      };
      q.run = async () => {
        if (/INSERT INTO state/.test(sql)) { state[q.args[0]] = q.args[1]; return { meta: {} }; }
        return { meta: {} };
      };
      return q;
    },
    async batch(stmts) {
      for (const st of stmts) {
        if (/UPDATE ml_samples SET feat = \?, featver = \? WHERE id = \?/.test(st.sql)) {
          const [feat, fv, id] = st.args;
          const r = rows.find((x) => x.id === id);
          if (r) { r.feat = feat; r.featver = fv; }
        }
      }
      return [];
    }
  };
  DB.prepare = DB.prepare.bind(DB);
  // getState 는 state 테이블을 읽으므로 위 stub 으로 동작한다.
  const before = rows.length;
  let guard = 0, res = null;
  while (guard++ < 20) {
    res = await M.mlFeatMigrate(DB, { runMs: 400 });
    if (res && res.done) break;
  }
  const after = rows.length;
  const migrated = rows.filter((r) => r.featver === M.LUXML.featVer).length;
  const widths = new Set(rows.map((r) => { try { return JSON.parse(r.feat).length; } catch (e) { return -1; } }));

  if (after === before) ok(`이관 전후 표본 수가 같다(${before}건) — ★한 건도 버리지 않았다★`);
  else bad(`표본이 ${before} → ${after} 로 줄었다 — 이관이 표본을 잃는다`);
  if (migrated === before) ok(`전부 새 판(featVer ${M.LUXML.featVer})으로 옮겨졌다`);
  else bad(`${migrated}/${before} 만 옮겨졌다`);
  if (widths.size === 1 && widths.has(D)) ok(`모든 표본이 ${D}칸이 됐다(폭이 섞이지 않는다)`);
  else bad(`폭이 섞였다: ${[...widths].join(",")}`);
  const known = rows.filter((r) => { try { const x = JSON.parse(r.feat); return x[names.indexOf("dsKnown")] === 1; } catch (e) { return false; } }).length;
  if (known === 40) ok(`이력이 있는 40건은 실측값(dsKnown=1), 이력 없는 10건은 중립(dsKnown=0)으로 구분된다`);
  else bad(`실측/중립 구분이 틀렸다: 실측 ${known}건 (기대 40)`);
  if (res && res.done) ok("이관이 완료 상태로 마감된다 — 그때부터 구판 정리가 재개된다");
  else bad("이관이 끝나지 않는다 — 구판 정리가 영영 멈춘다");
  // getState 로 daily 를 읽는 경로가 stub 에 없어 NOHIST 와 AAA 모두 중립이 될 수 있다 —
  // 그 경우 위 known 검사가 먼저 실패하므로 여기서 별도 처리는 하지 않는다.
}

if (fails) { console.error(`\n✗ 표본 이관 계약 ${fails}건 실패`); process.exit(1); }
console.log("\n✓ 표본 이관 계약 통과 — 판을 올리면서 표본을 한 건도 버리지 않는다");
