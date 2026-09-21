/* ═══════════════════════════════════════════════════════════════════════════
   [V33.404] 수확기의 지수·섹터 정렬 — 봉 수로 맞추면 달력이 어긋난다

   ■ 어떻게 드러났나
     Modal 로그의 [퇴화칸] 이 학습구간에서 ★최빈 100%★ 인 칸으로 이것들을 찍었다:
       regBear · rs20 · sectorRs20 · sectorBeta
     그런데 수확기는 idxCloses·sectorCloses 를 ★넘기고 있었다.★ 그럼 왜 상수인가 —
     폴백값을 직접 재 보면 서명이 나온다(이 검사 ③ 이 실행해서 확인한다):
       지수·섹터가 없을 때 rs20·rs60·corrIdx·rsiRel·idxTrend·idxVol·idxMom20·sectorRs20 → 0
                            ★betaIdx · volRatioRel · sectorBeta → 1★ · idxRsi → 0.5
     ★베타 1 은 실제로 나올 수 있는 값★ 이라 "모른다" 와 구별되지 않는다 —
     달력의 fomcTo=0 과 같은 충돌이다.

   ■ 원인
     "봉 i 시점 = 지수 끝에서 (L−1−i)봉 전" 은 두 계열이 ★같은 거래일 집합★ 을 가질 때만 참이다.
     실제로는 다르다 — KR 종목 딥이력은 네이버, ^KS11 은 야후라 길이가 애초에 안 맞고(V32.5),
     휴장일도 어긋난다. 어긋나면 옛 봉일수록 idxEnd 가 작아져 결국 0 이하 → idxHist = null
     → 그 봉의 지수 상대 피처가 통째로 폴백된다.
     게다가 딥이력은 days 를 싣고 오는데 ★캐시가 closes 만 꺼내 써서 날짜를 버리고 있었다.★

   ■ 고침과 그 계약
     V33.217 이 소급생성에서 쓴 규칙 그대로 — "봉 날짜가 있으면 추정하지 않는다."
     ★같은 함수(_altBarIdx)를 재사용한다★ (두 벌이 되면 언젠가 갈라진다).
     days 가 없는 옛 캐시는 종전 봉 수 세기로 떨어진다(다리). 어느 쪽을 썼는지 센다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

console.log("① 딥이력의 날짜를 캐시가 들고 오는가");
chk(/if \(Array\.isArray\(hd\.days\) && hd\.days\.length === hd\.closes\.length\) idxDays\[mk\] = hd\.days;/.test(S),
  "지수 캐시가 days 를 함께 싣는다(길이가 맞을 때만)",
  "★지수 days 를 버린다 — 봉 수로 맞출 수밖에 없다★");
chk(/secDays\[etf\] = sd\.days/.test(S), "섹터 ETF 캐시도 days 를 함께 싣는다",
  "★섹터 days 를 버린다★");

console.log("\n② 날짜로 맞추는가 · 같은 함수를 쓰는가 · 옛 캐시 다리는 남았는가");
chk(/const _k = _altBarIdx\(idxAll\.length, _barTs, _hvNow, _idD\);/.test(S),
  "지수를 ★_altBarIdx★(소급생성과 같은 함수)로 찾는다 — 날짜 검색이 두 벌이 되지 않는다",
  "★지수 정렬이 자기 날짜 검색을 따로 구현했다 — 두 구현은 언젠가 갈라진다★");
chk(/const _k2 = _altBarIdx\(_sc\.length, _barTs, _hvNow, _sdD\);/.test(S),
  "섹터도 같은 함수로 찾는다", "★섹터가 다른 방식으로 찾는다★");
chk(/idxEnd = idxAll\.length - \(L - 1 - i\);\s*\n\s*_hvAlign\.idxCount\+\+;/.test(S),
  "days 가 없으면 종전 봉 수 세기로 떨어진다(옛 캐시용 다리) — 그때 그렇다고 센다",
  "★폴백 경로가 사라졌다 — days 없는 캐시에서 지수 피처가 통째로 죽는다★");
chk(/idxEnd = _k >= 0 \? _k \+ 1 : 0;/.test(S) && /secEnd = _k2 >= 0 \? _k2 \+ 1 : 0;/.test(S),
  "slice 끝이 배타적이라 +1 한다(그 봉 자신을 포함한다)",
  "★+1 을 안 해 그 봉이 빠진다(하루 어긋난다)★");

console.log("\n③ ★결측 폴백이 실제 값과 충돌하는가 — 실행해서 확인★");
{
  const N = M.LUXML.featNames, ix = (n) => N.indexOf(n);
  const closes = Array.from({ length: 400 }, (_, i) => 100 + Math.sin(i / 9) * 5 + i * 0.05);
  const base = { closes: closes, volumes: closes.map(() => 1e6), opens: closes,
                 highs: closes.map((v) => v * 1.01), lows: closes.map((v) => v * 0.99),
                 price: closes[399], prevClose: closes[398], dayPct: 0.3,
                 market: "us", strategy: "hv", ev: {}, obsTs: Date.parse("2022-06-15T00:00:00Z") };
  const idx = Array.from({ length: 400 }, (_, i) => 3000 + i * 2);
  const sec = Array.from({ length: 400 }, (_, i) => 50 + i * 0.1);
  const A = M.mlBuildFeatures(Object.assign({}, base, { regime: "NEUTRAL" }));
  const B = M.mlBuildFeatures(Object.assign({}, base, { regime: "BULL", idxCloses: idx, sectorCloses: sec }));
  const ones = ["betaIdx", "volRatioRel", "sectorBeta"];
  for (const k of ones) {
    const i = ix(k);
    if (i < 0) { console.log("  FAIL 피처 " + k + " 가 없다"); fails++; continue; }
    if (A[i] !== 1) { console.log("  FAIL " + k + " 의 결측 폴백이 1 이 아니다(" + A[i] + ") — 이 검사의 전제가 바뀌었다"); fails++; }
  }
  console.log("  ok   결측 폴백이 ★1★ 인 칸 3종(betaIdx · volRatioRel · sectorBeta) — 실제 값과 구별되지 않는다");
  const moved = N.filter(function (n, i) { return A[i] !== B[i]; });
  chk(moved.length >= 8,
    "지수·섹터를 주면 " + moved.length + "칸이 움직인다 — 빈손 정렬 한 번이 그만큼을 폴백으로 만든다",
    "★지수·섹터가 있으나 없으나 거의 같다(" + moved.length + "칸) — 배선이 끊겼을 수 있다★");
}

console.log("\n④ ★날짜 정렬이 봉 수 세기보다 실제로 낫는가 — _altBarIdx 를 돌려 본다★");
{
  // 종목 1,600봉 · 지수 1,200봉, 둘 다 오늘 끝. 봉 수 세기는 옛 봉에서 idxEnd ≤ 0 으로 무너진다.
  const day0 = Math.floor(Date.parse("2020-01-02T00:00:00Z") / 86400000);
  const stockDays = Array.from({ length: 1600 }, (_, i) => day0 + i);
  const idxDays = Array.from({ length: 1200 }, (_, i) => day0 + 400 + i);   // 지수는 400일 뒤부터
  const L = stockDays.length, now = (day0 + 1599) * 86400000;
  let cntBroken = 0, dateOk = 0, dateMiss = 0;
  for (let i = 0; i < L; i += 37) {
    const barTs = stockDays[i] * 86400000;
    if (idxDays.length - (L - 1 - i) <= 0) cntBroken++;                      // 종전 방식
    const k = M._altBarIdx(idxDays.length, barTs, now, idxDays);             // 새 방식
    if (k >= 0) dateOk++; else dateMiss++;
  }
  chk(cntBroken > 0, "봉 수 세기는 옛 봉 " + cntBroken + "개 지점에서 무너진다(idxEnd ≤ 0)",
    "이 시나리오에서 봉 수 세기가 안 무너진다 — 시험이 무의미하다");
  chk(dateOk > cntBroken,
    "날짜 정렬은 " + dateOk + "개 지점을 찾아낸다(못 찾음 " + dateMiss + " = 지수가 정말 없는 구간)",
    "★날짜 정렬이 봉 수 세기보다 낫지 않다★");
  // 날짜 정렬은 ★미래 봉을 절대 고르지 않는다★ (룩어헤드 금지)
  let ahead = 0;
  for (let i = 0; i < L; i += 53) {
    const k = M._altBarIdx(idxDays.length, stockDays[i] * 86400000, now, idxDays);
    if (k >= 0 && idxDays[k] > stockDays[i]) ahead++;
  }
  chk(ahead === 0, "찾은 지수 봉이 ★그 종목 봉보다 미래인 적이 없다★(룩어헤드 0)",
    "★미래 지수 봉을 고른다 — 백테스트 사기다(" + ahead + "건)★");
}

console.log("\n⑤ 무엇을 했는지 로그가 말하는가");
{
  /* ★'적혀 있다' 와 '센다' 는 다르다.★ 처음 이 검사를 이름 존재로만 썼더니
     `if (!idxHist) _hvAlign.idxNull++;` 를 통째로 지운 돌연변이를 놓쳤다 —
     출력 문자열에 이름이 남아 있어 통과해 버린다(그러면 로그는 영원히 0 을 찍는다).
     → ★증가시키는 곳★ 과 ★출력하는 곳★ 을 따로 확인한다. */
  for (const k of ["idxDate", "idxCount", "idxMiss", "idxNull", "secDate", "secCount", "secMiss", "secNull"]) {
    const inc = new RegExp("_hvAlign\\." + k + "\\+\\+").test(S);
    const out = new RegExp("_hvAlign\\." + k + "\\s*\\+").test(S) || new RegExp('"\\s*\\+\\s*_hvAlign\\.' + k).test(S);
    if (!inc) { console.log("  FAIL ★_hvAlign." + k + " 를 ★증가시키는 곳이 없다★ — 로그가 영원히 0 을 찍는다"); fails++; }
    else if (!out) { console.log("  FAIL ★_hvAlign." + k + " 를 세기만 하고 안 적는다★"); fails++; }
  }
  console.log("  ok   지수·섹터 각각 날짜/봉수/범위밖/빈손 네 가지를 ★세고 또 적는다★");
  chk(/\[정렬 지수 날짜=/.test(S) && /★빈손=/.test(S),
    "수확 로그가 정렬 방식과 ★빈손 건수★ 를 적는다 — 빈손이면 그 봉의 지수 피처가 전부 폴백이다",
    "★로그가 말하지 않는다 — 다시 [퇴화칸] 을 보고서야 알게 된다★");
}

console.log(fails === 0 ? "\n✓ 지수·섹터 정렬 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
