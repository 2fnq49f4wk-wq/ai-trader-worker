/* [V33.378] 과적합 진단이 ★맞는 처방★ 을 내는가 — 실제 분기를 돌려 본다.
 *
 *   ★왜★ 실측(run 35149059451, 2026-09-16):
 *       [과적합진단] train 47.17% vs val 49.23% → 격차 -2.07%p — 과적합 낮음(→신호·피처·라벨 품질이 병목)
 *   격차가 ★음수★ 인데 "과적합이 낮다" 고 답했다. 음수는 ★학습집합조차 못 맞힌다★ 는 뜻이고
 *   (train 47.17% 는 다수클래스 50.8% 보다도 낮다), 처방이 정반대다 —
 *   피처를 더 만들 일이 아니라 규제를 풀거나 보정 전이를 의심할 일이다.
 *   분기가 둘뿐이라 세 번째 경우가 두 번째로 흘러들어갔다.
 *
 *   ★그리고 음수의 원인이 둘이다.★ τ* 는 보정구간에서 골라 bias 에 영구 반영되는데,
 *   학습구간은 양성비율이 달라 같은 시프트가 정확도를 그 이유만으로 떨어뜨릴 수 있다.
 *   진단이 둘을 갈라 말해야 사람이 옳은 곳을 고친다.
 *
 *   이 검사는 문장을 세지 않는다 — 소스의 분기를 ★떼어 내 실제로 돌려★ 판정을 받는다.
 */
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PY = readFileSync(join(root, "trainer/modal/modal_train.py"), "utf8");
let fails = 0, n = 0;
const ok = (c, m) => { n++; if (c) console.log("  ok   " + m); else { fails++; console.error("  ✗ FAIL " + m); } };

/* 판정부를 소스에서 그대로 떼어 온다 — 옮겨 적으면 언젠가 갈라진다.
   (고정 길이로 자르지 않는다: 시작·끝 표지로 찾는다. V33.289·V33.377 의 교훈.) */
const A = PY.indexOf("            if gap > 0.05:");
const B = PY.indexOf('            print(f"   [과적합진단]', A);
ok(A > 0 && B > A, "판정 분기를 소스에서 떼어 왔다");
if (A < 0 || B < 0) { console.error("\n✗ 판정부를 못 찾는다 — 검사가 헛돈다"); process.exit(1); }
const BRANCH = PY.slice(A, B).split("\n").map((l) => l.replace(/^            /, "")).join("\n");

const script = `
import json
BRANCH = ${JSON.stringify(BRANCH)}
def judge(gap, train_acc, tr_raw, maj):
    g = {"gap": gap, "train_acc": train_acc, "_tr_raw": tr_raw, "_maj": maj}
    exec(BRANCH, {}, g)
    return g["verdict"]
out = {
  # ① 진짜 과적합
  "overfit":  judge(0.12, 0.62, 0.62, 0.508),
  # ② 실측 그대로 — 음수 격차, τ* 되돌려도 여전히 낮다 → 과소적합
  "measured": judge(-0.0207, 0.4717, 0.4750, 0.508),
  # ③ 음수인데 τ* 되돌리면 확 오른다 → 보정 전이 문제
  "caltrans": judge(-0.0207, 0.4717, 0.5400, 0.508),
  # ④ 격차가 거의 0 — 종전 문구 그대로(무해성)
  "flat":     judge(0.005, 0.5300, 0.5300, 0.508),
}
print(json.dumps(out, ensure_ascii=False))
`;
const tmp = join(tmpdir(), "fitdiag-" + process.pid + ".py");
let R;
try { writeFileSync(tmp, script); R = JSON.parse(execFileSync("python3", [tmp], { encoding: "utf8", timeout: 60000 }).trim()); }
catch (e) { console.error("  ✗ FAIL 판정부 실행 실패: " + String(e.stdout || e.message).slice(0, 400)); process.exit(1); }
finally { try { unlinkSync(tmp); } catch (e) {} }

console.log("");
for (const k of ["overfit", "measured", "caltrans", "flat"]) console.log(`     ${k.padEnd(9)} → ${R[k]}`);
console.log("");

ok(/과적합 경향/.test(R.overfit), "격차가 크게 양수면 ★과적합★ 이라고 한다(종전 동작 그대로)");
ok(/과소적합/.test(R.measured),
   "★실측 그대로의 입력(-2.07%p)에서 '과소적합' 이라고 한다★ — 종전엔 '과적합 낮음' 이었다");
ok(!/신호·피처·라벨/.test(R.measured),
   "★그 경우에 '피처 품질이 병목' 이라고 하지 않는다★ — 처방이 정반대로 나가던 자리다");
ok(/보정 전이/.test(R.caltrans),
   "τ* 를 되돌리면 정확도가 오르는 경우는 ★보정 전이 문제★ 로 따로 말한다");
ok(!/과소적합/.test(R.caltrans), "그 경우를 과소적합과 섞지 않는다 — 고칠 곳이 다르다");
ok(/신호·피처·라벨/.test(R.flat), "격차가 거의 0 이면 종전 문구 그대로다(무해성)");
ok(/다수클래스/.test(R.measured), "과소적합 판정에 ★비교 기준(다수클래스)★ 을 같이 적는다");

/* τ* 되돌린 값을 ★실제로 계산해서★ 찍는가 — 안 그러면 위 분기가 항상 같은 쪽으로 간다. */
ok(/_tr_raw = float\(\(\(\(1\.0 \/ \(1\.0 \+ np\.exp\(-\(_ztr \+ float\(delta\)\)\)\)\) >= 0\.5\)/.test(PY),
   "τ* 시프트를 되돌린 학습정확도를 실제로 계산한다(로짓에 delta 를 다시 더한다)");
/* ★이름 끝만 보면 안 된다.★ `delta = 0.0` 은 `_unused_delta = 0.0` 의 부분문자열이라
   변수를 통째로 딴 이름으로 바꿔도 통과했다 — 돌연변이 시험에서 실제로 안 잡혔다.
   줄 시작(들여쓰기 뒤)에 바로 `delta` 가 오는지를 본다. */
ok(/\n\s*delta = 0\.0(?![0-9])/.test(PY),
   "보정을 안 한 회차에도 delta 가 정의돼 있다(NameError 로 진단이 통째로 날아가지 않는다)");
ok(PY.indexOf("\n        delta = 0.0") < PY.indexOf("delta = math.log(tau / (1 - tau))"),
   "그 기본값이 τ* 계산보다 ★앞★ 에 있다(뒤에 있으면 아무 소용이 없다)");
ok(/τ\*되돌림/.test(PY), "두 값을 ★함께★ 찍는다 — 읽는 사람이 직접 가를 수 있다");

if (fails) { console.error(`\n✗ 적합 진단 계약 ${fails}건 실패 (총 ${n})`); process.exit(1); }
console.log(`\n✓ 적합 진단 계약 통과 (${n}개 단언) — 진단이 ★고칠 곳★ 을 가리킨다`);
