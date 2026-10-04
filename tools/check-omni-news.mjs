/* ═════════════════════════════════════════════════════════════════
   [V33.472] 한국 종목 뉴스 이력 수집기 검사 — ★실행해서★ 본다(가짜 네이버 · 가짜 D1 · 가짜 R2).
   이 수집기를 쓴 세션도 네이버에 닿지 못했다(샌드박스 403). 그래서 여기서
     ① 파서가 그럴듯한 JSON·HTML 은 읽고 이상한 모양은 ★안 읽는지★ · 어조 규칙 · 시각 검사
     ② 못 읽은 색인·옛 파일을 ★덮지 않는지★(V33.427b)
     ③ 백필이 끝까지 가고(같은 기사는 한 번) · JSON 이 쪽을 안 넘기면 HTML 로 · 끝에서 멈추는지
     ④ 학습기에 주는 일별 묶음이 '가장 오래된 날(일부만 받았을 수 있다)' 을 빼는지
     ⑤ 배선 · 학습기 실험 스위치가 업로드를 거부하는지
   를 확인한다.
   ═════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

/* 기사 600개 — 최근이 앞. 하루 3건씩 200일 */
const arts = [];
{ let t = Date.UTC(2026, 8, 25, 6, 0); for (let i = 0; i < 600; i++) { const d = new Date(t - Math.floor(i / 3) * 86400000 - (i % 3) * 3600000);
  arts.push({ y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: 0, aid: 1000000 + i, oid: 1 + (i % 7), title: i % 4 === 0 ? "삼성전자 급등 신고가" : i % 4 === 1 ? "실적 부진 우려" : "주주총회 개최" }); } }
const p2 = (n) => String(n).padStart(2, "0");
const dtCompact = (a) => "" + a.y + p2(a.mo) + p2(a.d) + p2(a.h) + p2(a.mi);
const dtDot = (a) => a.y + "." + p2(a.mo) + "." + p2(a.d) + " " + p2(a.h) + ":" + p2(a.mi);

console.log("① 파서 — 그럴듯한 모양은 읽고, 이상한 모양은 안 읽는다");
{
  const j = [{ total: 2, items: arts.slice(0, 2).map((a) => ({ officeId: String(a.oid), articleId: String(a.aid), title: a.title, datetime: dtCompact(a) })) }];
  const p = M._onParseJson(j);
  chk(p.rows.length === 2 && p.rows[0].m === +dtCompact(arts[0]) && p.rows[0].t === 1 && p.rows[1].t === -1,
    "JSON: 묶음 안 기사 · 시각 · 어조(+1/−1)", "★JSON 파싱이 틀렸다: " + JSON.stringify(p.rows) + "★");
  chk(M._onParseJson([{ title: "x" }, { datetime: "202601011200" }, { foo: 1 }]).rows.length === 0,
    "JSON: 제목·시각이 둘 다 없으면 기사로 안 본다", "★모르는 모양에서 기사를 만들었다★");
  const html = "<table class=\"type5\">" + arts.slice(0, 3).map((a) =>
    "<tr class=\"first\"><td class=\"title\"><a href=\"/item/news_read.naver?article_id=" + a.aid + "&amp;office_id=" + a.oid + "&amp;code=005930\" class=\"tit\" onClick=\"x\">" + a.title + "</a></td>" +
    "<td class=\"info\">연합뉴스</td><td class=\"date\"> " + dtDot(a) + "</td></tr>").join("") + "<tr><td>합계</td></tr></table>";
  const h = M._onParseHtml(html);
  chk(h.rows.length === 3 && h.rows[0].m === +dtCompact(arts[0]) && h.rows[0].t === 1 && h.rows[2].t === 0,
    "HTML: 기사 번호·날짜 칸이 있는 줄만 · 어조", "★HTML 파싱이 틀렸다: " + JSON.stringify(h.rows) + "★");
  chk(M._onMin("2026.13.05 10:00") === null && M._onMin("202609301422") === 202609301422 && M._onMin("2026-09-30T14:22:00") === 202609301422 && M._onMin("어제") === null,
    "시각 검사(13월 거절 · 세 가지 표기)", "★시각 검사가 헐겁다★");
  chk(M._onTone("영업이익 흑자 전환, 신고가") === 1 && M._onTone("유상증자 결정에 급락") === -1 && M._onTone("주주총회") === 0,
    "어조: 좋은 말·나쁜 말 개수 차의 부호", "★어조 규칙이 틀렸다★");
}

function fakeDB(o) {
  const st = new Map(Object.entries(o.state || {}).map(([k, v]) => [k, JSON.stringify(v)]));
  const writes = [];
  const mk = (sql) => { const s = { args: [] }; s.bind = (...a) => { s.args = a; return s; };
    s.first = async () => { if (/SELECT v FROM state/.test(sql)) { const k = s.args[0]; if ((o.failRead || []).includes(k)) throw new Error("D1 fake"); return st.has(k) ? { v: st.get(k) } : null; } return null; };
    s.run = async () => { if (/INSERT INTO state/.test(sql)) { writes.push(s.args[0]); st.set(s.args[0], s.args[1]); } return { meta: {} }; };
    s.all = async () => ({ results: [] }); return s; };
  return { prepare: mk, batch: async () => [], _w: writes, _get: (k) => st.has(k) ? JSON.parse(st.get(k)) : undefined, _set: (k, v) => st.set(k, JSON.stringify(v)) };
}
function fakeR2(o) {
  const m = new Map(Object.entries(o.files || {}).map(([k, v]) => [k, JSON.stringify(v)]));
  const puts = [];
  return { get: async (k) => { if ((o.failGet || []).includes(k)) throw new Error("R2 fake"); return m.has(k) ? { text: async () => m.get(k) } : null; },
           put: async (k, v) => { puts.push(k); m.set(k, v); }, _puts: puts, _get: (k) => m.has(k) ? JSON.parse(m.get(k)) : undefined };
}
/* mode: "json" — JSON 이 쪽을 넘긴다(끝을 넘기면 빈 목록) · "json-stuck" — 쪽 무시(늘 첫 쪽) · "html-only" — JSON 404 */
function fakeNaver(mode, total = 600) {
  const calls = { json: 0, html: 0 };
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/api/news/stock/")) {
      calls.json++;
      if (mode === "html-only") return { ok: false, status: 404 };
      if (mode === "html-gone") { const pg0 = +/page=(\d+)/.exec(u)[1]; const rows = arts.slice(Math.min(200, (pg0 - 1) * 50), Math.min(200, pg0 * 50));
        return { ok: true, status: 200, json: async () => [{ items: rows.map((a) => ({ officeId: a.oid, articleId: a.aid, title: a.title, datetime: dtCompact(a) })) }] }; }
      let pg = +/page=(\d+)/.exec(u)[1]; if (mode === "json-stuck") pg = 1;
      const jtot = mode === "json-short" ? 200 : total;                // 운영처럼 JSON 은 얕다(200건에서 빈 목록)
      const rows = arts.slice(Math.min(jtot, (pg - 1) * 50), Math.min(jtot, pg * 50));
      return { ok: true, status: 200, json: async () => [{ items: rows.map((a) => ({ officeId: a.oid, articleId: a.aid, title: a.title, datetime: dtCompact(a) })) }] };
    }
    if (u.includes("news_news.naver")) {
      calls.html++;
      if (mode === "html-gone") return { ok: false, status: 410 };
      const last = Math.ceil(total / 20), pg = Math.min(+/page=(\d+)/.exec(u)[1], last);   // 마지막 쪽을 넘기면 마지막 쪽을 또 준다
      const rows = arts.slice((pg - 1) * 20, Math.min(total, pg * 20));
      const html = rows.map((a) => "<tr><td class=\"title\"><a href=\"x?article_id=" + a.aid + "&office_id=" + a.oid + "\" class=\"tit\">" + a.title + "</a></td><td class=\"date\">" + dtDot(a) + "</td></tr>").join("");
      const bytes = new TextEncoder().encode(html);
      return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer };
    }
    return { ok: false, status: 404 };
  };
  return calls;
}
const R2KEY = (s) => M.OMNINEWS.prefix + s + ".json";

console.log("\n② 수집기 — 못 읽은 색인은 ★덮지 않는다★");
{
  const DB = fakeDB({ failRead: ["omninews_index"] }); const R2 = fakeR2({}); M._setR2ForTest(R2); fakeNaver("json");
  const r = await M.omniNewsCollect(DB, { perRun: 2 });
  chk(/색인 읽기 실패/.test(r) && !DB._w.includes("omninews_index") && R2._puts.length === 0, "색인 못 읽음 → 아무것도 안 쓴다", "★색인을 못 읽었는데 썼다: " + r.slice(0, 80) + "★");
}

console.log("\n③ 백필 — 끝까지 · 같은 기사 한 번 · JSON 이 쪽을 안 넘기거나 얕으면 HTML 로 · 끝에서 멈춤");
for (const mode of ["json", "json-short", "json-stuck", "html-only"]) {
  const DB = fakeDB({}); const R2 = fakeR2({}); M._setR2ForTest(R2);
  const calls = fakeNaver(mode, 600);
  let r = "";
  for (let t = 0; t < 12; t++) {
    const ix = DB._get("omninews_index"); if (ix) { for (const s in ix.s) ix.s[s].upd = 0; DB._set("omninews_index", ix); }
    r = await M.omniNewsCollect(DB, { perRun: 1 });
    DB._set("omninews_cursor", { i: 0 });
  }
  const sym = Object.keys(DB._get("omninews_index").s)[0];
  const f = R2._get(R2KEY(sym)) || { a: [] };
  const ids = new Set(f.a.map((x) => x[2]));
  const ent = DB._get("omninews_index").s[sym];
  const asc = f.a.every((x, i) => i === 0 || f.a[i - 1][0] <= x[0]);
  chk(f.a.length === 600 && ids.size === 600 && asc && ent.end === true,
    mode + ": 600건 전부 · 중복 없음 · 시각 오름차순 · 끝 표시 (json " + calls.json + " · html " + calls.html + "쪽)",
    "★" + mode + ": " + f.a.length + "건(고유 " + ids.size + ") · 끝 " + ent.end + " — " + r.slice(0, 200) + "★");
}

console.log("\n③-b [V33.479] HTML 목록 은퇴(410) — 새 기사는 JSON 으로 계속 · 겹치면 멈춤 · 백필은 끝(이유 남김)");
{
  M._onHtmlGoneSet(false);
  const DB = fakeDB({}); const R2 = fakeR2({}); M._setR2ForTest(R2);
  let calls = fakeNaver("html-gone", 600);
  await M.omniNewsCollect(DB, { perRun: 1 });
  const sym = Object.keys(DB._get("omninews_index").s)[0];
  /* 운영 상황을 만든다: 옛 HTML 백필로 과거 500건(arts[100..599])이 있고, 종목은 HTML 쪽(jnp)으로 넘어가 있다. */
  const old = M._onParseHtml(arts.slice(100).map((a) => "<tr><td><a href=\"x?article_id=" + a.aid + "&office_id=" + a.oid + "\" class=\"tit\">" + a.title + "</a></td><td class=\"date\">" + dtDot(a) + "</td></tr>").join(""));
  const R2b = fakeR2({ files: { [R2KEY(sym)]: { s: sym, a: old.rows.map((r) => [r.m, r.t, r.id]).sort((x, y) => x[0] - y[0]) } } }); M._setR2ForTest(R2b);
  const ix = { s: { [sym]: { jnp: true, end: false, n: 500, upd: 0, hp: 30 } } }; DB._set("omninews_index", ix); DB._set("omninews_cursor", { i: 0 });
  M._onHtmlGoneSet(false); calls = fakeNaver("html-gone", 600);
  const r = await M.omniNewsCollect(DB, { perRun: 1 });
  const f = R2b._get(R2KEY(sym)) || { a: [] }; const ent = DB._get("omninews_index").s[sym];
  chk(f.a.length === 600 && new Set(f.a.map((x) => x[2])).size === 600 && calls.json === 3,
    "jnp 종목도 새 기사 100건을 JSON 으로 받는다 · 겹치는 쪽(3쪽)에서 멈춤", "★HTML 이 죽자 새 기사가 안 들어온다: " + f.a.length + "건 · json " + calls.json + "쪽 — " + r.slice(0, 160) + "★");
  chk(ent.end === true && ent.endWhy === "html410" && calls.html <= 1 && /HTML 목록 은퇴/.test(r),
    "HTML 410 → 백필 끝(이유 html410) · HTML 은 한 번만 두드린다 · 요약에 은퇴 표시", "★410 처리: end " + ent.end + " · why " + ent.endWhy + " · html " + calls.html + "★");
  M._onHtmlGoneSet(false);
}

console.log("\n④ 옛 파일을 못 읽으면 그 종목은 안 덮는다 · 일별 묶음");
{
  const DB = fakeDB({}); fakeNaver("json"); const R2 = fakeR2({}); M._setR2ForTest(R2);
  await M.omniNewsCollect(DB, { perRun: 1 });
  const sym = Object.keys(DB._get("omninews_index").s)[0];
  const before = R2._get(R2KEY(sym)).a.length;
  const R2b = fakeR2({ files: { [R2KEY(sym)]: R2._get(R2KEY(sym)) }, failGet: [R2KEY(sym)] }); M._setR2ForTest(R2b);
  const ix = DB._get("omninews_index"); ix.s[sym].upd = 0; DB._set("omninews_index", ix); DB._set("omninews_cursor", { i: 0 });
  const r = await M.omniNewsCollect(DB, { perRun: 1 });
  chk(R2b._puts.length === 0 && /옛파일 못읽음 1/.test(r) && before > 0, "옛 파일 읽기 실패 → 쓰지 않음(" + before + "건 보존)", "★옛 파일을 못 읽었는데 덮었다: " + r.slice(0, 120) + "★");
  const daily = M._onDaily({ a: [[202609240900, 1, 1], [202609241000, -1, 2], [202609250800, 1, 3], [202609250900, 0, 4], [202609270900, -1, 5]] });
  chk(daily && daily.from === 20260925 && daily.d.join() === "20260925,20260927" && daily.n.join() === "2,1" && daily.p.join() === "1,0" && daily.q.join() === "0,1" && daily.to === 20260927,
    "일별 묶음: 가장 오래된 날은 빼고(from=다음 날) · 건수·좋음·나쁨", "★일별 묶음이 틀렸다: " + JSON.stringify(daily) + "★");
}

console.log("\n⑤ 배선 — 매 틱 · 야간 단계 · 수동 실행 · 학습기 엔드포인트 · 실험 스위치");
{
  chk(/omninews_lock/.test(S) && /\["omninews", function \(DB\)/.test(S) && /_stg\("omninews"/.test(S), "매 틱(잠금) + 야간 _PIPE + _stg", "★수집기가 어디서도 안 돈다★");
  const tn = readFileSync(new URL("../.github/workflows/train-now.yml", import.meta.url), "utf8");
  chk(/options: \[[^\]]*\bomninews\b/.test(tn), "수동 실행 목록에 omninews", "★손으로 돌릴 방법이 없다★");
  const ep = S.slice(S.indexOf('path === "/api/omni-news-index"'), S.indexOf('path === "/api/ml-export-intraday"'));
  chk(/_onIndexLoad\(env\.DB\)/.test(ep) && /status: 503/.test(ep) && /errs\.push\(sym\)/.test(ep) && /_onDaily\(/.test(ep),
    "학습기 엔드포인트: 색인 엄격(503) · 못 읽은 종목은 errs · 일별 묶음으로", "★엔드포인트가 못 읽음을 없음으로 준다★");
  const PY = readFileSync(new URL("../trainer/modal/omni.py", import.meta.url), "utf8");
  chk(/NEWS = os\.environ\.get\("OMNI_NEWS"\) == "1"/.test(PY) && /OMNI_NEWS 실험 회차 — 업로드 안 함/.test(PY) && /def news_feats/.test(PY),
    "학습기: OMNI_NEWS 실험 스위치 · 업로드 거부", "★학습기 뉴스 실험이 없거나 업로드한다★");
  /* [V33.479] 실험은 기본 모델 실력 관문 ★앞★ 에서 — 뒤에 있으면 기본 모델이 0.5 근처일 때 실험이 한 번도 안 돈다(2026-10-04). */
  const RUN = PY.slice(PY.indexOf("def run(BASE"));
  const iN = RUN.indexOf("    if NEWS:\n"), iF = RUN.indexOf("    if FLOW:\n"), iG = RUN.indexOf('    if len(trees) < 2 or not _edge["ok"]:');
  chk(iN > 0 && iF > 0 && iG > 0 && iN < iG && iF < iG, "학습기: 뉴스·수급 실험은 실력 관문 앞에서 잰다(기본 모델이 무실력이어도 돈다)", "★실험이 실력 관문 뒤에 있다 — 기본 모델이 0.5 면 실험이 안 돈다★");
  const MD = readFileSync(new URL("../.github/workflows/modal-deploy.yml", import.meta.url), "utf8"), MT = readFileSync(new URL("../trainer/modal/modal_train.py", import.meta.url), "utf8");
  chk(/omni_news:/.test(MD) && /--news \$\{\{ inputs\.omni_news && 1 \|\| 0 \}\}/.test(MD) && /os\.environ\["OMNI_NEWS"\] = "1"/.test(MT),
    "Modal 실험 회차 입력(omni_news → --news → OMNI_NEWS)", "★실험 회차를 돌릴 방법이 없다★");
}

console.log("\n⑥ [V33.475] 급등 패턴 실험 — 재기만(업로드 거부) · 잣대 = 비용 뺀 순초과 · 자가검사");
{
  const PY = readFileSync(new URL("../trainer/modal/omni.py", import.meta.url), "utf8");
  const ST = readFileSync(new URL("../trainer/modal/omni_selftest.py", import.meta.url), "utf8");
  const MD = readFileSync(new URL("../.github/workflows/modal-deploy.yml", import.meta.url), "utf8"), MT = readFileSync(new URL("../trainer/modal/modal_train.py", import.meta.url), "utf8");
  chk(/RALLY = os\.environ\.get\("OMNI_RALLY"\) == "1"/.test(PY) && /OMNI_RALLY 실험 회차 — 업로드 안 함/.test(PY) && /if RALLY:\s*\n\s*rep = \{"rally": rally_experiment/.test(PY),
    "OMNI_RALLY 회차는 업로드를 거부한다", "★급등 실험이 업로드한다★");
  chk(/RALLY_COST = \{0: 0\.0010, 1: 0\.0030\}/.test(PY) && /ex - RALLY_COST\[mk\]/.test(PY) && /RALLY_T = 2\.0/.test(PY) && /need = max\(2, int\(_m\.ceil\(0\.6 \* nf\)\)\)/.test(PY) && /nf >= 3 and wins >= need/.test(PY) && /RALLY_FOLDS = \(0\.50, 0\.60, 0\.70, 0\.80, 0\.90\)/.test(PY),
    "잣대: 왕복 비용(미국 0.10% · 한국 0.30%)을 뺀 순초과 > 0 · 날짜 블록 t ≥ 2 · 전진 5구간의 60% 이상", "★급등 실험 잣대가 느슨해졌다★");
  chk(/"adj": \("위험조정 상위10%"/.test(PY) && /"objective": "lambdarank"/.test(PY) && /z = A\["fr"\] \/ vol/.test(PY) && /rally_pick_eval\(A, ho, p, gid, yr\)/.test(PY),
    "세 갈래(원값 · 위험조정 · 순위학습) — 평가는 셋 다 ★원값 수익★(실제로 버는 돈)", "★갈래가 빠졌거나 평가 잣대가 갈래마다 다르다★");
  chk(/cand = dict\(GBDT_GRID\[1\]\)/.test(PY), "구성은 고정(홀드아웃을 보고 고르지 않는다)", "★홀드아웃으로 구성을 고른다★");
  chk(/def check_rally\(\)/.test(ST) && /check_rally\(\)\n\s*print\("✅ OMNI 자가검사 통과"\)/.test(ST), "학습기 자가검사: 심은 신호 통과 · 잡음 불통과", "★급등 실험 자가검사가 없다★");
  chk(/omni_rally:/.test(MD) && /--rally \$\{\{ inputs\.omni_rally && 1 \|\| 0 \}\}/.test(MD) && /os\.environ\["OMNI_RALLY"\] = "1"/.test(MT),
    "Modal 실험 회차 입력(omni_rally → --rally → OMNI_RALLY)", "★급등 실험을 돌릴 방법이 없다★");
}

console.log(fails ? "\n✗ 뉴스 수집기 검사 실패 " + fails : "\n✓ 뉴스 수집기 검사 통과");
process.exit(fails ? 1 : 0);
