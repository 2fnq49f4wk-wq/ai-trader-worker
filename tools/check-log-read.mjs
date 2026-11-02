// [V33.722] 로그 D1 계약 — 사용자 11/2 "로그는 설정창 안으로 · D1 낭비면 중단하고 경고만".
//   ① 사이드바 LOG 버튼은 숨김 · 설정창 '경고·오류 로그' 는 누를 때만(/api/logs?warn=1 · 기본키 범위 3,000행 · 60초 캐시 · 자동 갱신 없음)
//   ② 반복 안내 로그(실적 관문 차단 · V64 CTX)는 종류별 30분 1회만 D1 에 쓴다(쓰기의 ~85% 였다)
//   ③ AI 두뇌 판정 피드는 20초 간격
import { readFileSync } from "node:fs";
let fails = 0;
const chk = (ok, good, bad) => { console.log((ok ? "  ok   " : "  FAIL ") + (ok ? good : bad)); if (!ok) fails++; };
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const H = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
chk(/id="btnLogs" style="display:none;"/.test(H) && !/data-proxy="btnLogs"/.test(H), "사이드바·모바일 메뉴에 LOG 버튼 없음", "★LOG 버튼이 다시 보인다★");
chk(/id="btnWarnLogs"/.test(H) && /fetch\('\/api\/logs\?warn=1'\)/.test(H) && !/setInterval\([^)]*__luxWarnLogs/.test(H), "설정창 경고·오류 로그(누를 때만)", "★설정창 경고 로그가 없거나 자동 갱신한다★");
chk(/WHERE id > \(SELECT MAX\(id\) FROM logs\) - 3000 AND level <> 'INFO' ORDER BY id DESC LIMIT 150/.test(S) && /__wc && \(Date\.now\(\) - __wc\.ts\) < 60000/.test(S), "경고 조회는 3,000행 범위 · 60초 캐시", "★경고 조회 범위·캐시가 빠졌다★");
const noisy = ['logEvery(DB, "INFO", "pg:" + _pg.key', 'logEvery(DB, "INFO", "pgc:" + _pgC.key', 'logEvery(DB, "INFO", "pga:" + _pgA.key', 'logEvery(DB, "INFO", "ctx:block"', 'logEvery(DB, "INFO", "ctx:scalp"', 'logEvery(DB, "INFO", "ctx:size"'];
chk(noisy.every((x) => S.includes(x)) && !/await log\(DB, "INFO", symbol, "BUY 실적 관문 차단/.test(S) && !/await log\(DB, "INFO", symbol, "\[V64 CTX\]/.test(S), "반복 안내 로그는 종류별 30분 1회", "★반복 안내 로그가 매번 D1 에 쓴다★");
chk(/FEED\.timer = setInterval\(pollFeed, 20000\)/.test(H), "AI 두뇌 판정 피드 20초", "★판정 피드 간격이 짧아졌다★");
console.log(fails === 0 ? "\n✓ 로그 D1 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
