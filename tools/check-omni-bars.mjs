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

console.log(fails === 0 ? "\n✓ OMNI 원시 봉 저장소 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
