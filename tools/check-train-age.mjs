/* [V33.580] ★워치독 나이 조회 계약★ — /api/ai/selfcheck 타임아웃(10/12 16:01Z rc=28)으로 신선한데도 GPU 학습을 걸던 것.
 *   ① externalTrainAges: 모델 본문 없이 나이 칸만 읽어 selfcheck 와 같은 행을 만든다(실제 sqlite · json_extract)
 *   ② tools/modal_freshness.py 가 그 응답을 그대로 읽어 '가장 오래된 필수 모델 나이' 를 낸다(9999 아님)
 *   ③ 배선: 엔드포인트(학습키) · selfcheck 가 같은 표(EXT_TRAIN_KEYS) · 워치독이 train-age 먼저 · 실패 시 selfcheck 로 물러남 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
const S = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const W = readFileSync(new URL("../.github/workflows/modal-watchdog.yml", import.meta.url), "utf8");
const M = await import("../src/index.js");
let fails = 0;
const chk = (c, m, d) => { if (c) console.log("  ok   " + m); else { fails++; console.log("  FAIL " + m + (d ? " — " + d : "")); } };

const sql = new DatabaseSync(":memory:");
sql.exec("CREATE TABLE state (k TEXT PRIMARY KEY, v TEXT, updated_ts INTEGER)");
const now = Date.UTC(2026, 9, 12, 16);
const H = 3600000;
const fv = (/featVer:\s*(\d+)/.exec(S.slice(S.indexOf("const LUXML = {"))) || [])[1];
const want = Number(fv);
const put = (k, o) => sql.prepare("INSERT INTO state (k, v, updated_ts) VALUES (?, ?, 0)").run(k, JSON.stringify(o));
put("mind_model", { source: "external", trainedAt: now - 3 * H, featVer: want, valAcc: 0.518, w: new Array(2000).fill(0.1) });
put("gbdt_trust", { source: "external", trainedAt: now - 5 * H, featVer: want, gbdtAcc: 0.68 });
put("xgb_trust", { source: "external", trainedAt: now - 9 * H, featVer: want });
put("xgb_trust_ext", { source: "external", trainedAt: now - 2 * H, featVer: want, reason: "shadow" });
put("lgb_trust", { source: "external", trainedAt: now - 4 * H, featVer: want });
put("cat_trust", { source: "external", trainedAt: now - 6 * H, featVer: want });
const DB = { prepare: (q) => { const st = { args: [], bind(...a) { st.args = a; return st; }, all: async () => ({ results: sql.prepare(q).all(...st.args) }) }; return st; } };
let A = null;
try { A = await M.externalTrainAges(DB, now); } catch (e) { chk(false, "externalTrainAges 실행", String(e)); }
if (A) {
  chk(A.mind.ageH === 3 && A.gbdt.ageH === 5 && A.cat.ageH === 6 && A.mind.external && A.mind.featVer === want && A.mind.wantVer === want, "나이·출처·판을 칸만으로 읽는다", JSON.stringify(A.mind));
  chk(A.xgb.ageH === 2 && A.xgb.shadow === true, "섀도우(_ext)가 더 새것이면 그것을 쓴다(latestExternalReceipt 그대로)", JSON.stringify(A.xgb));
  const py = execFileSync("python3", [new URL("./modal_freshness.py", import.meta.url).pathname], { input: JSON.stringify({ externalTrain: A }), encoding: "utf8" }).trim();
  chk(py === "6", "modal_freshness.py 가 그대로 읽는다 — 가장 오래된 필수 모델 6h(9999 아님)", py);
}
chk(/if \(path === "\/api\/ai\/train-age"\) \{\s*\n\s*const au = _trainAuthed\(\)/.test(S), "엔드포인트 /api/ai/train-age · 학습키");
chk(/const _mm = EXT_TRAIN_KEYS;/.test(S), "selfcheck 와 같은 표(EXT_TRAIN_KEYS)");
const iA = W.indexOf("/api/ai/train-age"), iS = W.indexOf("$URL/api/ai/selfcheck\")");
chk(iA > 0 && iS > iA && /for TRY in 1 2/.test(W) && /--max-time 90/.test(W), "워치독: train-age 두 번 → 실패 시 selfcheck(90초)로 물러남");

if (fails) { console.log("\n✗ 워치독 나이 조회 " + fails + "건 실패"); process.exit(1); }
console.log("\n✓ 워치독 나이 조회 통과");
