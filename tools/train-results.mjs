// [V33.201] 회차별 응답을 한 장으로 합친다.
//   target=all 은 무거운 단계마다 회차를 끊으므로 결과가 result-1..N.json 에 흩어진다.
//   요약이 마지막 회차 하나만 싣던 종전 방식은 ★완주했을 때 정작 아무것도 안 보여준다★ —
//   calibrate(ECE) · portstats(PSR/DSR) 처럼 파이프라인 끝에서 처음 나오는 값일수록 그렇다.
//   각 단계는 실제로 돈 회차에서만 문장을 남기므로, 회차를 순서대로 덮어쓰면 전체가 모인다.
import fs from "node:fs";
const files = fs.readdirSync(".").filter((f) => /^result-\d+\.json$/.test(f))
  .sort((a, b) => (+a.match(/\d+/)[0]) - (+b.match(/\d+/)[0]));
const merged = {};
const order = [];
for (const f of files) {
  let j; try { j = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { continue; }
  const r = j && j.results; if (!r) continue;
  for (const k of Object.keys(r)) {
    const v = String(r[k] == null ? "" : r[k]);
    // 실제로 돈 것만 남긴다 — 건너뜀 표시가 진짜 결과를 덮어쓰면 안 된다.
    if (/^skipped\(/.test(v)) { if (!(k in merged)) { merged[k] = v; order.push(k); } continue; }
    if (!(k in merged)) order.push(k);
    merged[k] = v;
  }
}
if (!order.length) { console.log("(회차 응답이 없다)"); process.exit(0); }
let ran = 0, skip = 0;
for (const k of order) {
  const v = merged[k];
  if (/^skipped\(/.test(v)) { skip++; console.log(`  ·  ${k.padEnd(12)} ${v}`); }
  else { ran++; console.log(`  ✔  ${k.padEnd(12)} ${v}`); }
}
console.log(`\n실행 ${ran}단계 · 미실행 ${skip}단계 (회차 파일 ${files.length}개)`);
