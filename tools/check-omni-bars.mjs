/* ═══════════════════════════════════════════════════════════════════════════
   [V33.418] ★OMNI 데이터층 — 원시 봉 저장소★ 검사

   이 층의 계약은 네 개다. 넷 다 ★조용히 틀리는★ 종류라 실행으로 확인한다:
     ① 덧붙이기만 한다 — 공급자가 60일만 줘도 예전 봉은 남는다(깊이는 우리가 쌓는다)
     ② 같은 시각의 봉은 새 것이 이긴다 — 진행 중이던 마지막 봉이 확정값으로 바뀐다
     ③ 일봉은 날짜로 맞춘다 — 서머타임으로 개장 시각이 한 시간 밀려도 같은 날이 두 줄이 안 된다
     ④ 기준봉으로 묶는다 — 1분봉이 오든 5분봉이 오든 저장되는 칸은 언제나 5분 경계다
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };
const mk = (ts, base) => ({ t: ts.slice(), o: ts.map((_, i) => base + i), h: ts.map((_, i) => base + i + 1),
                            l: ts.map((_, i) => base + i - 1), c: ts.map((_, i) => base + i + 0.5), v: ts.map(() => 100) });

console.log("① ★덧붙이기만 한다★ — 공급자 이력이 짧아도 예전 봉은 남는다");
{
  const old = mk([1000, 1300, 1600, 1900], 10);
  const fresh = mk([1900, 2200], 50);                       // 공급자가 최근 2봉만 줬다
  const m = M._obMerge(old, fresh, 100);
  chk(m.t.join(",") === "1000,1300,1600,1900,2200",
    "예전 3봉 + 겹친 1봉 + 새 1봉 = 5봉 (" + m.t.join(",") + ")",
    "★예전 봉이 사라졌다(" + m.t.join(",") + ") — 공급자 이력 깊이에 묶인다★");
  const m2 = M._obMerge(old, M._obEmpty ? M._obEmpty() : { t: [], o: [], h: [], l: [], c: [], v: [] }, 100);
  chk(m2.t.length === 4, "빈 응답을 합쳐도 ★아무것도 안 지운다★", "★빈 응답이 기존 봉을 지운다★");
}

console.log("\n② ★같은 시각은 새 것이 이긴다★ — 진행 중이던 봉이 확정값으로");
{
  const old = mk([1000, 1300], 10);                         // 1300 봉은 진행 중일 때 받은 값
  const fresh = { t: [1300], o: [99], h: [120], l: [90], c: [111], v: [9999] };
  const m = M._obMerge(old, fresh, 100);
  const j = m.t.indexOf(1300);
  chk(m.c[j] === 111 && m.v[j] === 9999, "1300 봉이 확정값(종가 111·거래량 9999)으로 바뀌었다",
    "★옛 부분 봉이 남았다(종가 " + m.c[j] + ") — 진행 중 값이 굳는다★");
  chk(m.t.length === 2, "같은 시각이 ★두 줄이 안 된다★", "★중복 봉이 생겼다(" + m.t.length + ")★");
}

console.log("\n③ ★상한은 오래된 쪽을 버린다★ · 정렬은 오름차순");
{
  const m = M._obMerge(mk([5000, 1000, 3000, 2000, 4000], 1), null, 3);
  chk(m.t.join(",") === "3000,4000,5000", "상한 3이면 ★최근 3봉★ 을 남긴다 (" + m.t.join(",") + ")",
    "★상한이 최근 봉을 버린다(" + m.t.join(",") + ")★");
  chk(M.OMNIBARS.cap["5m"] >= 17000, "5분봉 보존 상한 " + M.OMNIBARS.cap["5m"] + " ≥ 1년치(≈17,000)",
    "★5분봉 상한이 너무 작다 — 깊이를 못 쌓는다★");
}

console.log("\n④ ★일봉은 날짜로 맞춘다★ — 서머타임에 개장 시각이 밀려도 같은 날이 두 줄이 안 된다");
{
  // 같은 날(2026-03-06, 금)을 서머타임 전후 시각으로 받은 경우를 흉내: 14:30 UTC vs 13:30 UTC
  const a = { t: [Date.UTC(2026, 2, 6, 14, 30) / 1000], o: [1], h: [2], l: [0.5], c: [1.5], v: [10] };
  const b = { t: [Date.UTC(2026, 2, 6, 13, 30) / 1000], o: [1], h: [2], l: [0.5], c: [1.7], v: [12] };
  const m = M._obMerge(M._obNormDaily(a, "us"), M._obNormDaily(b, "us"), 100);
  chk(m.t.length === 1 && m.c[0] === 1.7, "같은 날이 ★한 줄★ 이고 새 값이 이긴다",
    "★같은 날이 " + m.t.length + "줄이다 — 서머타임마다 일봉이 두 배가 된다★");
  chk(m.t[0] === Date.UTC(2026, 2, 6) / 1000, "그 줄의 시각은 현지 날짜 00:00 UTC 다",
    "★날짜 키가 어긋났다★");
  // 한국 — 네이버 일봉은 날짜 문자열
  const kr = M._obBarsFromNaver([{ localDate: "20260306", closePrice: "70,500", openPrice: "70000", highPrice: "71000", lowPrice: "69500", accumulatedTradingVolume: "1234" }], "day");
  chk(kr.t[0] === Date.UTC(2026, 2, 6) / 1000 && kr.c[0] === 70500,
    "네이버 일봉 → 같은 날짜 규칙 · 쉼표 숫자도 읽는다(70,500)", "★네이버 일봉 파싱이 틀렸다★");
}

console.log("\n⑤ ★기준봉(5분)으로 묶는다★ — 무엇이 와도 같은 칸");
{
  // 1분봉 7개: 09:00~09:06 → 5분 칸 두 개(09:00, 09:05)
  const t0 = Date.UTC(2026, 2, 6, 14, 0) / 1000;
  const one = { t: [0, 1, 2, 3, 4, 5, 6].map(i => t0 + i * 60), o: [10, 11, 12, 13, 14, 15, 16],
                h: [10.5, 11.5, 15, 13.5, 14.5, 15.5, 16.5], l: [9.5, 8, 11.5, 12.5, 13.5, 14.5, 15.5],
                c: [10.2, 11.2, 12.2, 13.2, 14.2, 15.2, 16.2], v: [1, 2, 3, 4, 5, 6, 7] };
  const r = M._obResample(one, 300);
  chk(r.t.length === 2 && r.t[0] === t0 && r.t[1] === t0 + 300, "1분봉 7개 → 5분봉 2개(경계 정확)",
    "★묶음 경계가 틀렸다(" + r.t.join(",") + ")★");
  chk(r.o[0] === 10 && r.h[0] === 15 && r.l[0] === 8 && r.c[0] === 14.2 && r.v[0] === 15,
    "첫 칸: 시가=첫 봉 · 고가=최대 · 저가=최소 · 종가=마지막 · 거래량=합",
    "★묶음 규칙이 틀렸다(o" + r.o[0] + " h" + r.h[0] + " l" + r.l[0] + " c" + r.c[0] + " v" + r.v[0] + ")★");
  const same = M._obResample(r, 300);
  chk(JSON.stringify(same) === JSON.stringify(r), "이미 5분봉이면 ★항등★ 이다", "★5분봉을 다시 묶으면 값이 바뀐다★");
}

console.log("\n⑥ ★결측·쓰레기는 버린다★ (야후 null 칸 · 종가 0)");
{
  const y = { chart: { result: [{ timestamp: [100, 200, 300, 400],
    indicators: { quote: [{ close: [10, null, 0, 12], open: [9.9, null, 0, null], high: [10.5, null, 0, 12.5], low: [9.5, null, 0, 11.5], volume: [5, null, 0, 7] }] } }] } };
  const b = M._obBarsFromYahoo(y);
  chk(b.t.join(",") === "100,400", "null·0 종가 칸은 버린다(" + b.t.join(",") + ")", "★결측 칸이 봉으로 들어갔다★");
  chk(b.o[1] === 12, "시가가 없으면 종가로 채운다(고가/저가가 무너지지 않게)", "★결측 시가 처리 틀림★");
  /* 네이버 분봉 시각은 ★KST★ 다. 9시간을 안 빼면 한국 분봉이 전부 9시간 밀려 라벨·세션이
     통째로 어긋난다 — 에러 없이 조용히. 한국장 개장 09:00 KST = 00:00 UTC. */
  const nm = M._obBarsFromNaver([{ localDateTime: "202603060900", currentPrice: 100, openPrice: 99, highPrice: 101, lowPrice: 98, volume: 5 }], "min");
  chk(nm.t[0] === Date.UTC(2026, 2, 6, 0, 0) / 1000,
    "네이버 분봉 09:00 KST → 00:00 UTC (9시간 보정)",
    "★네이버 분봉이 " + ((nm.t[0] - Date.UTC(2026, 2, 6, 0, 0) / 1000) / 3600) + "시간 밀렸다 — 한국 분봉이 통째로 어긋난다★");
  chk(M._obBarsFromYahoo(null).t.length === 0 && M._obBarsFromNaver(null, "min").t.length === 0,
    "빈 응답은 빈 봉(예외 없음)", "★빈 응답에서 죽는다★");
}

console.log("\n⑦ ★수집은 I/O 만 한다★ · 배선 · 경로");
{
  const i = S.indexOf("async function omniBarsCollect(");
  const body = S.slice(i, S.indexOf("\n}\n", i));
  chk(!/mlBuildFeatures|_gbdtFit|_speakPoint|lightgbm/.test(body),
    "수집기가 ★피처 계산·학습을 하지 않는다★(워커 CPU 원칙)", "★수집기가 계산을 한다★");
  chk(/_obMerge\(old, fresh, OMNIBARS\.cap\[res\]\)/.test(body), "받은 것을 ★합친다★(덮어쓰지 않는다)",
    "★받은 것으로 덮어쓴다★");
  chk(/omnibars_index/.test(body) && /omnibars_cursor/.test(body), "색인과 커서를 갱신한다", "★색인/커서가 없다★");
  chk(/if \(path === "\/api\/omni-bars-index"\)/.test(S) && /if \(path === "\/api\/omni-bars"\)/.test(S),
    "학습기용 내보내기 두 개가 있다", "★내보내기가 없다★");
  /* 고정폭 창을 쓰지 않는다 — 이 저장소에서 반복해서 틀린 방식이다. 중괄호 균형으로 블록을 자른다. */
  const blockAt = (needle) => {
    const i0 = S.indexOf(needle); if (i0 < 0) return "";
    let d = 0;
    for (let k = S.indexOf("{", i0); k < S.length && k > 0; k++) {
      if (S[k] === "{") d++; else if (S[k] === "}") { d--; if (!d) return S.slice(i0, k + 1); }
    }
    return "";
  };
  const ex = blockAt('if (path === "/api/omni-bars") {');
  chk(/_trainAuthed\(\)/.test(ex), "내보내기는 ★인증★ 뒤에 있다", "★인증 없이 봉을 내준다★");
  chk(/\.slice\(0, 25\)/.test(ex), "한 번에 25종목 상한", "★상한이 없다★");
  chk(/\["omnibars", function \(DB\)/.test(S), "야간 파이프라인 단계로 등록돼 있다", "★야간 단계가 없다★");
  chk(/const _obr = await omniBarsCollect\(env\.DB, \{\}\);/.test(S), "크론 틱에서도 돈다(잠금 뒤)", "★크론 수집이 없다★");
}

/* ── [V33.421] ★요청한 간격이 오는가★ — 첫 실데이터 학습에서 미국 일봉이 사실상 0 행이었다 ── */
{
  console.log("\n■ 일봉 간격(V33.421)");
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
  const i0 = S.indexOf("async function _obFetch("); let d = 0, k = S.indexOf("{", i0), e = k;
  for (; e < S.length; e++) { if (S[e] === "{") d++; else if (S[e] === "}") { d--; if (d === 0) break; } }
  const F = strip(S.slice(i0, e + 1));
  chk(!/range=max/.test(F) && !/usRange\[res\]/.test(F), "미국 일봉을 range=max 로 받지 않는다", "★미국 일봉이 range=max 경로를 탄다★(굵은 간격이 온다)");
  chk(/interval=1d&period1=/.test(F) && /period2=/.test(F), "미국 일봉은 period1/period2 로 기간을 못 박는다", "미국 일봉에 period1/period2 가 없다");
  const day = { t: Array.from({ length: 40 }, (_, q) => 1700000000 + Math.floor(q * 7 / 5) * 86400) };
  const mon = { t: Array.from({ length: 40 }, (_, q) => 1700000000 + q * 30 * 86400) };
  const m5 = { t: Array.from({ length: 200 }, (_, q) => 1700000000 + q * 300 + Math.floor(q / 78) * 60000) };
  chk(M._obSpacingOk(day, "1d") && !M._obSpacingOk(mon, "1d"), "간격 검사: 일봉은 받고 월 간격 '일봉' 은 거부한다",
      "간격 검사가 월봉을 일봉으로 받거나 일봉을 거부한다");
  chk(M._obSpacingOk(m5, "5m") && !M._obSpacingOk(day, "5m"), "간격 검사: 5분봉은 받고 일 간격 '5분봉' 은 거부한다",
      "간격 검사가 5분봉 해상도를 못 가른다");
  const i1 = S.indexOf("async function omniBarsCollect("); let d2 = 0, k2 = S.indexOf("{", i1), e2 = k2;
  for (; e2 < S.length; e2++) { if (S[e2] === "{") d2++; else if (S[e2] === "}") { d2--; if (d2 === 0) break; } }
  const C = strip(S.slice(i1, e2 + 1));
  const iOk = C.indexOf("_obSpacingOk(fresh, res)"), iPut = C.indexOf("R2.put(");
  chk(iOk > 0 && iPut > iOk, "간격이 틀린 응답은 ★저장 전에★ 거른다", "간격 검사가 저장 뒤에 있거나 없다");
  /* [V33.427] 판 판정은 _obPrevFor 로 옮겼다 — 아래 ⑥ 이 월 간격 '일봉' 을 실제로 흘려 거부를 확인한다. */
  chk(/const pv = await _obPrevFor\(R2, res, sym, meta\);/.test(C) && /_obSpacingOk\(old, res\)/.test(S),
      "옛 판 파일은 합치지 않는다 — 굵은 봉이 새 일봉에 섞여 남지 않는다", "옛 판(굵은 봉)을 새 봉과 합친다");
  chk(M.OMNIBARS.ver["1d"] >= 2, "일봉 저장 판이 올라갔다(옛 range=max 파일을 새로 받는다)", "일봉 판이 그대로다 — 옛 굵은 파일이 신선하다고 건너뛴다");
  chk(/v: OMNIBARS\.ver\[res\]/.test(C) && /g: fresh\.g/.test(C), "색인에 판과 ★실제로 온 간격★ 을 적는다(학습기 로그에 나온다)", "색인에 판·간격이 없다");
}

console.log("\n⑥ [V33.427] ★못 읽었으면 쓰지 않는다 · 색인은 캐시다★ — 실제 실패를 흘려 넣어 본다");
/* 실측(2026-09-24): D1 읽기 오류 한 번에 수집기가 빈 색인으로 시작했고, 다시 받은 종목의 쌓인 봉을
   새 창만으로 덮어썼으며, 끝에 1,008칸 색인을 40칸으로 덮었다 — 커버리지가 294/1008 로 떨어졌다. */
{
  const fakeDB = (mode) => ({ prepare: () => ({ bind: () => ({ first: async () => {
    if (mode === "throw") throw new Error("D1_ERROR: overloaded");
    if (mode === "none") return null;
    return { v: JSON.stringify({ v: 1, s: { AAA: { m: "us" } } }) };
  } }) }) });
  const r1 = await M._obIndexLoad(fakeDB("throw"));
  chk(r1.ok === false, "색인 읽기 ★실패★ 는 실패로 돌아온다(빈 색인으로 바꿔치지 않는다)",
      "★D1 오류를 빈 색인으로 돌려준다 — 수집기가 1,008칸 색인을 덮어쓴다★");
  const r2 = await M._obIndexLoad(fakeDB("none"));
  chk(r2.ok === true && r2.fresh === true && Object.keys(r2.index.s).length === 0, "행이 정말 없으면 첫 회차다(빈 색인 OK)",
      "첫 회차를 실패로 본다 — 수집이 영영 시작 못 한다");
  const r3 = await M._obIndexLoad(fakeDB("ok"));
  chk(r3.ok === true && r3.index.s.AAA, "정상 행은 그대로 읽는다", "정상 색인을 못 읽는다");

  const five = { t: [0, 300, 600, 900, 1200, 1500], o: [1,1,1,1,1,1], h: [1,1,1,1,1,1], l: [1,1,1,1,1,1], c: [1,1,1,1,1,1], v: [1,1,1,1,1,1] };
  const monthly = { t: [0, 2592000, 5184000, 7776000, 10368000, 12960000], o: [1,1,1,1,1,1], h: [1,1,1,1,1,1], l: [1,1,1,1,1,1], c: [1,1,1,1,1,1], v: [1,1,1,1,1,1] };
  const fakeR2 = (obj, thrw) => ({ get: async () => { if (thrw) throw new Error("R2 503"); return obj === null ? null : { text: async () => JSON.stringify(obj) }; } });
  const p1 = await M._obPrevFor(fakeR2(null, true), "5m", "AAA", { v: 1 });
  chk(p1.ok === false, "옛 파일 읽기 ★실패★ 면 ok=false — 그 종목은 이번에 안 쓴다(덮어쓰지 않는다)",
      "★옛 파일을 못 읽었는데 '없다' 로 보고 새 창만으로 덮어쓴다 — 쌓은 이력이 사라진다★");
  const p2 = await M._obPrevFor(fakeR2(null), "5m", "AAA", undefined);
  chk(p2.ok === true && p2.old === null, "파일이 정말 없으면 처음이다", "없는 파일을 오류로 본다");
  const p3 = await M._obPrevFor(fakeR2(Object.assign({ ver: M.OMNIBARS.ver["5m"] }, five)), "5m", "AAA", undefined);
  chk(p3.ok && p3.old && p3.old.t.length === 6, "★색인이 그 종목을 잊었어도★ 파일에 판이 맞으면 합친다",
      "★색인에 없다는 이유로 쌓인 봉을 버린다★");
  const p4 = await M._obPrevFor(fakeR2(five), "5m", "AAA", undefined);
  chk(p4.ok && p4.old && p4.old.t.length === 6, "판 표시가 없는 옛 파일도 간격이 5분이면 합친다(기존 파일 구제)",
      "★판 표시 전의 파일을 전부 버린다 — 지금 R2 에 있는 봉이 전부 그렇다★");
  const p5 = await M._obPrevFor(fakeR2(monthly), "1d", "AAA", undefined);
  chk(p5.ok && p5.old === null, "대조: 간격이 한 달인 옛 '일봉' 은 합치지 않는다(판을 올린 이유 그대로)",
      "★굵은 봉(월 간격)을 일봉에 섞는다★");
  const p6 = await M._obPrevFor(fakeR2(five), "5m", "AAA", { v: M.OMNIBARS.ver["5m"] });
  chk(p6.ok && p6.old, "색인이 판 일치를 말하면 합친다", "정상 경로가 깨졌다");

  const col = (() => { const i = S.indexOf("async function omniBarsCollect("); let d = 0, k = S.indexOf("{", i);
    for (; k < S.length; k++) { if (S[k] === "{") d++; else if (S[k] === "}") { d--; if (d === 0) break; } } return S.slice(i, k + 1); })();
  const iFail = col.indexOf("if (!_ixr.ok) return"), iWrite = col.indexOf('setState(DB, "omnibars_index"');
  chk(iFail > 0 && iWrite > iFail && !/getState\(DB, "omnibars_index"/.test(col),
      "수집기는 색인을 strict 로 읽고, 실패하면 ★쓰기 전에★ 물러난다",
      "★수집기가 색인 읽기 실패 뒤에도 끝까지 가서 색인을 덮어쓴다★");
  /* ★v 는 거래량이다★ — 판 표시를 merged.v 로 적으면 거래량 배열이 숫자로 덮인다(실제로 그렇게 짰다가 여기서 잡혔다). */
  chk(!/merged\.v\s*=/.test(col) && !/\bold\.v\b/.test(S.slice(S.indexOf("async function _obPrevFor"), S.indexOf("async function _obPrevFor") + 1500)),
      "판 표시가 ★거래량 칸(v)★ 을 건드리지 않는다", "★판 표시를 v 에 적는다 — 모든 봉 파일의 거래량이 숫자 하나로 덮인다★");
  chk(/if \(!pv\.ok\) \{ prevFail\+\+; failed\+\+; continue; \}/.test(col) && /merged\.ver = OMNIBARS\.ver\[res\];/.test(col),
      "옛 파일을 못 읽으면 그 해상도는 건너뛴다 · 파일에 판을 적는다",
      "옛 파일 읽기 실패 뒤에도 덮어쓴다 — 또는 파일이 판을 모른다");
  chk(/const _ixr = await _obIndexLoad\(env\.DB\);\s*\n\s*if \(!_ixr\.ok\) return Response\.json\(\{ error: "색인 읽기 실패/.test(S) && /universe: \(DEFAULT_US/.test(S),
      "학습기용 색인 엔드포인트는 실패를 503 으로 말하고 유니버스를 같이 준다",
      "★엔드포인트가 D1 오류를 빈 색인으로 돌려준다 — 학습기가 조용히 0종목으로 돈다★");
}

console.log(fails === 0 ? "\n✓ OMNI 원시 봉 저장소 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
