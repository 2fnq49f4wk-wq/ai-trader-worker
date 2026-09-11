/* [V33.348] 유니버스 3곳 동기화 — ★CLAUDE.md 규칙을 보는 게이트가 하나도 없었다★
 *
 *   CLAUDE.md: "종목 추가 시 세 곳을 함께 갱신한다: DEFAULT_KR(유니버스) · NAME_MAP(종목명) ·
 *   MCAP_RANK(시총순위 정적 폴백)". 규칙은 있는데 지켜지는지 보는 것이 없어서,
 *   미국 섹터 ETF 12종(XLK·XLV·…·DIA)이 ETF_SYMBOLS·ETF_TYPE 에만 등재되고 두 맵에서 빠졌다.
 *   빠진 종목은 화면에 티커로만 뜨고, MCAP_RANK[sym] || 99999 로 떨어져 시총 정렬 최하위가 된다.
 *
 *   ★소스 문자열을 세지 않는다★(V33.337 교훈) — 네 블록을 잘라 노드에서 ★실제로 읽어★
 *   집합 연산으로 확인한다. 그래서 상수를 어떻게 다시 적어도 뜻이 지켜진다.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SRC = readFileSync(new URL("../src/index.js", import.meta.url), "utf8").split("\n");

/* 'const NAME = [' / '{' 부터 열림-닫힘이 맞는 줄까지 잘라 온다.
   (이름을 찾지 못하면 그 자체가 실패다 — 상수가 사라졌거나 이름이 바뀐 것이다) */
function block(name, open, close) {
  const i = SRC.findIndex((l) => l.startsWith("const " + name + " = " + open));
  if (i < 0) throw new Error(name + " 선언을 찾지 못했다");
  for (let j = i + 1; j < SRC.length; j++) if (SRC[j] === close) return SRC.slice(i, j + 1).join("\n");
  throw new Error(name + " 의 끝을 찾지 못했다");
}
const src = [block("DEFAULT_US", "[", "];"), block("DEFAULT_KR", "[", "];"),
             block("NAME_MAP", "{", "};"), block("MCAP_RANK", "{", "};"),
             "module.exports={DEFAULT_US,DEFAULT_KR,NAME_MAP,MCAP_RANK};"].join("\n");
const dir = mkdtempSync(join(tmpdir(), "unisync-"));
const f = join(dir, "uni.cjs");
writeFileSync(f, src);
const { DEFAULT_US, DEFAULT_KR, NAME_MAP, MCAP_RANK } = createRequire(import.meta.url)(f);

let fail = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "✗ FAIL ") + m); if (!c) fail++; };
const show = (a) => a.slice(0, 10).join(", ") + (a.length > 10 ? ` 외 ${a.length - 10}종` : "");

const all = DEFAULT_US.concat(DEFAULT_KR);
const allSet = new Set(all);
ok(DEFAULT_US.length > 100 && DEFAULT_KR.length > 100 && Object.keys(NAME_MAP).length > 100,
   `읽기 성공 — US ${DEFAULT_US.length} · KR ${DEFAULT_KR.length} · NAME_MAP ${Object.keys(NAME_MAP).length} · MCAP_RANK ${Object.keys(MCAP_RANK).length}`);

// ① 세 곳 규칙 — 유니버스에 있으면 두 맵에도 있어야 한다
for (const [label, map] of [["NAME_MAP", NAME_MAP], ["MCAP_RANK", MCAP_RANK]]) {
  const miss = all.filter((s) => map[s] == null);
  ok(miss.length === 0, miss.length ? `${label} 누락 ${miss.length}종: ${show(miss)}` : `${label} 누락 0 (세 곳 규칙 지켜짐)`);
}
// ② 고아 — 유니버스에 없는데 맵에만 있는 것
for (const [label, map] of [["NAME_MAP", NAME_MAP], ["MCAP_RANK", MCAP_RANK]]) {
  const orph = Object.keys(map).filter((k) => !allSet.has(k));
  ok(orph.length === 0, orph.length ? `${label} 고아 ${orph.length}종: ${show(orph)}` : `${label} 고아 0`);
}
// ③ 중복 — 같은 목록 안, 그리고 두 시장 사이
const dup = (a) => { const s = new Set(), d = []; for (const x of a) { if (s.has(x)) d.push(x); s.add(x); } return d; };
ok(dup(DEFAULT_US).length === 0, `DEFAULT_US 중복 ${dup(DEFAULT_US).length}건`);
ok(dup(DEFAULT_KR).length === 0, `DEFAULT_KR 중복 ${dup(DEFAULT_KR).length}건`);
const both = DEFAULT_US.filter((s) => DEFAULT_KR.includes(s));
ok(both.length === 0, both.length ? `두 시장에 동시 등재: ${show(both)}` : "두 시장 교차 중복 0");

// ④ 접미사 — CLAUDE.md: 티커는 네이버 기준(KOSPI .KS / KOSDAQ .KQ)
const krBad = DEFAULT_KR.filter((s) => !/\.(KS|KQ)$/.test(s));
ok(krBad.length === 0, krBad.length ? `KR 접미사 누락: ${show(krBad)}` : "KR 전 종목이 .KS/.KQ 접미사를 갖는다");
const usBad = DEFAULT_US.filter((s) => /\.(KS|KQ)$/.test(s));
ok(usBad.length === 0, usBad.length ? `US 목록에 KR 접미사: ${show(usBad)}` : "US 목록에 KR 접미사 섞임 0");

// ⑤ 순위값이 숫자이고 양수인가 — MCAP_RANK[sym] || 99999 이므로 0 은 조용히 최하위가 된다
const badRank = all.filter((s) => !(typeof MCAP_RANK[s] === "number" && MCAP_RANK[s] > 0));
ok(badRank.length === 0, badRank.length ? `순위가 숫자/양수가 아님: ${show(badRank)}` : "모든 순위가 양의 정수");

/* ⑥ 시장 안에서 순위가 ★순서★ 인가(동점 금지).
   rvPanel 이 이 값을 '예전 순위' 로 삼아 실시간 순위와의 드리프트를 잰다 — 동점이면 그 답이 없다.
   ※ 지금은 미국 구간에 동점 28쌍이 남아 있다(docs/OPEN-DEFECTS.md F-2). 고칠 때까지는
     ★늘어나지만 않게★ 막는다. 줄이면 이 숫자를 같이 내릴 것. */
const F2_KNOWN_US_TIES = 29;   // 동점 그룹 28개 = 초과 심볼 29개(rank 9 는 3종이라 2개를 낸다)
for (const [label, list, cap] of [["US", DEFAULT_US, F2_KNOWN_US_TIES], ["KR", DEFAULT_KR, 0]]) {
  const by = {};
  for (const s of list) { const v = MCAP_RANK[s]; if (v != null) (by[v] = by[v] || []).push(s); }
  const ties = Object.entries(by).filter(([, v]) => v.length > 1);
  const n = ties.reduce((a, [, v]) => a + v.length - 1, 0);
  ok(n <= cap, `${label} 시장 내 순위 동점 ${n}건 (허용 ${cap}${cap ? " — F-2 미해결분, 늘면 실패" : ""})` +
     (n > cap ? ` → ${ties.slice(0, 3).map(([r, v]) => r + ":" + v.join("·")).join(" / ")}` : ""));
}

console.log(fail ? `\n실패 ${fail}건` : "\n전부 통과");
process.exit(fail ? 1 : 0);
