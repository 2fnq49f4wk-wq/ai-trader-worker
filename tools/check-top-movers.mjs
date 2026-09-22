/* ═══════════════════════════════════════════════════════════════════════════
   [V33.415] ★TOP MOVERS 에서 한 시장이 조용히 사라지고 있었다★

   ■ 사용자 관측 — "대시보드 top movers 에 미국 주식이 표시가 안 된다"
     맞는 지적이었다. 원인이 ★둘 겹쳐★ 있었다:
       ① 신선도 폴백이 ★전체 기준★ 이었다. 한국장이 열려 있고 미국장이 닫혀 있으면
          미국 시세는 24시간을 넘겨 탈락하는데, 한국 것만으로 10개가 채워지므로
          "표본 부족 → 전체로 재계산" 폴백이 ★발동하지 않는다.★ 미국이 통째로 빠진다.
       ② 살아남아도 코스닥은 하루 ±30% 가 흔하다. US·KR 을 한 통에 넣고 등락률로 줄
          세우면 변동성이 큰 시장이 상·하위 칸을 ★독식★ 한다.
     둘 다 "고장" 처럼 안 보이고 ★그냥 안 보인다★ — 그래서 오래 안 잡혔다.

   ■ 고침 — 시장별로 따로 모으고 · 따로 폴백하고 · 자리를 나눠 준다
     한쪽에 자료가 없으면 남는 자리는 다른 쪽이 채운다(칸을 비우지 않는다).
     ★이 검사는 글자가 아니라 뽑기 자체를 돌려 본다★ — 보장은 데이터 위에서 성립해야 한다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const H = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

/* 페이지의 뽑기 논리를 그대로 떼어내 실행한다(구현을 베끼지 않는다 — 소스에서 잘라 쓴다). */
const iStart = H.indexOf("var MOVER_SLOT =");
const iEnd = H.indexOf("function moverRow(");
chk(iStart > 0 && iEnd > iStart, "뽑기 논리를 소스에서 찾았다", "★뽑기 논리를 못 찾는다 — 구조가 바뀌었다★");
if (iStart < 0 || iEnd < iStart) { console.log("\n✗ " + (fails || 1) + "건 실패"); process.exit(1); }
const body = H.slice(iStart, iEnd);

const run = (quotes, now) => {
  const lastQuotes = {};
  for (const q of quotes) lastQuotes[q.symbol] = q;
  const _freshLimit = now - 24 * 3600 * 1000;
  const fn = new Function("lastQuotes", "_freshLimit",
    body + "\n return { up: pickSide(true), down: pickSide(false), us: mvUS.length, kr: mvKR.length };");
  return fn(lastQuotes, _freshLimit);
};
const mkQ = (sym, market, dayPct, ageH, now) =>
  ({ symbol: sym, market: market, dayPct: dayPct, price: 100, ts: now - ageH * 3600 * 1000 });
const cnt = (rows, m) => rows.filter(r => r.mkt === m).length;

console.log("\n① ★미국장이 닫혀 시세가 묵어도 미국이 나온다★ (사용자가 본 그 상황)");
{
  const now = Date.UTC(2026, 8, 22, 3, 0, 0);       // 한국 낮 = 미국장 마감 뒤
  const qs = [];
  for (let i = 0; i < 40; i++) qs.push(mkQ("KR" + i + ".KS", "kr", (i % 21) - 10, 1, now));   // 한국: 신선
  for (let i = 0; i < 40; i++) qs.push(mkQ("US" + i, "us", (i % 11) - 5, 30, now));           // 미국: 30시간 전
  const r = run(qs, now);
  chk(cnt(r.up, "us") > 0 && cnt(r.down, "us") > 0,
    "상승 " + cnt(r.up, "us") + "칸 · 하락 " + cnt(r.down, "us") + "칸이 미국이다 — ★사라지지 않는다★",
    "★미국이 통째로 빠진다(상승 " + cnt(r.up, "us") + " · 하락 " + cnt(r.down, "us") + ") — 전체 기준 폴백 버그 그대로다★");
  chk(cnt(r.up, "kr") > 0, "한국도 함께 나온다(한쪽만 남기지 않는다)", "★한국이 사라졌다★");
}

console.log("\n② ★변동성 큰 시장이 독식하지 않는다★");
{
  const now = Date.now();
  const qs = [];
  for (let i = 0; i < 40; i++) qs.push(mkQ("KR" + i + ".KS", "kr", (i % 2 ? 1 : -1) * (20 + i), 1, now));  // ±20~60%
  for (let i = 0; i < 40; i++) qs.push(mkQ("US" + i, "us", (i % 2 ? 1 : -1) * (0.5 + i * 0.05), 1, now));  // ±0.5~2.5%
  const r = run(qs, now);
  chk(cnt(r.up, "us") >= 5, "코스닥이 ±60% 로 뛰어도 상승표에 미국이 " + cnt(r.up, "us") + "칸 남는다",
    "★변동성 큰 시장이 독식한다(미국 " + cnt(r.up, "us") + "칸)★");
  chk(cnt(r.down, "us") >= 5, "하락표에도 미국이 " + cnt(r.down, "us") + "칸 남는다",
    "★하락표를 독식당한다(미국 " + cnt(r.down, "us") + "칸)★");
}

console.log("\n③ ★칸을 비우지 않는다★ — 한쪽에 자료가 없으면 다른 쪽이 채운다");
{
  const now = Date.now();
  const qs = [];
  for (let i = 0; i < 40; i++) qs.push(mkQ("US" + i, "us", (i % 21) - 10, 1, now));   // 미국만 있다
  const r = run(qs, now);
  chk(r.up.length === 20, "한 시장뿐이어도 상승표 " + r.up.length + "줄이 찬다(종전과 같은 20줄)",
    "★한 시장만 있으면 칸이 " + r.up.length + "줄로 줄어든다 — 화면이 비어 보인다★");
  chk(r.down.length === 20, "하락표도 " + r.down.length + "줄", "★하락표가 " + r.down.length + "줄★");
}

console.log("\n④ ★줄 세우기가 맞는가★ (상승표는 내림차순 · 하락표는 오름차순)");
{
  const now = Date.now();
  const qs = [];
  for (let i = 0; i < 30; i++) qs.push(mkQ("US" + i, "us", i - 15, 1, now));
  for (let i = 0; i < 30; i++) qs.push(mkQ("KR" + i + ".KS", "kr", i - 15, 1, now));
  const r = run(qs, now);
  const upOK = r.up.every((v, i, a) => i === 0 || a[i - 1].q.dayPct >= v.q.dayPct);
  const dnOK = r.down.every((v, i, a) => i === 0 || a[i - 1].q.dayPct <= v.q.dayPct);
  chk(upOK, "상승표가 ★내림차순★ 이다", "★상승표 정렬이 깨졌다★");
  chk(dnOK, "하락표가 ★오름차순★ 이다(가장 많이 빠진 것이 위)", "★하락표 정렬이 깨졌다★");
  chk(r.up[0].q.dayPct > 0 && r.down[0].q.dayPct < 0,
    "상승표 머리는 +" + r.up[0].q.dayPct + "% · 하락표 머리는 " + r.down[0].q.dayPct + "%",
    "★두 표가 같은 쪽을 보고 있다★");
}

console.log("\n⑤ ★시장이 보이는가★ · ★없던 정보를 만들지 않는가★");
{
  /* ★선언이 아니라 ★쓰임★ 을 본다.★ 처음엔 `var flag = …` 만 확인했는데, 그러면 행 HTML 에서
     flag 를 빼도 검사가 통과한다(돌연변이 M5 가 그렇게 빠져나갔다) — 이 저장소에서
     "이름만 세고 실제 사용을 안 세는" 실수는 반복해서 난다. 둘 다 본다. */
  chk(/var flag = isKR \?/.test(H), "시장 깃발을 ★만든다★",
    "★시장 표시를 안 만든다 — 섞인 표에서 읽는 사람이 구분 못 한다★");
  const rowI = H.indexOf("function moverRow(");
  const rowBody = rowI > 0 ? H.slice(rowI, H.indexOf("}", H.indexOf("return '<tr", rowI)) + 1) : "";
  chk(/'\+flag\+'/.test(rowBody),
    "그 깃발을 ★행 HTML 에 실제로 싣는다★",
    "★깃발을 만들어 놓고 행에 안 싣는다 — 화면엔 아무 표시도 안 나온다★");
  chk(/q\.market \|\| \(\/\\\.\(KS\|KQ\)\$\/\.test\(sym\) \? 'kr' : 'us'\)/.test(H),
    "시장은 ★시세가 이미 싣고 있는 q.market★ 을 쓴다(없을 때만 티커로 추정)",
    "★시장을 티커로만 추정한다 — 이미 있는 정보를 안 쓴다★");
  const now = Date.now();
  const qs = [];
  for (let i = 0; i < 12; i++) qs.push(mkQ("KR" + i + ".KS", "kr", i, 1, now));
  for (let i = 0; i < 12; i++) qs.push({ symbol: "US" + i, market: "us", dayPct: i, price: 100 });  // ts 없음
  const r = run(qs, now);
  chk(cnt(r.up, "us") > 0, "ts 가 없는 시세도 버리지 않는다(신선도는 ts 가 있을 때만 따진다)",
    "★ts 없는 시세를 통째로 버린다★");
}

console.log(fails === 0 ? "\n✓ TOP MOVERS 시장 균형 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
