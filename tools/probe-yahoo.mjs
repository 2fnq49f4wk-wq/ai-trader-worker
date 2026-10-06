/* [V33.482] 야후 시세 경로 점검 — 워커의 spark 가 HTTP 404(2026-10-05). 어느 경로가 살아 있는지 러너에서 잰다(워커 파서 그대로). */
import * as M from "../src/index.js";
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", "Accept": "application/json,text/plain,*/*", "Referer": "https://finance.yahoo.com/" };
const syms = ["AAPL", "MSFT", "NVDA", "BRK-B", "SPY"];
const urls = [];
for (const h of ["query1", "query2"]) {
  urls.push(["spark v8 " + h, "https://" + h + ".finance.yahoo.com/v8/finance/spark?symbols=" + encodeURIComponent(syms.join(",")) + "&range=5d&interval=1d"]);
  urls.push(["spark v7 " + h, "https://" + h + ".finance.yahoo.com/v7/finance/spark?symbols=" + encodeURIComponent(syms.join(",")) + "&range=5d&interval=1d"]);
}
urls.push(["chart v8 (대조)", "https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=5d&interval=1d"]);
urls.push(["quote v7 (crumb 없음)", "https://query1.finance.yahoo.com/v7/finance/quote?symbols=AAPL,MSFT"]);
for (const [tag, u] of urls) {
  try {
    const r = await fetch(u, { headers: UA });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch (e) {}
    const got = j ? M.parseSparkQuotes(j, syms) : {};
    console.log("YH " + tag + " — HTTP " + r.status + " · " + txt.length + "자 · 키 " + (j ? Object.keys(j).slice(0, 6).join(",") : "(JSON 아님)") +
      " · spark 파서 " + Object.keys(got).length + "종목" + (Object.keys(got).length ? " 예 " + JSON.stringify(got[Object.keys(got)[0]]) : "") +
      (j ? "" : " · 본문 " + txt.slice(0, 120).replace(/\s+/g, " ")));
  } catch (e) { console.log("YH " + tag + " — 실패 " + String(e.message || e).slice(0, 80)); }
}
/* [V33.485] 나스닥 — ① 실적 캘린더가 ★과거 날짜★ 에도 실제·예상 EPS 를 주는가(PEAD 이력 백필 가능성) ② 배치 시세(watchlist) */
const NUA = { "User-Agent": UA["User-Agent"], "Accept": "application/json", "Origin": "https://www.nasdaq.com", "Referer": "https://www.nasdaq.com/" };
for (const d of ["2026-09-30", "2025-10-30", "2024-10-30", "2023-11-02", "2022-11-03"]) {
  try {
    const r = await fetch("https://api.nasdaq.com/api/calendar/earnings?date=" + d, { headers: NUA });
    const j = await r.json().catch(() => null);
    const rows = (j && j.data && j.data.rows) || [];
    const withAct = rows.filter((x) => x && x.eps != null && x.eps !== "" && x.epsForecast != null && x.epsForecast !== "");
    console.log("NQ 실적 " + d + " — HTTP " + r.status + " · 행 " + rows.length + " · 실제+예상 둘 다 " + withAct.length +
      (rows[0] ? " · 키 " + Object.keys(rows[0]).join(",") + " · 예 " + JSON.stringify(withAct[0] || rows[0]).slice(0, 220) : ""));
  } catch (e) { console.log("NQ 실적 " + d + " — 실패 " + String(e.message || e).slice(0, 80)); }
}
try {
  const q = ["aapl", "msft", "nvda", "brk.b"].map((s) => "symbol=" + encodeURIComponent(s + "|stocks")).join("&");
  const r = await fetch("https://api.nasdaq.com/api/quote/watchlist?" + q, { headers: NUA });
  const t = await r.text();
  console.log("NQ 배치시세 — HTTP " + r.status + " · " + t.length + "자 · " + t.slice(0, 400).replace(/\s+/g, " "));
} catch (e) { console.log("NQ 배치시세 — 실패 " + String(e.message || e).slice(0, 80)); }

/* [V33.501] 나스닥 애널리스트 — 야후 v7(컨센서스 수집원)이 죽어 anlrevk 단계가 며칠째 대기. 대체 경로의 응답 모양을 본다. */
for (const sym of ["AAPL", "MSFT", "BRK.B"]) {
  for (const ep of ["targetprice", "ratings"]) {
    try {
      const r = await fetch("https://api.nasdaq.com/api/analyst/" + sym + "/" + ep, { headers: NUA });
      const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
      const d = j && j.data;
      console.log("NQA " + sym + " " + ep + " HTTP " + r.status + " · keys " + (d ? Object.keys(d).join(",") : "(없음)") + " · " +
        (d ? JSON.stringify(d).slice(0, 700) : t.slice(0, 200).replace(/\s+/g, " ")));
    } catch (e) { console.log("NQA " + sym + " " + ep + " 실패 " + String(e.message || e).slice(0, 80)); }
  }
}
