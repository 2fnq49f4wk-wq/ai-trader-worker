// [V33.720] 언어 사전 빌드 — tools/i18n/en_*.tsv(틀: 숫자는 {n}) + glossary.tsv(용어) → public/i18n-en.json
//   실행: node tools/i18n/build.mjs   (check-i18n 게이트가 결과물이 TSV 와 같은지 본다)
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
const D = new URL("./", import.meta.url);
const NUMRE = /[+\-−]?\d[\d,]*(?:\.\d+)?/g;
// [V33.774] 원문 틀에 글자로 박힌 숫자(예: "20일선 아래 · 5일 {n}%" 의 20·5)도 화면에선 {n} 자리가 된다 — 번역 값에 같은 숫자가 글자로 남아 있으면
//   화면이 첫 숫자(20)를 엉뚱한 자리에 넣었다("5d 20%"). 원문 숫자 순서대로 번역 값의 같은 숫자를 {n} 으로 바꿔 자리 수를 맞춘다(순서가 어긋나면 그대로 둔다).
export function alignNums(k, v) {
  const slots = []; k.replace(/\{n\}|[+\-−]?\d[\d,]*(?:\.\d+)?/g, (m) => { slots.push(m === "{n}" ? null : m.replace(/^[+\-−]/, "")); return m; });
  if (!slots.some((x) => x != null)) return v;
  if ((v.match(/\{n\}/g) || []).length >= slots.length) return v;
  const toks = []; v.replace(/\{n\}|\d[\d,]*(?:\.\d+)?/g, (m, i) => { toks.push({ m, i }); return m; });
  let j = 0; const use = [];
  for (const sl of slots) {
    while (j < toks.length && !(sl == null ? toks[j].m === "{n}" : toks[j].m === sl)) j++;
    if (j >= toks.length) return v;
    use.push(toks[j]); j++;
  }
  let out = "", at = 0;
  for (const u of use) { out += v.slice(at, u.i) + "{n}"; at = u.i + u.m.length; }
  return out + v.slice(at);
}
export function build() {
  const t = {}, g = {};
  const rd = (f) => readFileSync(new URL(f, D), "utf8").split("\n").filter((l) => l.includes("\t"));
  for (const f of readdirSync(D).filter((x) => /^en_\d+\.tsv$/.test(x)).sort((a, b) => parseInt(a.slice(3)) - parseInt(b.slice(3)))) {
    for (const l of rd(f)) { const [k, v] = l.split("\t"); if (k && v != null) t[k.trim().replace(NUMRE, "{n}")] = alignNums(k.trim(), v); }
  }
  for (const f of ["glossary.tsv", ...readdirSync(D).filter((x) => /^glossary_\d+\.tsv$/.test(x)).sort()]) {   // glossary_N.tsv 는 나중 것이 앞 것을 덮는다
    for (const l of rd(f)) { const [k, v] = l.split("\t"); if (k && k.length >= 2) g[k] = v || ""; }
  }
  return JSON.stringify({ v: 1, t, g });
}
if (process.argv[1] && process.argv[1].endsWith("build.mjs")) {
  const out = build();
  writeFileSync(new URL("../../public/i18n-en.json", import.meta.url), out);
  const j = JSON.parse(out); console.log("i18n-en.json: 틀 " + Object.keys(j.t).length + " · 용어 " + Object.keys(j.g).length + " · " + out.length + "B");
}
