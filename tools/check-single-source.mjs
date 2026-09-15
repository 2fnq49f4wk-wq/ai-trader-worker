/* [V33.328] 단일 출처 계약 — ★같은 규칙의 사본이 둘이면 한쪽만 고쳐진다★
 *
 *   이 저장소에서 실제로 난 사고의 부류다:
 *     · V33.303 이 달력 홀드아웃을 MEMO 한 곳만 고쳐, 나머지 신규 위원 넷은 계속 굶었다.
 *       사용자는 "★또★ 신규 위원들 작동 안 한다" 고 말했다 — 두 번째였다는 뜻이다.
 *   중복 자체가 문제가 아니라, ★한쪽만 고쳐도 아무 경고가 안 난다★ 는 것이 문제다.
 *   그래서 여기서는 합쳐 놓은 두 곳이 다시 갈라지지 않는지 본다.
 *
 *   ① SEC Form 4 파싱 — 야간 갱신과 /api/insider 가 각자 한 벌씩 갖고 ★같은 키★ 에 썼다.
 *      그 키(insider_feed)는 화면용이 아니라 PEAD·사이징과 AI 피처가 읽는 ★거래 입력★ 이다.
 *   ② 시세 병합 — saveQuoteCM 과 saveQuoteAlt 가 필드까지 똑같은 사본이었다.
 *      새 일봉지표를 한쪽에만 넣으면 다른 슬리브만 그 지표를 영영 못 받는다.
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.error("  FAIL " + m); };
function cut(start, end) {
  const a = S.indexOf(start), b = S.indexOf(end, a);
  if (a < 0 || b < 0) throw Error("소스에서 못 찾음: " + start.trim());
  return S.slice(a, b);
}

// ── ① 파서가 하나뿐인가 ────────────────────────────────────────────────────
{
  const titleRe = (S.match(/\^4\(\\\/A\)\? - /g) || []).length;
  if (titleRe === 1) ok("Form 4 제목 정규식이 소스 전체에 1벌뿐이다 — 한쪽만 고쳐지는 경로가 없다");
  else bad(`Form 4 제목 정규식이 ${titleRe}벌이다 — 형식이 바뀌면 한쪽만 고쳐지고 나머지가 그 결과를 덮어쓴다`);

  const writers = (S.match(/setState\((?:env\.)?DB, *"insider_feed"|setState\(env\.DB, ck, payload\)/g) || []).length;
  const uses = (S.match(/_secForm4Parse\(/g) || []).length;
  if (uses === 3) ok(`insider_feed 를 쓰는 두 경로가 모두 공용 파서를 부른다(정의 1 + 호출 ${uses - 1})`);
  else bad(`_secForm4Parse 사용이 ${uses}곳이다 — 한 경로가 제 파서로 돌아갔을 수 있다`);
  if (writers >= 2) ok("insider_feed 기록 경로가 여전히 둘이다 — 그래서 파서 통일이 계약이어야 한다");
}

// ── ② 공용 파서를 ★실제로 돌려★ 묶음 규칙을 못박는다 ──────────────────────
{
  const src = cut("function _secForm4Parse(xml, rev) {", "\n// [V12.123]");
  const ctx = vm.createContext({ String, Object });
  vm.runInContext(src + "\n globalThis.__p = _secForm4Parse;", ctx);
  const entry = (t, l, u) => `<entry><title>${t}</title><link href="${l}"/><updated>${u}</updated></entry>`;
  const acc = "0001234567-25-000001";
  const xml = "<feed>"
    + entry("4 - APPLE INC (0000320193) (Issuer)", "https://sec.gov/x/" + acc + "/z.htm", "2026-09-08T12:00:00-04:00")
    + entry("4 - COOK TIMOTHY D (0001214156) (Reporting)", "https://sec.gov/x/" + acc + "/z.htm", "2026-09-08T12:00:00-04:00")
    + entry("4/A - NVIDIA CORP (0001045810) (Issuer)", "https://sec.gov/x/0001045810-25-000009/z.htm", "2026-09-08T11:00:00-04:00")
    + entry("8-K - SOME CO (0000000001) (Filer)", "https://sec.gov/x/0000000001-25-000002/z.htm", "2026-09-08T10:00:00-04:00")
    + "</feed>";
  const out = ctx.__p(xml, { "0000320193": "AAPL" });
  const a = out[0] || {};
  if (out.length === 2) ok("발행사·보고자 두 entry 가 같은 접수번호로 ★한 건★ 으로 묶인다");
  else bad(`묶음이 깨졌다 — ${out.length}건이 나왔다(2건이어야 한다)`);
  if (a.company === "APPLE INC" && a.insider === "COOK TIMOTHY D" && a.ticker === "AAPL")
    ok("발행사·내부자·티커가 한 건에 모두 실린다(CIK→티커 역매핑 포함)");
  else bad("한 건 안에 발행사/내부자/티커가 다 안 실린다: " + JSON.stringify(a));
  if (out.some((f) => f.amended === true)) ok("정정공시(4/A)가 amended 로 구분된다");
  else bad("4/A 정정 표시가 사라졌다");
  if (!out.some((f) => /SOME CO/.test(f.company || ""))) ok("Form 4 가 아닌 공시(8-K)는 걸러진다");
  else bad("Form 4 가 아닌 공시가 섞여 들어온다");
  if (ctx.__p("", null).length === 0 && ctx.__p(null, null).length === 0)
    ok("빈 응답·null 에도 던지지 않고 빈 목록을 준다 — 거래 입력이 예외로 끊기지 않는다");
  else bad("빈 입력에서 동작이 불안정하다");
}

// ── ③ 시세 병합 규칙이 한 벌인가 ───────────────────────────────────────────
{
  const merges = (S.match(/dailyMaShort:\s*partial \?/g) || []).length;
  if (merges === 1) ok("시세 병합 필드표가 1벌뿐이다 — 새 일봉지표가 한 슬리브에서만 살아남는 일이 없다");
  else bad(`시세 병합 필드표가 ${merges}벌이다 — 지표를 한쪽에만 추가해도 게이트가 조용하다`);

  const cm = cut("async function saveQuoteCM(DB, symbol, q, partial) {", "\n// [V8.9]");
  if (/saveQuoteAlt\(DB, "cm",/.test(cm) && !/const merged = \{/.test(cm))
    ok("saveQuoteCM 은 자기 사본 없이 saveQuoteAlt 로 넘긴다");
  else bad("saveQuoteCM 이 다시 제 병합 사본을 갖고 있다");
  if (/q\.symbol === symbol.*Object\.assign/s.test(cm))
    ok("CM 호출자가 안 싣는 symbol 을 채워 넘긴다 — 저장 키가 종전과 같다");
  else bad("symbol 보정이 없다 — quote:undefined 로 저장돼 원자재 시세가 통째로 사라진다");
}

// ── ④ 표본 표의 '구 판 정리' 가 한 표에만 있지 않은가 ─────────────────────
//   V33.328 이전엔 ml_samples 에만 있었다. 나머지 넷은 판이 올라가도 옛 행이 영영 남아
//   D1 과 (featver, ts) 인덱스를 채웠다 — 학습은 못 읽는 행인데 자리는 차지한다.
//   표를 새로 만들 때 정리를 빠뜨리는 것이 이 저장소의 단골이라, ★표 목록에서★ 확인한다.
{
  const tables = [...new Set([...S.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+) ?\(/g)].map((m) => m[1]))]
    .filter((t) => new RegExp("CREATE TABLE IF NOT EXISTS " + t + " ?\\([^;]{0,400}featver").test(S));
  if (tables.length < 4) bad(`featver 를 가진 표본 표를 ${tables.length}개밖에 못 찾았다 — 이 검사가 헛돈다`);
  /* 표 하나가 '구 판 정리' 를 받는 방법은 두 가지다:
       ① 직접 DELETE … featver 로 거른다  (ml_samples · ml_candidates)
       ② _altPrune 목록에 실려 공용 루프가 지운다 (V33.328 에서 넷을 여기 실었다)
     [V33.359] ★`!=` 만 찾던 것을 `!=` 또는 `<` 로 넓힌다.★ 뜻은 같고 비용이 다르다 —
     `featver != ?` 는 인덱스를 못 타 112만 행 ★전수 스캔★ 이고(쿼리계획 실측: SCAN),
     `featver < ?` 는 (featver, ts) 인덱스를 탄다(COVERING INDEX). featVer 는 되감기지
     않으므로(check-stale-base) 두 조건이 가리키는 집합은 같다.
     이 절이 지켜야 할 것은 ★정리가 있는가★ 이지 그 철자가 아니다. */
  const direct = (t) => new RegExp("DELETE FROM " + t + "\\b[\\s\\S]{0,200}?featver\\s*(!=|<)\\s*").test(S);
  const li = S.indexOf("const _altPrune = [");
  const inList = li < 0 ? [] : [...S.slice(li, S.indexOf("];", li)).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  const missing = tables.filter((t) => !direct(t) && inList.indexOf(t) < 0);
  if (!missing.length && inList.length >= 4)
    ok(`featver 표본 표 ${tables.length}개(${tables.join(",")})가 전부 구 판 정리를 받는다`);
  else
    bad(`구 판 정리가 없는 표본 표: ${missing.join(", ") || "(_altPrune 목록을 못 읽었다)"} — 죽은 행이 D1 과 인덱스를 채운다`);
  if (!direct("ml_samples")) bad("ml_samples 의 구 판 정리가 사라졌다");
}

// ── ⑤ 슬리브별 초기자본 표가 한 벌인가 ────────────────────────────────────
//   종전엔 세 벌이었고 ★둘이 틀렸다★. applyCashflowToTWR 는 us/kr/cm 삼항이라
//   bdkr(₩100,000,000)이 cm($100,000)으로 떨어졌다 — 통화가 다른데 1,000배 어긋난다.
//   auditAccounting 은 숫자를 박아 두어 설정을 바꿔도 ASSET_INFLATE 문턱이 안 따라왔다.
//   지금은 둘 다 us/kr 로만 불려 증상이 없다 — 증상이 없을 때 합쳐 두는 것이 요점이다.
{
  const src = cut("function _initialCashFor(cfg, market) {", "async function computeCashFromTrades");
  const ctx = vm.createContext({});
  vm.runInContext(src + "\n globalThis.__f = _initialCashFor;", ctx);
  const cfg = { initialCashUS: 1, initialCashKR: 2, initialCashCM: 3, initialCashBDUS: 4, initialCashBDKR: 5 };
  const got = ["us", "kr", "cm", "bdus", "bdkr"].map((m) => ctx.__f(cfg, m)).join(",");
  if (got === "1,2,3,4,5") ok("슬리브 5종이 각자 제 초기자본을 받는다(채권이 원자재 금액으로 떨어지지 않는다)");
  else bad(`슬리브별 초기자본이 어긋난다: ${got} (기대 1,2,3,4,5)`);
  if (ctx.__f(cfg, "없는슬리브") === 3) ok("모르는 슬리브는 종전대로 cm 금액으로 폴백한다(동작 불변)");
  else bad("알 수 없는 슬리브 폴백이 바뀌었다");

  const users = (S.match(/_initialCashFor\(cfg, market\)/g) || []).length;
  if (users >= 3) ok(`초기자본을 고르는 곳 ${users}군데가 전부 같은 표를 쓴다`);
  else bad(`_initialCashFor 사용이 ${users}곳뿐이다 — 어딘가 제 사본으로 돌아갔다`);

  const twr = cut("async function applyCashflowToTWR(DB, market, valueBeforeFlow, flow, cfg) {", "\n  let twr =");
  if (!/initialCashCM/.test(twr)) ok("TWR 초기화가 더는 us/kr/cm 삼항을 쓰지 않는다");
  else bad("★TWR 초기화가 다시 삼항으로 돌아갔다 — 채권 슬리브가 통화가 다른 금액으로 시작한다★");
}

if (fails) { console.error(`\n✗ 단일 출처 계약 ${fails}건 실패`); process.exit(1); }
console.log("\n✓ 단일 출처 계약 통과 — 합쳐 둔 규칙이 다시 갈라지지 않았다");
