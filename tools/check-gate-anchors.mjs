/* [V33.328] 게이트 앵커 생존 검사 — ★검사가 조용히 헛도는 것★ 을 막는다
 *
 *   왜 이 게이트가 필요한가 (2026-09-09 하루에 두 번 같은 일이 났다):
 *     ① check-holdout-anchor.mjs — 소스에 같은 문구가 두 곳이 되자 String.replace 가
 *        첫 곳만 지웠다. 돌연변이 시험이 아무것도 시험하지 않은 채 ★통과★ 했다.
 *     ② check-eval-cost.mjs — 소스에서 꺼내 돌리던 함수가 _num 을 쓰기 시작하자
 *        하네스가 ReferenceError 로 죽고 문자열 대조로 조용히 주저앉았다.
 *   둘 다 "게이트가 깨졌다" 고 소리치지 않았다. 그게 이 파일이 막으려는 사고다.
 *
 *   대다수 게이트는 이렇게 소스를 자른다:
 *       const a = S.indexOf("앵커A"), b = S.indexOf("앵커B", a);
 *       const block = S.slice(a, b);              // ← a 가 -1 이면 slice(-1, b)
 *   앵커 문구가 리팩터링으로 사라지면 indexOf 는 -1 을 돌려주고, slice(-1, b) 는
 *   거의 빈 문자열이 된다. 그 빈 문자열에 대고 ★부정 단언★ (!/…/.test(block)) 을 하면
 *   전부 참이다 — 검사는 초록불인데 아무것도 안 지키고 있다.
 *
 *   그래서 여기서는 게이트들이 쓰는 '자르기 앵커' 가 실제 파일에 살아 있는지 본다.
 *   존재 여부 자체를 묻는 형태(indexOf(x) < 0 / === -1 등)는 제외한다 —
 *   그건 "없어야 한다" 를 검사하는 정상적인 쓰임이고, 없다고 사고가 아니다.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TOOLS = fileURLToPath(new URL("./", import.meta.url));
let fails = 0;
const bad = (m) => { fails++; console.error("  FAIL " + m); };

const gates = readdirSync(TOOLS).filter((f) => /^check-.*\.mjs$/.test(f) && f !== "check-gate-anchors.mjs").sort();

/* 게이트가 읽는 저장소 파일을 모은다 — new URL("경로", import.meta.url) 형태. */
function readsOf(gateSrc, gateName) {
  const out = new Map();
  const add = (p) => {
    if (!existsSync(p)) return;
    const st = statSync(p);
    if (st.isFile()) { if (!out.has(p)) out.set(p, readFileSync(p, "utf8")); return; }
    if (st.isDirectory()) {
      for (const f of readdirSync(p)) {
        const q = p.replace(/\/?$/, "/") + f;
        try { if (statSync(q).isFile()) { if (!out.has(q)) out.set(q, readFileSync(q, "utf8")); } } catch (e) {}
      }
    }
  };
  // 따옴표 종류를 가리지 않는다 — 한쪽만 보면 이 메타검사가 먼저 헛돈다(첫 시운전에서 실제로 그랬다).
  for (const m of gateSrc.matchAll(/new URL\(\s*(?:"([^"]+)"|'([^']+)')\s*,\s*import\.meta\.url\s*\)/g)) {
    const rel = m[1] != null ? m[1] : m[2];
    if (/^https?:/.test(rel)) continue;                        // 원격 URL 은 대상이 아니다
    try { add(fileURLToPath(new URL(rel, "file://" + TOOLS + gateName))); } catch (e) {}
  }
  return [...out.values()];
}

const LIT = "(\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*')";
function unquote(raw) {
  try { return JSON.parse(raw[0] === "'" ? '"' + raw.slice(1, -1).replace(/"/g, '\\"') + '"' : raw); }
  catch (e) { return null; }
}
/* 게이트가 직접 정의한 '자르는 도우미' 를 찾는다 — check-eval-cost / check-enrich-budget 처럼
   `const src = slice("앵커A", "앵커B")` 로 감싸 쓰는 게이트가 여럿이라, .indexOf( 만 보면
   ★정작 이번에 썩은 두 게이트를 못 본다★.
   판정은 좁게 한다: 본문에서 ①제 매개변수를 그대로 indexOf 에 넣고 ②slice/substring 을 한다.
   느슨하게 잡으면 check(cond,'통과문구','실패문구') 같은 도우미의 ★메시지★ 를 앵커로 착각한다
   (첫 시운전에서 실제로 86건이 그렇게 잡혔다). 그런 오탐은 이 메타검사를 못 쓰게 만든다. */
function bodyAt(src, from) {
  const i = src.indexOf("{", from);
  if (i < 0) return "";
  let d = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (!d) return src.slice(i, j + 1); }
  }
  return "";
}
function sliceHelpers(src) {
  const found = new Map();
  const defs = [
    ...src.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g),
    ...src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\s*)?\(([^)]*)\)\s*(?:=>)?/g)
  ];
  for (const d of defs) {
    const params = d[2].split(",").map((x) => x.trim()).filter((x) => /^[A-Za-z_$][\w$]*$/.test(x));
    if (!params.length) continue;
    const body = bodyAt(src, d.index + d[0].length);
    if (!body || !/\.(?:slice|substring)\(/.test(body)) continue;
    const idx = params.filter((pn) => new RegExp("\\.indexOf\\(\\s*" + pn + "\\b").test(body));
    if (idx.length) found.set(d[1], params.map((pn) => idx.includes(pn)));
  }
  return found;
}

/* 자르기 앵커만 뽑는다. 존재 여부를 묻는 호출은 건너뛴다. */
function anchorsOf(src) {
  const out = [];
  for (const m of src.matchAll(new RegExp("\\.(?:indexOf|lastIndexOf)\\(\\s*" + LIT, "g"))) {
    const lit = unquote(m[1]);
    if (lit == null || lit.length < 12 || !/\p{L}/u.test(lit)) continue;  // 짧거나 기호뿐이면 우연히 맞을 수 있다(한글 앵커도 앵커다)
    const tail = src.slice(m.index + m[0].length, m.index + m[0].length + 90);
    if (/^\s*(?:,[^)]*)?\)\s*(?:[<>]=?\s*0|[!=]==?\s*-\s*1|>\s*-\s*1)/.test(tail)) continue;  // 존재 여부 검사
    out.push(lit);
  }
  /* 도우미 호출의 인자 중 ★실제로 indexOf 에 들어가는 자리★ 만 앵커로 본다. */
  for (const [h, isAnchorArg] of sliceHelpers(src)) {
    const re = new RegExp("\\b" + h.replace(/[$]/g, "\\$&") + "\\(\\s*" + LIT + "(?:\\s*,\\s*" + LIT + ")?", "g");
    for (const m of src.matchAll(re)) {
      for (let k = 0; k < 2; k++) {
        if (!isAnchorArg[k]) continue;
        const lit = m[k + 1] && unquote(m[k + 1]);
        if (lit == null || lit.length < 12 || !/\p{L}/u.test(lit)) continue;
        out.push(lit);
      }
    }
  }
  return [...new Set(out)];
}

/* ── 이 메타검사 자체의 자가시험 ────────────────────────────────────────────
   추출기가 조용히 못 잡게 되면 이 파일도 다른 게이트와 똑같이 헛돈다.
   그래서 ★가짜 게이트 원문★ 을 하나 만들어 놓고, 잡아야 할 것은 잡고
   잡으면 안 되는 것은 안 잡는지 매 실행마다 확인한다. */
{
  const FAKE = [
    'function cut(a, b) { const i = S.indexOf(a), j = S.indexOf(b, i); return S.slice(i, j); }',
    'function check(c, pass, fail) { if (c) ok(pass); else bad(fail); }',
    'const blk = cut("async function payoutNightly(", "async function nextThing(");',
    'const one = S.indexOf("직접 잘라 쓰는 앵커 문구");',
    'if (S.indexOf("있으면 안 되는 금지 문구") >= 0) bad("금지 문구가 남아 있다");',
    'check(/x/.test(blk), "통과했을 때 찍는 긴 안내 문구", "실패했을 때 찍는 긴 안내 문구");'
  ].join("\n");
  const got = anchorsOf(FAKE);
  const must = ["async function payoutNightly(", "async function nextThing(", "직접 잘라 쓰는 앵커 문구"];
  const never = ["있으면 안 되는 금지 문구", "통과했을 때 찍는 긴 안내 문구", "실패했을 때 찍는 긴 안내 문구"];
  const missed = must.filter((x) => !got.includes(x));
  const wrong = never.filter((x) => got.includes(x));
  if (missed.length) bad("자가시험: 앵커를 놓쳤다 — " + missed.join(" / ") + " · 이 메타검사는 이제 헛돈다");
  if (wrong.length) bad("자가시험: 앵커가 아닌 문구를 앵커로 봤다 — " + wrong.join(" / ") + " · 오탐이 배포를 막는다");
  if (!missed.length && !wrong.length)
    console.log("  ok   자가시험: 도우미 경유·직접 호출 앵커는 잡고, 금지문구 검사와 안내문구는 안 잡는다");
}

let nAnchor = 0, nDead = 0, nGate = 0, skipped = 0;
for (const g of gates) {
  const src = readFileSync(TOOLS + g, "utf8");
  const anchors = anchorsOf(src);
  if (!anchors.length) continue;
  const files = readsOf(src, g);
  if (!files.length) { skipped++; continue; }                   // 저장소 파일을 안 읽는 게이트
  nGate++;
  const dead = anchors.filter((a) => !files.some((f) => f.includes(a)));
  nAnchor += anchors.length;
  if (dead.length) {
    nDead += dead.length;
    bad(`${g} — 앵커가 소스에서 사라졌다: ${dead.map((d) => JSON.stringify(d.slice(0, 60))).join(", ")}`);
    console.error("       → indexOf 가 -1 을 돌려주고 slice(-1, …) 이 빈 문자열이 된다. "
      + "부정 단언이 전부 참이 되어 이 게이트는 초록불인 채 아무것도 안 지킨다.");
  }
}

if (!nAnchor) bad("앵커를 하나도 못 뽑았다 — 이 메타검사 자체가 헛돈다");
if (fails) {
  console.error(nDead
    ? `\n✗ 게이트 앵커 ${nDead}개가 죽었다 — 해당 게이트를 고치기 전엔 배포하지 않는다`
    : `\n✗ 게이트 앵커 검사 ${fails}건 실패`);
  process.exit(1);
}
console.log(`  ok   게이트 ${nGate}개 · 자르기 앵커 ${nAnchor}개 전부 소스에 살아 있다(대상 밖 ${skipped}개)`);
console.log("\n✓ 게이트 앵커 생존 확인 — 검사가 조용히 헛도는 경로가 없다");
