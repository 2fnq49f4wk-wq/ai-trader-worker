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

console.log("\n⑤ ★티커만 적는가★ · ★없던 정보를 만들지 않는가★  [V33.422]");
{
  /* ★선언이 아니라 ★쓰임★ 을 본다.★ 이 저장소에서 "이름만 세고 실제 사용을 안 세는" 실수는
     반복해서 난다 — 행 HTML 안에서 무엇이 실리는지 직접 본다. */
  const rowI = H.indexOf("function moverRow(");
  const rowBody = rowI > 0 ? H.slice(rowI, H.indexOf("}", H.indexOf("return '<tr", rowI)) + 1) : "";
  chk(rowBody.length > 100, "행 렌더러를 찾았다", "★행 렌더러를 못 찾는다★");
  /* 사용자 지시: "topmovers에 국기 빼고 티커만 넣고".
     ① 국기 이모지가 없어야 한다(코드포인트로 본다 — 소스에 이스케이프로 적히든 그대로 적히든). */
  chk(!/\\uD83C\\uDDF[0-9A-F]/i.test(rowBody) && !/[\u{1F1E6}-\u{1F1FF}]/u.test(rowBody),
    "행에 국기 이모지가 ★없다★",
    "★국기 이모지가 아직 행에 실린다★");
  /* ② 첫 칸은 ★티커★ 다 — 한국 종목명으로 바꾸지 않는다. */
  chk(/escapeHtml\(it\.sym\)\+'<\/span>/.test(rowBody.replace(/\s+/g, "")) ||
      />'\+escapeHtml\(it\.sym\)\+'</.test(rowBody),
    "첫 칸에 ★티커(it.sym)★ 를 그대로 적는다",
    "★첫 칸이 티커가 아니다 — 이름·깃발로 바뀌어 있다★");
  chk(!/DYNAMIC_NAMES\[it\.sym\] \|\| it\.sym\.replace/.test(rowBody),
    "한국 종목을 이름으로 갈아끼우지 않는다(티커가 곧 시장 표시다: .KS/.KQ)",
    "★아직 한국은 이름으로 표시한다★");
  chk(/q\.market \|\| \(\/\\\.\(KS\|KQ\)\$\/\.test\(sym\) \? 'kr' : 'us'\)/.test(H),
    "시장은 ★시세가 이미 싣고 있는 q.market★ 을 쓴다(없을 때만 티커로 추정)",
    "★시장을 티커로만 추정한다 — 이미 있는 정보를 안 쓴다★");
}

console.log("\n⑥ ★정규장 등락으로만 줄 세우는가★  [V33.422 · 사용자 지시]");
{
  /* 백엔드는 시간외에 q.price/q.dayPct 를 ★시간외 값으로 덮어쓰고★ 원래 값을 regPrice/regPct 에
     보존한다(applyDisplayOverMarket). 이 표는 보존값을 써야 한다 — 실행으로 확인한다. */
  const now = Date.now();
  const qs = [];
  // 미국 12종목: 정규장은 전부 +1% 인데, 한 종목만 ★시간외에 +40%★ 로 덮여 있다(얇은 호가).
  for (let i = 0; i < 12; i++) {
    /* 시간외에 값이 ★따로 논다★: 가격도 등락도 정규장과 다르게 덮여 있다.
       (regPrice 와 price 를 같은 값으로 두면 "가격은 어느 쪽이냐" 를 검사가 못 가른다 — 돌연변이 M2 가
        그 틈으로 빠져나갔다.) */
    qs.push({ symbol: "US" + i, market: "us", price: i === 7 ? 140 : 101, regPrice: 100,
              dayPct: i === 7 ? 40 : 1.2, regPct: 1, ts: now });
  }
  for (let i = 0; i < 12; i++) qs.push({ symbol: "KR" + i + ".KS", market: "kr", price: 100,
              regPrice: 100, dayPct: 0.5, regPct: 0.5, ts: now });
  const r = run(qs, now);
  const head = r.up[0];
  chk(head && !(head.sym === "US7"),
    "시간외에만 +40% 인 종목이 상승표 머리를 ★차지하지 않는다★",
    "★시간외 등락이 표를 먹는다 — 정규장이 아니라 덮어쓴 값으로 줄 세운다★");
  chk(r.up.every((x) => x.pct != null && Math.abs(x.pct - (x.q.regPct)) < 1e-9),
    "행이 들고 다니는 등락(pct)이 ★전부 regPct★ 다",
    "★행의 등락이 정규장 값이 아니다★");
  chk(r.up.every((x) => x.px != null && Math.abs(x.px - (x.q.regPrice)) < 1e-9),
    "행이 들고 다니는 가격(px)도 ★전부 regPrice★ 다(시간외 가격이 아니다)",
    "★행의 가격이 시간외 가격이다 — 정규장 등락과 다른 시점이 한 줄에 섞인다★");
  /* 정규장 필드만 있는 시세(덮어쓰기 전 원본)도 표에 들어와야 한다 — 수집 필터가
     덮어쓴 dayPct/price 를 조건으로 삼고 있으면 이 시세가 통째로 사라진다. */
  const r3 = run([{ symbol: "REGONLY", market: "us", regPrice: 50, regPct: 9, ts: now },
                  { symbol: "REGONLY2", market: "us", regPrice: 50, regPct: -9, ts: now }], now);
  chk(r3.up.length === 2 && r3.up[0].sym === "REGONLY",
    "정규장 필드만 있는 시세도 ★수집된다★(수집 필터가 정규장 값을 본다)",
    "★수집 필터가 아직 덮어쓴 dayPct/price 를 본다 — 정규장 값만 있는 시세가 사라진다★");
  // 보존값이 없는 옛 시세는 dayPct 로 물러선다 — 칸을 비우지 않는다
  const r2 = run([{ symbol: "OLD", market: "us", price: 10, dayPct: 3, ts: now },
                  { symbol: "OLD2", market: "us", price: 10, dayPct: -3, ts: now }], now);
  chk(r2.up.length === 2, "regPct 가 없는 옛 시세는 dayPct 로 물러선다(사라지지 않는다)",
    "★보존값 없는 시세를 통째로 버린다★");
  // 가격도 정규장 값이어야 한다
  const rowI = H.indexOf("function moverRow(");
  const rowBody = rowI > 0 ? H.slice(rowI, H.indexOf("}", H.indexOf("return '<tr", rowI)) + 1) : "";
  chk(/fmtNum\(px\)/.test(rowBody) && !/it\.q\.price/.test(rowBody),
    "가격 칸도 ★정규장 가격★ 이다(시간외 가격과 정규장 등락을 한 줄에 섞지 않는다)",
    "★가격은 시간외인데 등락은 정규장이다 — 한 줄이 두 시점을 섞는다★");
  chk(!/it\.q\.dayPct/.test(rowBody), "행이 덮어쓴 dayPct 를 직접 읽지 않는다",
    "★행이 아직 q.dayPct 를 직접 읽는다★");
}

console.log("\n⑦ ts 없는 시세");
{
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
