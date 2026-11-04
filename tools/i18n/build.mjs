// [V33.720] 언어 사전 빌드 — tools/i18n/en_*.tsv(틀: 숫자는 {n}) + glossary.tsv(용어) → public/i18n-en.json
//   실행: node tools/i18n/build.mjs   (check-i18n 게이트가 결과물이 TSV 와 같은지 본다)
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
const D = new URL("./", import.meta.url);
export function build() {
  const t = {}, g = {};
  const rd = (f) => readFileSync(new URL(f, D), "utf8").split("\n").filter((l) => l.includes("\t"));
  for (const f of readdirSync(D).filter((x) => /^en_\d+\.tsv$/.test(x)).sort((a, b) => parseInt(a.slice(3)) - parseInt(b.slice(3)))) {
    for (const l of rd(f)) { const [k, v] = l.split("\t"); if (k && v != null) t[k.trim().replace(/[+\-−]?\d[\d,]*(?:\.\d+)?/g, "{n}")] = v; }
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
