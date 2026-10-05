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
