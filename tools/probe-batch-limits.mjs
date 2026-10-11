/* [V33.558] ★한 번에 몇 종목까지 받아 주나★ — 사용자 10/11: "한번에 조회할 수 있는 종목 최대한 늘려".
 *   네이버 실시간(polling.finance.naver.com · 지금 60/회) · 나스닥 watchlist(지금 20/회) · 야후 spark(지금 20/회)에
 *   묶음 크기를 키워 가며 보내 ★돌려준 종목 수·지연·HTTP★ 를 잰다(읽기 전용 · 외부 공개 시세). 워커 유니버스 종목을 쓴다.
 *   결과로 상수(NB · NQ_CHUNK · SPARK_CHUNK)를 정한다 — 돌려준 수가 보낸 수와 같고 실패가 없는 가장 큰 크기의 한 단계 아래.
 * 사용법: node tools/probe-batch-limits.mjs */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const arr = (name) => { const i = S.indexOf("const " + name + " = ["); const j = S.indexOf("];", i); return [...S.slice(i, j).matchAll(/"([A-Z0-9.\-^]+)"/g)].map((m) => m[1]); };
const US = arr("DEFAULT_US").filter((s) => !s.includes(".")), KR = arr("DEFAULT_KR");
const out = (k, v) => console.log("BAT " + k + " " + (typeof v === "string" ? v : JSON.stringify(v)));
out("universe", { us: US.length, kr: KR.length });
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const time = async (f) => { const t = Date.now(); try { const r = await f(); return Object.assign({ ms: Date.now() - t }, r); } catch (e) { return { ms: Date.now() - t, err: String(e.message || e).slice(0, 80) }; } };
const SIZES = [20, 40, 60, 100, 150, 200, 300, 446];

// 네이버 실시간 — 쉼표 구분 코드
for (const n of SIZES) {
  const codes = KR.slice(0, n).map((s) => s.split(".")[0]);
  const r = await time(async () => {
    const res = await fetch("https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:" + codes.join(","), { headers: { "User-Agent": "Mozilla/5.0", Referer: "https://finance.naver.com" } });
    const j = res.ok ? await res.json() : null;
    const d = (j && j.result && j.result.areas && j.result.areas[0] && j.result.areas[0].datas) || [];
    return { http: res.status, got: d.filter((x) => Number(x.nv) > 0).length };
  });
  out("naver", Object.assign({ sent: codes.length }, r));
  await new Promise((z) => setTimeout(z, 400));
}
// 나스닥 watchlist — symbol=xxx|stocks 반복
for (const n of SIZES.filter((x) => x <= 300)) {
  const syms = US.slice(0, n);
  const r = await time(async () => {
    const q = syms.map((s) => "symbol=" + encodeURIComponent(s.toLowerCase().replace("-", ".") + "|stocks")).join("&");
    const res = await fetch("https://api.nasdaq.com/api/quote/watchlist?" + q, { headers: { "User-Agent": UA, Accept: "application/json", Origin: "https://www.nasdaq.com", Referer: "https://www.nasdaq.com/" } });
    const j = res.ok ? await res.json() : null;
    const rows = (j && Array.isArray(j.data)) ? j.data : ((j && j.data && Array.isArray(j.data.rows)) ? j.data.rows : []);
    return { http: res.status, got: rows.filter((x) => x && (x.lastSalePrice || x.lastsale)).length, urlLen: q.length };
  });
  out("nasdaq", Object.assign({ sent: syms.length }, r));
  await new Promise((z) => setTimeout(z, 600));
}
// 야후 spark — symbols=a,b,c
for (const path of ["v7/finance/spark", "v8/finance/spark"]) {
  for (const n of SIZES.filter((x) => x <= 300)) {
    const syms = US.slice(0, n);
    const r = await time(async () => {
      const res = await fetch("https://query1.finance.yahoo.com/" + path + "?symbols=" + encodeURIComponent(syms.join(",")) + "&range=5d&interval=1d", { headers: { "User-Agent": UA } });
      const j = res.ok ? await res.json() : null;
      let got = 0;
      if (j && j.spark && Array.isArray(j.spark.result)) got = j.spark.result.filter((x) => x && x.response && x.response[0]).length;
      else if (j && typeof j === "object") got = Object.keys(j).filter((k) => j[k] && Array.isArray(j[k].close)).length;
      return { http: res.status, got: got };
    });
    out("spark " + path, Object.assign({ sent: syms.length }, r));
    await new Promise((z) => setTimeout(z, 600));
  }
}
