// [V33.178] 워커 로그(/api/logs 응답)에서 필요한 줄만 시간순으로 뽑는다.
//
//   워크플로 YAML 안에 파이썬 heredoc 을 박으면 블록 스칼라의 들여쓰기가 깨진다(실제로 깨졌다).
//   진단 도구는 저장소에 파일로 두는 편이 낫다 — 로컬에서 그대로 돌려볼 수 있고, 고칠 때
//   워크플로를 건드리지 않아도 된다.
//
//   사용: node tools/pick-logs.mjs <logs.json> [필터문자열] [최대줄수]
//   /api/logs 는 최신순으로 주므로 뒤집어 오래된 것부터 싣는다 — 진행을 읽으려면 그 순서가 맞다.

import { readFileSync } from "node:fs";

const [file, filter = "", maxLines = "120"] = process.argv.slice(2);
if (!file) { console.error("사용: node tools/pick-logs.mjs <logs.json> [필터] [최대줄수]"); process.exit(2); }

let rows;
try {
  rows = JSON.parse(readFileSync(file, "utf8"));
} catch (e) {
  console.log("(로그 JSON 을 읽지 못했다: " + (e && e.message) + ")");
  process.exit(0);
}
if (!Array.isArray(rows)) { console.log("(로그 형식이 배열이 아니다)"); process.exit(0); }

const cap = Math.max(1, parseInt(maxLines, 10) || 120);
const fmt = (ts) => {
  const n = Number(ts) || 0;
  if (!n) return String(ts || "?");
  // UTC 로 적는다 — 러너·워커·사람이 각자 다른 시간대에 있어 현지시각으로 적으면 서로 못 맞춘다.
  return new Date(n).toISOString().replace("T", " ").slice(5, 19);
};

const picked = [];
for (let i = rows.length - 1; i >= 0; i--) {       // 최신순 → 시간순
  const r = rows[i] || {};
  const msg = String(r.message == null ? "" : r.message);
  if (filter && !msg.includes(filter)) continue;
  picked.push(fmt(r.ts) + " UTC [" + (r.level || "?") + "] " + msg);
}

console.log(picked.length ? picked.slice(-cap).join("\n") : "(해당 줄 없음)");
console.log("");
console.log("— 전체 " + rows.length + "줄 중 " + picked.length + "줄이 필터에 걸림" +
            (picked.length > cap ? " (마지막 " + cap + "줄만 표시)" : "") + " —");
