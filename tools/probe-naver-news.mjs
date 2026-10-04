/* [V33.479] 네이버 종목뉴스 깊이 측정 — 워커와 ★같은 파서★ 로 쪽마다 몇 건·어느 날짜까지 오는지 찍는다.
   왜: 운영 백필이 덮은 기간 중앙 103일에서 멈추고 449/450 종목이 '끝' 으로 찍혔다. 네이버가 정말 거기까지만 주는지,
   수집기의 '끝' 판정이 틀렸는지 — 추측하지 않고 잰다. 브라우저 없음 · 워커 미경유(러너 IP). */
import * as M from "../src/index.js";
const codes = (process.argv[2] || "005930,000100,035720").split(",");
const H = (code) => ({ "User-Agent": "Mozilla/5.0", "Referer": "https://finance.naver.com/item/news.naver?code=" + code });
async function html(code, page) {
  try {
    const r = await fetch("https://finance.naver.com/item/news_news.naver?code=" + code + "&page=" + page + "&sm=title_entity_id.basic&clusterId=", { headers: H(code) });
    const buf = await r.arrayBuffer();
    const txt = new TextDecoder("euc-kr").decode(buf);
    const p = M._onParseHtml(txt);
    const ms = p.rows.map((x) => x.m);
    const last = /pgRR[\s\S]{0,200}?page=(\d+)/.exec(txt);
    return { st: r.status, n: p.rows.length, min: ms.length ? Math.min(...ms) : null, max: ms.length ? Math.max(...ms) : null, lastPage: last ? +last[1] : null, len: txt.length };
  } catch (e) { return { err: String(e.message || e).slice(0, 60) }; }
}
async function json(code, page) {
  try {
    const r = await fetch("https://m.stock.naver.com/api/news/stock/" + code + "?pageSize=50&page=" + page, { headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://m.stock.naver.com/" } });
    let j = null; try { j = await r.json(); } catch (e) {}
    const p = M._onParseJson(j);
    const ms = p.rows.map((x) => x.m);
    return { st: r.status, n: p.rows.length, min: ms.length ? Math.min(...ms) : null, max: ms.length ? Math.max(...ms) : null };
  } catch (e) { return { err: String(e.message || e).slice(0, 60) }; }
}
for (const code of codes) {
  for (const pg of [1, 2, 3, 5, 10, 20]) console.log("NV json " + code + " p" + pg + " " + JSON.stringify(await json(code, pg)));
  for (const pg of [1, 2, 10, 50, 100, 200, 300, 400, 600, 800, 1200, 1600, 3000]) console.log("NV html " + code + " p" + pg + " " + JSON.stringify(await html(code, pg)));
}
