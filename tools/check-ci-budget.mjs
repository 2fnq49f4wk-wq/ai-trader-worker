/* [V33.368] CI 러너 시간 예산 계약 — ★배포가 3판 연속 막힌 진짜 이유★
 *
 *   실측(2026-09-15~16, GitHub Actions):
 *     12:03→12:58  Modal Watchdog(예약)  성공 · ★55분★
 *     15:20 이후   배포·Modal·예약 ★전부★ 3~5초 만에 실패
 *   커밋과 무관한 ★예약 실행까지★ 같이 죽었다 = 계정 차원(러너 시간 고갈)이다.
 *   그 탓에 V33.365(I-2 고침)·366(다운로드)·367(흰 화면)이 ★커밋만 되고 배포되지 않았다.★
 *
 *   원인: 워치독이 `modal run` 으로 ★Modal GPU 학습이 끝날 때까지 러너를 붙잡았다.★
 *   그동안 러너는 아무 일도 안 하면서 과금된다. 6시간마다 55분 = 월 6,600분 —
 *   무료 한도 2,000분의 3배다.
 *
 *   ★이 결함은 게이트 133종을 전부 통과하고도 일어났다.★ 게이트가 코드만 보고
 *   ★그 코드가 배포되는 길★ 은 안 봤기 때문이다. 여기서 그 길을 본다.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
const WF = ".github/workflows/";
let fail = 0, n = 0;
const ok = (c, m) => { n++; if (c) console.log("  ok   " + m); else { fail++; console.log("  ✗ FAIL " + m); } };

const files = readdirSync(WF).filter(f => f.endsWith(".yml") || f.endsWith(".yaml"));
ok(files.length > 0, `워크플로 ${files.length}개를 찾았다`);

/* YAML 파서를 쓰지 않는다(의존성 없음) — 필요한 것은 두 가지뿐이라 줄 단위로 읽는다:
   ① 각 job 의 timeout-minutes  ② 블로킹 학습 호출 */
function jobsOf(text) {
  const lines = text.split("\n");
  const out = [];
  let inJobs = false, cur = null;
  for (const l of lines) {
    if (/^jobs:\s*$/.test(l)) { inJobs = true; continue; }
    if (!inJobs) continue;
    if (/^\S/.test(l)) { inJobs = false; if (cur) out.push(cur); cur = null; continue; }
    const m = l.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (m) { if (cur) out.push(cur); cur = { name: m[1], timeout: null }; continue; }
    const t = l.match(/^\s+timeout-minutes:\s*(\d+)/);
    if (t && cur) cur.timeout = Number(t[1]);
  }
  if (cur) out.push(cur);
  return out;
}

console.log("\n  — 작업별 러너 시간 상한 —");
let capped = 0, total = 0;
for (const f of files) {
  const txt = readFileSync(WF + f, "utf8");
  for (const j of jobsOf(txt)) {
    total++;
    const okCap = j.timeout != null && j.timeout <= 120;
    if (okCap) capped++;
    console.log(`     ${f.padEnd(24)} ${j.name.padEnd(14)} ${j.timeout == null ? "★상한 없음★" : j.timeout + "분"}`);
    ok(okCap, `${f} · ${j.name} — 상한이 있고 120분 이하다` +
       (j.timeout == null ? " ★없으면 멎은 작업이 러너 시간을 끝까지 태운다★" : ""));
  }
}
ok(total === capped, `작업 ${total}개 전부 상한이 있다`);

// ── 예약(schedule)으로 도는 워크플로는 ★학습이 끝나기를 기다리면 안 된다★ ──────
console.log("\n  — 예약 실행이 GPU 학습을 붙잡고 기다리는가 —");
for (const f of files) {
  const txt = readFileSync(WF + f, "utf8");
  const scheduled = /^\s*schedule:\s*$/m.test(txt);
  if (!scheduled) continue;
  // 주석을 걷어내고 본다 — 설명 주석에 적은 예시를 실제 호출로 세면 안 된다.
  const code = txt.split("\n").filter(l => !/^\s*#/.test(l)).join("\n");
  const blocking = [...code.matchAll(/modal\s+run\s+(?!--detach)(?:--(?!detach)\S+\s+)*\S*modal_train\.py/g)];
  console.log(`     ${f} — 예약 있음 · 블로킹 학습 호출 ${blocking.length}건`);
  ok(blocking.length === 0,
     `★${f} 는 예약으로 도는데 학습을 기다리지 않는다★ (modal run --detach)` +
     (blocking.length ? ` — 지금 ${blocking.length}건이 기다린다(한 회 55분)` : ""));
  /* [V33.377] ★`--detach` 는 "즉시 빠진다" 를 뜻하지 않는다 — 실측이 그렇게 말한다.★
     run 156·157·158 이 세 번 다 14분 49초에 cancelled 됐다(timeout 15분). --detach 가
     보장하는 것은 "클라이언트가 끊겨도 앱은 산다" 이지 "클라이언트가 곧 끝난다" 가 아니다.
     그래서 ★비동기 호출(.spawn)★ 을 요구한다 — 이건 핸들만 받고 즉시 돌아온다. */
  ok(/\.spawn\(\)/.test(code) || /modal run --detach/.test(code),
     `${f} 가 학습을 ★걸고 빠진다★ (.spawn() 또는 --detach)`);
  ok(/\.spawn\(\)/.test(code),
     `${f} 가 ★진짜 비동기 호출(.spawn)★ 을 쓴다 — --detach 는 붙어서 로그를 흘린다(실측 15분 컷)`);
}

// ── 자가시험: 이 검사가 실제로 블로킹 호출을 잡는가(헛돌지 않는가) ───────────────
{
  const selfBad = "        run: |\n          modal run trainer/modal/modal_train.py\n";
  const selfGood = "        run: |\n          modal run --detach trainer/modal/modal_train.py\n";
  const rx = /modal\s+run\s+(?!--detach)(?:--(?!detach)\S+\s+)*\S*modal_train\.py/g;
  ok([...selfBad.matchAll(rx)].length === 1, "자가시험: 블로킹 호출을 잡는다");
  ok([...selfGood.matchAll(rx)].length === 0, "자가시험: --detach 는 안 잡는다(오탐 없음)");
}

/* ══ [V33.373] ★도구 설치가 그 도구를 쓰는 게이트보다 앞인가★ ═══════════════════
   파이썬으로 수학을 재현하는 게이트가 여럿인데 러너에는 numpy 가 없다.
   이 저장소는 이 함정을 ★두 번★ 밟았다 — 두 번 다 "설치를 그 검사 바로 앞에" 두는
   식으로 고쳐서, 나중에 앞쪽에 추가된 게이트가 또 걸렸다(V33.366 의 check-ic-honest 가
   68단계, 설치가 111단계였다). 로컬엔 numpy 가 있어 ★CI 에서만★ 나는 실패였다.
   순서를 사람 기억에 맡기지 않는다. */
console.log("\n  — 도구 설치 순서 —");
{
  const wf = readFileSync(WF + "deploy.yml", "utf8");
  const instAt = wf.indexOf("pip install --quiet --break-system-packages numpy");
  const firstGate = wf.search(/^\s*run:\s*node[^\n]*tools\/check-/m);
  ok(instAt > 0, "numpy 설치 단계가 있다(없으면 파이썬 재현 게이트가 전부 못 돈다)");
  ok(instAt > 0 && firstGate > 0 && instAt < firstGate,
     instAt < firstGate ? "numpy 설치가 ★첫 게이트보다 앞★ 이다 — 나중에 앞쪽에 게이트가 추가돼도 안전하다"
                        : "★numpy 설치가 게이트보다 뒤다★ — 그 앞에 놓인 파이썬 게이트는 CI 에서만 실패한다");
  // 파이썬을 부르는 게이트가 실제로 있는지 — 없으면 이 검사가 헛도는 것이다
  const pyGates = readdirSync("tools")
    .filter((f) => /^check-.*\.mjs$/.test(f))
    .filter((f) => /python3/.test(readFileSync("tools/" + f, "utf8")));
  console.log(`     파이썬을 부르는 게이트 ${pyGates.length}종`);
  ok(pyGates.length > 0, `파이썬 재현 게이트가 ${pyGates.length}종 있다(이 순서 검사가 헛돌지 않는다)`);
}

// ── 한 달 러너 시간 추정 — 무료 한도(2,000분) 안인가 ──────────────────────────
console.log("\n  — 한 달 러너 시간 추정 —");
{
  const wd = readFileSync(WF + "modal-watchdog.yml", "utf8");
  const cron = (wd.match(/cron:\s*'([^']+)'/) || [])[1] || "";
  const everyH = Number((cron.match(/\*\/(\d+)/) || [])[1] || 24);
  const perDay = Math.max(1, Math.round(24 / everyH));
  const wdCap = Number((wd.match(/timeout-minutes:\s*(\d+)/) || [])[1] || 0);
  /* [V33.377] ★추정치를 낙관으로 적지 않는다.★ 종전엔 "--detach 면 2분" 이라고 적었는데
     실측은 ★매번 상한(15분)까지 갔다★ — 그 숫자로 계산한 "월 240분" 은 거짓이었다.
     기다리지 않는 호출(.spawn)이면 실측 1~2분이 맞고, 아니면 ★상한을 그대로 최악값★ 으로 쓴다
     (멎으면 상한까지 가는 것이 관측된 동작이다). 모르면 나쁜 쪽으로 센다. */
  const wdTypical = /\.spawn\(\)/.test(wd) ? 2 : Math.max(15, Number((wd.match(/timeout-minutes:\s*(\d+)/) || [])[1] || 55));
  const monthly = wdTypical * perDay * 30;
  console.log(`     워치독 ${cron} → 하루 ${perDay}회 × ${wdTypical}분 = 월 ${monthly.toLocaleString()}분 (상한 ${wdCap}분)`);
  ok(monthly <= 600,
     `예약 워크플로의 월 러너 시간 추정 ${monthly.toLocaleString()}분 — 무료 한도 2,000분에 여유가 있다` +
     (monthly > 600 ? " ★배포가 막히면 고친 코드가 운영에 못 간다★" : ""));
}

console.log(fail ? `\n✗ CI 예산 계약 ${fail}건 실패 (총 ${n})` : `\n✓ CI 예산 계약 통과 (${n}개 단언)`);
process.exit(fail ? 1 : 0);
