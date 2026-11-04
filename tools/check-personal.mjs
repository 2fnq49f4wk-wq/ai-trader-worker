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
chk(/txt\.length > 32768/.test(S), "본문 32KB 상한(모의계좌 포함 · V33.741)", "★본문 크기 상한이 없다★");
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
chk(/saveT = setTimeout\(push, 2000\)/.test(P) && /if \(loaded && !force\) return; loaded = true;/.test(P) && /Math\.min\(120000, 5000 \* Math\.pow\(3/.test(P) && /keepalive: true/.test(P) && /if \(!isDirty\(\) \|\| \(!synced && isAuth\(\)\)\) return;/.test(P) && /if \(loadingNow\) return; loadingNow = true;/.test(P), "D1: 읽기는 세션 1회 · 쓰기는 2초 모아 1회 · 재시도는 5초부터 3배씩(최대 2분) · 닫을 때는 남은 변경이 있을 때만", "★프로필 읽기·쓰기가 잦다★");
chk(/window\.openDetailFromSym = openDetailFromSym;/.test(H), "패널에서 종목 상세 열기(전역 노출)", "★openDetailFromSym 이 전역에 없다★");
chk(/!pg \|\| !pg\.classList\.contains\("active"\)\) return;/.test(P) && /170000/.test(P) && /!document\.hidden && pg\.classList\.contains\("active"\)/.test(P), "그리기·판정 조회는 MY 가 보일 때만 · 3분 간격", "★MY 가 숨어 있어도 갱신한다★");
const regs = ["SURGE", "BULL", "NEUTRAL", "BEAR", "CRASH"];
chk(regs.every((r) => new RegExp(r + ": \\{ safe: \"[^\"]+\", mid: \"[^\"]+\", aggr: \"[^\"]+\" \\}").test(P)), "국면 5종 × 성향 3종 행동 안내", "★국면·성향 안내가 빠졌다★");
chk(/모의투자 · 가상 자금 · 투자 권유가 아닙니다/.test(P) && /투자 판단과 결과의 책임은 본인에게/.test(P), "모의투자·투자 권유 아님 표기", "★면책 표기가 빠졌다★");
chk(/개인정보처리방침/.test(V) && /보유 기간/.test(V) && /비밀번호 자체는 저장하지 않습니다/.test(V) && /만 14세 미만/.test(V) && /국외 이전/.test(V) && /개인정보침해신고센터/.test(V), "개인정보 안내에 저장 항목", "★개인정보 안내가 없다★");
// [V33.723] 패스키 로그인 · 내 데이터 삭제 · 보존 1년 · 관심종목/검색 결과에도 [사기]
chk(/request\.method === "DELETE"/.test(S) && /DELETE FROM user_profiles WHERE uid_hash = \?/.test(S) && /id="mineDelete"|id === "mineDelete"/.test(P), "내 데이터 삭제(서버 프로필·모의계좌·계정)", "★데이터 삭제 경로가 없다★");
chk(/const LUX_RETAIN_MS = 365 \* 86400000;/.test(S) && /DELETE FROM user_profiles WHERE updated_ts < \?/.test(S) && /> 7 \* 86400000/.test(S), "보존 1년 자동 삭제 · 사용 표시는 7일에 1회만 쓰기", "★보존 기한 처리가 없다★");
// [V33.729] 닉네임 + 비밀번호(패스키 대체) — 비밀번호 원문 저장 금지 · PBKDF2 10만 회 · uid 는 비밀번호로만 풀리게 AES-GCM · 5회 실패 10분 잠금
chk(!/passkey/i.test(S.slice(S.indexOf("async function luxAuthApi") - 3000, S.indexOf("async function luxAuthApi") + 6000)) && !/\/api\/me\/passkey/.test(S) && /const LUX_PW_ITER = 100000;/.test(S) && /name: "PBKDF2", hash: "SHA-256", salt: salt, iterations: LUX_PW_ITER/.test(S) && /name: "AES-GCM", iv: iv/.test(S) && !/bind\([^)]*\bpw\b/.test(S),
    "비밀번호: 원문 저장 없음 · PBKDF2 10만 회 · 기기 코드는 비밀번호로만 풀림 · 패스키 경로 없음", "★비밀번호 저장 방식이 약하거나 패스키가 남았다★");
chk(/f >= 5 \? now \+ 600000/.test(S) && /luxRateOk\("auth:" \+ ip\)/.test(S) && /_luxSame\(d\.ver, a\.ver\)/.test(S), "무차별 대입 방지: 5회 실패 10분 잠금 · IP 분당 30 · 고정 시간 비교", "★로그인 대입 방지가 빠졌다★");
chk((P.match(/buyBtn\(/g) || []).length >= 4, "모의 매수 버튼: 오늘 후보·관심종목·검색 결과·보유 종목", "★[사기] 버튼이 오늘 후보에만 있다★");
// [V33.724] 첫 화면(패스키로 시작 / 이미 있음 / 로그인 없이) · 로그인 기억 · AI 순위(매수 신호 → 검증 대기 → 점수) + 관찰·사기
chk(/function ask\(target, mode\)/.test(P) && /id="gNick"/.test(P) && /id="gPw"/.test(P) && /id="gAgree"/.test(P) && /id="gGuest"/.test(P) && !/\n    gate\(\);/.test(P) && !/credentials\.(create|get)/.test(P), "로그인 창(닉네임·비밀번호·동의)은 대시보드·종목 상세 밖 메뉴로 갈 때 뜬다", "★로그인 창 흐름이 바뀌었다★");
chk(/window\.luxGuard=function\(id\)\{if\(id==='dashboard'\|\|id==='detail'\)return true;try\{if\(localStorage\.getItem\('lux-auth'\)\)return true;/.test(H) && /if \(window\.luxGuard && !window\.luxGuard\(id\)\)/.test(H), "로그인 없으면 대시보드·종목 상세만(showPage 첫 관문)", "★메뉴 제한이 빠졌다★");
chk(/location\.replace\('https:\/\/lux-inv\.com'/.test(H) && H.indexOf("workers\\.dev") < H.indexOf("lux-build"), "workers.dev 화면은 lux-inv.com 으로(맨 앞에서 · 기기 코드 #로 넘김)", "★workers.dev 이동이 빠졌다★");
chk(/function remember\(nick, since\)/.test(P) && /navigator\.storage\.persist\(\)/.test(P), "로그인 기억(코드·선택 저장 + 저장소 유지 요청)", "★로그인 기억이 없다★");
chk(/a\.tier - b\.tier \|\| b\.q - a\.q/.test(P) && /data-addwatch="' \+ esc\(r\.s\)/.test(P) && /buyBtn\(r\.s\)/.test(P), "AI 순위 · 줄마다 관찰·사기", "★AI 순위나 관찰·사기 버튼이 빠졌다★");
// [V33.725] 닉네임 중복 금지 · 장부 검사(조작 방지) · 순위 1시간 1회 계산 · 쓰기 분당 30 · 종목 상세 매매 막대
chk(/CREATE TABLE IF NOT EXISTS user_nicks \(nick_key TEXT PRIMARY KEY/.test(S) && /이미 쓰는 닉네임이에요", 409/.test(S) && /prof\.nick = \(old && old\.nick\) \|\| null;/.test(S), "닉네임: 중복 금지(대소문자 무시) · 가입 때 정함 · 화면이 직접 못 바꾼다", "★닉네임 중복 방지가 빠졌다★");
{
  const a = S.indexOf("const _luxRate"), b = S.indexOf("/* [V33.725·729] ★닉네임★");
  let f = null; try { f = new Function(S.slice(a, b) + "; return luxLedgerCheck;")(); } catch (e) { console.log(e.message); }
  const DB = { prepare: () => ({ bind: (...k) => ({ all: async () => ({ results: k.map((x) => ({ k: x, v: JSON.stringify({ price: 100, mstate: "REGULAR" }) })) }) }) }) };
  const ok = f && await f(DB, null, { us: { start: 10000, cash: 9000, pos: { AAPL: { q: 10, avg: 100 } }, hist: [[5, "B", "AAPL", 10, 100]], t0: 1 } });
  const fake = f && await f(DB, null, { us: { start: 10000, cash: 9900, pos: { AAPL: { q: 10, avg: 1 } }, hist: [[5, "B", "AAPL", 10, 10]], t0: 1 } });
  const pump = f && await f(DB, null, { us: { start: 10000, cash: 50000, pos: {}, hist: [], t0: 1 } });
  chk(ok && ok.ok && fake && !fake.ok && pump && !pump.ok, "장부 검사: 정상 통과 · 가짜 체결가·현금 부풀리기 거부", "★장부 검사가 조작을 못 막는다★");
}
chk(/swrJson\("leaderboard4", 3600000/.test(S) && /FROM user_accounts a JOIN user_lb l ON l\.uid_hash = a\.uid_hash/.test(S) && /await _luxLbPut\(DB, h, prof\.pf\)/.test(S) && /function luxRateOk\(key\)/.test(S) && /r\.n <= 30/.test(S), "순위는 1시간 1번 계산 · 기기당 쓰기 분당 30", "★순위 계산·쓰기 제한이 빠졌다★");
chk(/window\.luxMine\.detail\(symbol\)/.test(H) && /function detail\(sym\)/.test(P) && /data-dbuy/.test(P), "종목 상세에 모의 매매 막대", "★종목 상세에서 살 수 없다★");
// [V33.730] MTS 주문: 예약(지정가)·익절·손절 — 서버는 모양만 검사 · 화면이 시세로 체결 · 차트에 선
if (clean) {
  const o2 = clean({ pf: { us: { start: 10000, cash: 10000, pos: { NVDA: { q: 1, avg: 100, tpPx: 120, slPx: 90 } }, hist: [], ord: Array.from({ length: 30 }, (_, i) => ({ id: "x" + i, side: "B", s: "AAPL", px: 150, q: 2, tpPx: 170, slPx: 140 })).concat([{ side: "Z", s: "AAPL", px: 1, q: 1 }]) } } }).pf.us;
  chk(o2.pos.NVDA.tpPx === 120 && o2.pos.NVDA.slPx === 90 && o2.ord.length === 20 && o2.ord[0].tpPx === 170, "예약 주문 20건 상한 · 익절·손절 보관", "★예약 주문·익절·손절 저장 검사가 틀렸다★");
}
chk(/function runOrders\(\)/.test(P) && /p <= o\.px : p >= o\.px/.test(P) && /h\.tpPx && p >= h\.tpPx/.test(P) && /h\.slPx && p <= h\.slPx/.test(P) && /lines: \(window\.luxMine && window\.luxMine\.lines/.test(H) && /\[V33\.730\] 모의 주문 선/.test(H),
    "예약 체결·익절·손절 실행기 + 차트 선", "★주문 실행기나 차트 선이 빠졌다★");
console.log(fails === 0 ? "\n✓ 내 맞춤 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
