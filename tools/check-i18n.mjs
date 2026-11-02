// [V33.720] 언어 설정(한국어/English) 계약 — 사용자 11/2 "언어설정 만들어서 전체 언어 영어로도".
//   ① public/i18n-en.json 이 tools/i18n/*.tsv 빌드 결과와 같다(사전을 고치고 빌드를 잊지 않게)
//   ② index.html 이 i18n.js 를 싣고 사이드바에 언어 버튼(btnLang · data-noi18n)이 있다
//   ③ 한국어 기본일 때는 사전을 받지 않는다(비용 0) · 긴 자동 생성 글은 사전에 없으면 원문(한영 섞임 방지) · 단어 경계(종목명 보호)
import { readFileSync } from "node:fs";
import { build } from "./i18n/build.mjs";
let fails = 0;
const chk = (ok, good, bad) => { console.log((ok ? "  ok   " : "  FAIL ") + (ok ? good : bad)); if (!ok) fails++; };
const J = readFileSync(new URL("../public/i18n-en.json", import.meta.url), "utf8");
chk(J === build(), "i18n-en.json = TSV 빌드 결과", "★i18n-en.json 이 TSV 와 다르다 — node tools/i18n/build.mjs 를 돌려라★");
const d = JSON.parse(J);
chk(Object.keys(d.t).length >= 1000 && Object.keys(d.g).length >= 150, "사전 크기 틀 " + Object.keys(d.t).length + " · 용어 " + Object.keys(d.g).length, "★사전이 비었다★");
const bad = Object.entries(d.t).filter(([k, v]) => (k.match(/\{n\}/g) || []).length < (v.match(/\{n\}/g) || []).length);
chk(bad.length === 0, "번역문의 숫자 자리 수 ≤ 원문", "★번역문 숫자 자리가 원문보다 많다: " + bad.slice(0, 3).map((x) => x[0]).join(" | ") + "★");
const H = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
chk(/<script src="\/i18n\.js\?v=[\d.]+" defer><\/script>/.test(H), "index.html 이 i18n.js 를 싣는다", "★i18n.js 가 안 실린다★");
chk(/id="btnLang" data-noi18n/.test(H), "사이드바 언어 버튼(번역 제외 표시)", "★언어 버튼이 없다★");
const R = readFileSync(new URL("../public/i18n.js", import.meta.url), "utf8");
chk(/if \(lang === "en"\) load\(\);/.test(R), "한국어 기본은 사전을 받지 않는다", "★한국어일 때도 사전을 받는다★");
chk(/core\.length > 160\) out = core;/.test(R), "긴 글은 사전에 없으면 원문", "★긴 글 보호가 빠졌다★");
chk(/\(\?<!\[가-힣\]\)/.test(R), "용어는 단어 경계에서만(종목명 보호)", "★단어 경계가 빠졌다★");
console.log(fails === 0 ? "\n✓ 언어 설정 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
