// [V33.721] 내 맞춤(개인화) 계약 — 사용자 11/2 "개인 수요에 맞게 · 수익화는 나중 · 구현부터".
//   ① /api/me 는 기기 토큰의 SHA-256 만 키로 쓰고(원문 토큰 저장 금지) 프로필을 좁게 검사한다(4KB · 허용 값만 · 관심종목 40)
//   ② personal.js 가 실리고, 패널 갱신은 대시보드가 보이고 탭이 보일 때만(화면 부담) · 국면 5종 × 성향 3종 안내가 다 있다
//   ③ 개인정보 안내에 저장 항목이 적혀 있다 · 모의투자·투자 권유 아님 표기
import { readFileSync } from "node:fs";
let fails = 0;
const chk = (ok, good, bad) => { console.log((ok ? "  ok   " : "  FAIL ") + (ok ? good : bad)); if (!ok) fails++; };
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const P = readFileSync(new URL("../public/mine.js", import.meta.url), "utf8");
const H = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const V = readFileSync(new URL("../public/privacy.html", import.meta.url), "utf8");
chk(/if \(path === "\/api\/me"\) \{/.test(S) && /\^\[0-9a-f\]\{32,64\}\$/.test(S), "/api/me 라우트 · 토큰 형식 검사", "★/api/me 가 없거나 토큰 검사가 빠졌다★");
chk(/crypto\.subtle\.digest\("SHA-256", new TextEncoder\(\)\.encode\("lux-profile:" \+ uid\)\)/.test(S) && !/bind\(uid,/.test(S), "토큰은 해시로만 저장", "★원문 토큰을 저장한다★");
chk(/txt\.length > 16384/.test(S), "본문 16KB 상한(모의계좌 포함)", "★본문 크기 상한이 없다★");
// luxProfileClean 을 실제로 돌린다
const a = S.indexOf("const LUX_PROFILE"), b = S.indexOf("async function luxProfileApi");
let clean = null;
try { clean = new Function(S.slice(a, b) + "; return luxProfileClean;")(); } catch (e) { console.log(e.message); }
if (clean) {
  const pf = clean({ pf: { us: { start: 10000, cash: 5000, pos: { NVDA: { q: 10, avg: 200 }, "<x>": { q: 1, avg: 1 } }, hist: [[1, "B", "NVDA", 10, 200], ["x"]] }, jp: { start: 1, cash: 1 } } }).pf;
  chk(pf && pf.us && pf.us.pos.NVDA && !pf.us.pos["<X>"] && pf.us.hist.length === 1 && !pf.jp, "모의계좌 모양 검사(허용 시장·종목·내역만)", "★모의계좌 검사가 넓다: " + JSON.stringify(pf).slice(0, 120) + "★");
  const o = clean({ risk: "yolo", mkts: ["us", "jp", "kr", "us"], horizon: "long", exp: "pro", watch: Array.from({ length: 60 }, (_, i) => "S" + i).concat(["<script>"]), done: true, evil: 1 });
  chk(o.risk === "mid" && o.mkts.join() === "us,kr" && o.horizon === "long" && o.watch.length === 40 && !("evil" in o) && o.done === true,
      "허용 값만 저장(위험 성향 기본값 · 모르는 시장 제외 · 관심종목 40 · 모르는 키 버림)", "★프로필 검사가 넓다: " + JSON.stringify(o).slice(0, 120) + "★");
  let threw = false; try { clean(null); } catch (e) { threw = e.code === 400; }
  chk(threw, "빈 본문은 400", "★빈 본문을 받는다★");
} else chk(false, "", "★luxProfileClean 을 못 읽었다★");
chk(/<script src="\/mine\.js\?v=[\d.]+" defer><\/script>/.test(H) && /class="nav-item" data-page="mine"/.test(H) && /id="page-mine"/.test(H) && /\{ id:'mine', ic:NV\.user, tx:'MY' \}/.test(H),
    "mine.js · 사이드바 MY 메뉴 · MY 페이지 · 모바일 탭", "★MY 메뉴·페이지·모바일 탭 중 빠진 것이 있다★");
chk(!/id="luxMine"/.test(P) && !/btnMine/.test(H), "대시보드 맨 위 패널 없음(사용자 11/2 — 사이드바 메뉴로)", "★대시보드 위 패널이 남아 있다★");
chk(/saveT = setTimeout\(function \(\) \{ api\("POST", prof\)/.test(P) && /if \(loaded && !force\) return; loaded = true;/.test(P), "D1: 읽기는 MY 첫 열림 1회 · 쓰기는 2초 모아 1회", "★프로필 읽기·쓰기가 잦다★");
chk(/window\.openDetailFromSym = openDetailFromSym;/.test(H), "패널에서 종목 상세 열기(전역 노출)", "★openDetailFromSym 이 전역에 없다★");
chk(/!pg \|\| !pg\.classList\.contains\("active"\)\) return;/.test(P) && /170000/.test(P) && /!document\.hidden && pg\.classList\.contains\("active"\)/.test(P), "그리기·판정 조회는 MY 가 보일 때만 · 3분 간격", "★MY 가 숨어 있어도 갱신한다★");
const regs = ["SURGE", "BULL", "NEUTRAL", "BEAR", "CRASH"];
chk(regs.every((r) => new RegExp(r + ": \\{ safe: \"[^\"]+\", mid: \"[^\"]+\", aggr: \"[^\"]+\" \\}").test(P)), "국면 5종 × 성향 3종 행동 안내", "★국면·성향 안내가 빠졌다★");
chk(/모의투자 · 가상 자금 · 투자 권유가 아닙니다/.test(P) && /투자 판단과 결과의 책임은 본인에게/.test(P), "모의투자·투자 권유 아님 표기", "★면책 표기가 빠졌다★");
chk(/MY\(내 투자\) · 모의계좌 · 패스키 \(2026-11-02\)/.test(V) && /보존 기간/.test(V), "개인정보 안내에 저장 항목", "★개인정보 안내가 없다★");
// [V33.723] 패스키 로그인 · 내 데이터 삭제 · 보존 1년 · 관심종목/검색 결과에도 [사기]
chk(/request\.method === "DELETE"/.test(S) && /DELETE FROM user_profiles WHERE uid_hash = \?/.test(S) && /id="mineDelete"|id === "mineDelete"/.test(P), "내 데이터 삭제(서버 프로필·모의계좌·패스키)", "★데이터 삭제 경로가 없다★");
chk(/const LUX_RETAIN_MS = 365 \* 86400000;/.test(S) && /DELETE FROM user_profiles WHERE updated_ts < \?/.test(S) && /> 7 \* 86400000/.test(S), "보존 1년 자동 삭제 · 사용 표시는 7일에 1회만 쓰기", "★보존 기한 처리가 없다★");
chk(/cd\.origin !== origin/.test(S) && /_pkCheckChallenge\(DB, cd\.challenge, "reg"\)/.test(S) && /_pkCheckChallenge\(DB, cd\.challenge, "auth"\)/.test(S) && /crypto\.subtle\.verify\(\{ name: "ECDSA", hash: "SHA-256" \}/.test(S) && /rpHash/.test(S),
    "패스키: 출처·일회 도전값(5분 · 서명)·rpId·ECDSA 서명 검증", "★패스키 검증이 빠졌다★");
chk((P.match(/buyBtn\(/g) || []).length >= 4, "모의 매수 버튼: 오늘 후보·관심종목·검색 결과·보유 종목", "★[사기] 버튼이 오늘 후보에만 있다★");
// [V33.724] 첫 화면(패스키로 시작 / 이미 있음 / 로그인 없이) · 로그인 기억 · AI 순위(매수 신호 → 검증 대기 → 점수) + 관찰·사기
chk(/function gate\(\)/.test(P) && /id="gStart"/.test(P) && /id="gLogin"/.test(P) && /id="gGuest"/.test(P) && /localStorage\.getItem\("lux-gate"\)/.test(P), "첫 화면 로그인 선택(패스키 시작·로그인·로그인 없이)", "★첫 화면 선택이 없다★");
chk(/function remember\(kind\)/.test(P) && /navigator\.storage\.persist\(\)/.test(P), "로그인 기억(코드·선택 저장 + 저장소 유지 요청)", "★로그인 기억이 없다★");
chk(/a\.tier - b\.tier \|\| b\.q - a\.q/.test(P) && /data-addwatch="' \+ esc\(r\.s\)/.test(P) && /buyBtn\(r\.s\)/.test(P), "AI 순위 · 줄마다 관찰·사기", "★AI 순위나 관찰·사기 버튼이 빠졌다★");
console.log(fails === 0 ? "\n✓ 내 맞춤 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
