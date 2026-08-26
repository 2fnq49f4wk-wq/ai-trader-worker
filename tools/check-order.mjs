// [V33.84] 선언·사용 순서 계약 게이트
//   배경: V33.83 켈리 블록이 stopDist 선언보다 앞에 놓여 매 진입마다 TDZ ReferenceError 가
//   났고, 자기 try/catch 에 삼켜져 ★기능이 있는데 전혀 안 도는★ 상태였다. node --check 는
//   문법만 보므로 못 잡는다.
//   범용 TDZ 검사는 파서 없이는 오탐(문자열·객체키·프로퍼티)이 151건 나와 쓸 수 없었다.
//   그래서 "이 블록은 반드시 이 선언 뒤에 있어야 한다"는 계약만 정확히 검사한다.
//   블록을 옮기거나 선언을 옮기면 여기서 잡힌다.
import fs from "node:fs";
const src = fs.readFileSync("src/index.js", "utf8");
const ln = (i) => src.slice(0, i).split("\n").length;

// [블록 마커, 반드시 그보다 앞서 있어야 하는 것들]
const CONTRACTS = [
  ["// ══ [V33.83] 거래별 켈리", ["let stopDist =", "let riskPct = _baseRisk", "let __portRho", "let __scalpEdge = null, __ddPctNow"]],
  ["// ══ [V33.82] ★단타 집중투자·레버리지★", ["let maxPosPct", "let __scalpEdge = null, __ddPctNow"]],
  ["// ══ [V33.80] ★고정 확률문턱 → 횡단면 백분위 문턱★", ["let __pDistCache"]],
  ["// [V33.78] FLOW 피처 조립", ["let __flowModel = null"]],
  ["// [V33.79] XALPHA 피처", ["let __xaModel = null"]],
  ["// [V33.83] 보유분 평균 상관", ["let __portRho"]],
];
// riskPct 는 켈리가 고쳐 쓴 뒤에 소비돼야 한다(먼저 소비되면 켈리가 무의미).
const AFTER = [
  ["const riskDollar = equity * (riskPct / 100)", "// ══ [V33.83] 거래별 켈리"],
];

let bad = 0;
for (const [marker, deps] of CONTRACTS) {
  const i = src.indexOf(marker);
  if (i < 0) { console.error(`  FAIL 순서계약: 블록 마커 없음 — ${marker.slice(0, 40)}`); bad++; continue; }
  for (const d of deps) {
    const j = src.indexOf(d);
    if (j < 0) { console.error(`  FAIL 순서계약: 선언 없음 — '${d}'`); bad++; continue; }
    if (j > i) { console.error(`  FAIL 순서계약: '${d}' 선언(@${ln(j)}) 이 블록(@${ln(i)}) 보다 뒤 — TDZ`); bad++; }
  }
}
for (const [consumer, producer] of AFTER) {
  const c = src.indexOf(consumer), p = src.indexOf(producer);
  if (c < 0 || p < 0) { console.error(`  FAIL 순서계약: 소비/생산 지점 없음`); bad++; continue; }
  if (c < p) { console.error(`  FAIL 순서계약: '${consumer.slice(0,40)}'(@${ln(c)}) 이 켈리(@${ln(p)}) 보다 앞 — 켈리 무효`); bad++; }
}
// 읽기만 하고 아무도 안 쓰는 state 키 = 죽은 게이트 (V33.84 에서 stin_trust 가 그랬다)
const reads = new Set([...src.matchAll(/getState\([A-Za-z.]*DB,\s*"([a-z_][a-z0-9_]*)"/g)].map(m => m[1]));
const writes = new Set([...src.matchAll(/setState\([A-Za-z.]*DB,\s*"([a-z_][a-z0-9_]*)"/g)].map(m => m[1]));
// 변수 키로 기록되는 것들은 리터럴 검색에 안 잡힌다 — 실제 기록 경로를 확인하고 화이트리스트에 둔다.
//   flow/xalpha/stack_model: _miniLogisticTrain 이 setState(DB, opts.stateKey, ...) 로 기록
//   dnn_model / gbdt_*: 청크·시장별 동적 키로 기록
const KNOWN_EXTERNAL = new Set(["cfg","deposits","outflows","daily","quote","hist","index",
  "flow_model","xalpha_model","stack_model","dual_bull_model","dual_bear_model","dnn_model","gbdt_",
  "earnings_calendar_v2","econ_calendar"]);
for (const k of reads) {
  if (writes.has(k) || KNOWN_EXTERNAL.has(k)) continue;
  if (/^(daily|quote|hist|index|ai_picks|sector_|xs_|mkt_|xmkt_|equity_peak)/.test(k)) continue;
  console.error(`  WARN 죽은 state 키: "${k}" — 읽기만 하고 기록하는 곳이 없다(게이트가 영원히 닫힐 수 있음)`);
}
// [V33.85] 호출되지 않는 함수 = 죽은 코드. 감사에서 18건(연쇄 1건 포함)이 나왔다.
//   죽은 코드는 그냥 용량이 아니라 ★사람을 속인다★ — "그 기능 있잖아"라고 믿게 만든다.
//   실제로 computeCrashGate(폭락방어 39줄)는 메인 사이클에 재구현돼 있는데도 남아 있었고,
//   taPredictMultiTF(멀티타임프레임 확률결합)는 아무도 안 부르는 채로 방치돼 있었다.
{
  const defs = new Map();
  for (const m of src.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) defs.set(m[1], m.index);
  const deadFns = [];
  for (const [name, pos] of defs) {
    const re = new RegExp("(?<![\\w$.])" + name.replace(/\$/g, "\\$") + "(?![\\w$])", "g");
    if ([...src.matchAll(re)].length - 1 <= 0) deadFns.push({ name, line: ln(pos) });
  }
  if (deadFns.length) {
    for (const d of deadFns) console.error(`  FAIL 죽은코드: 호출되지 않는 함수 '${d.name}' @${d.line}`);
    bad += deadFns.length;
  }
}

// ══ [V33.90] ★스코프에 없는 식별자 검사 (미선언 참조 = 실행시 ReferenceError)★ ══
//   배경: mlDeepDecide 안에서 선언이 없는 `dnn` 을 읽고 있었다(V33.77~V33.89).
//   ESM 에서 미선언 식별자 읽기는 즉시 ReferenceError 이고, 그 함수의 최상위 try/catch 가
//   그걸 삼켜 ★null 반환★ 했다 — 즉 DNN 이 신뢰 상태가 되는 순간마다 위원회 전체가
//   조용히 죽고 규칙엔진으로 폴백했다. node --check 는 문법만 보므로 절대 못 잡는다.
//   V33.84 주석이 "파서 없이는 오탐 151건" 이라고 적었던 그 검사를, 주석·문자열·정규식
//   리터럴을 정확히 걷어내고 선언을 깊이인식으로 수집해 ★오탐 0★ 으로 만들었다.
{
  function strip(s) {
    let o = "", i = 0, n = s.length;
    while (i < n) {
      const c = s[i], c2 = s[i + 1];
      if (c === "/" && c2 === "/") { while (i < n && s[i] !== "\n") { o += " "; i++; } continue; }
      if (c === "/" && c2 === "*") { const e = s.indexOf("*/", i + 2); const t = (e < 0 ? n : e + 2); for (; i < t; i++) o += (s[i] === "\n" ? "\n" : " "); continue; }
      if (c === "/") {
        // 정규식 리터럴 판정 — 직전 유효토큰이 값이 아니면 정규식이다.
        let j = o.length - 1;
        while (j >= 0 && /\s/.test(o[j])) j--;
        const prev = j >= 0 ? o[j] : "";
        const prevWord = /[\w$)\]]/.test(prev);
        let isKw = false;
        if (prevWord) { const w = o.slice(Math.max(0, j - 11), j + 1).match(/([A-Za-z_$][\w$]*)$/); if (w && ["return","typeof","case","in","of","new","delete","void","instanceof","do","else","yield","await"].indexOf(w[1]) >= 0) isKw = true; }
        if (!prevWord || isKw) {
          o += " "; i++;
          let cls = false;
          while (i < n) {
            if (s[i] === "\\") { o += "  "; i += 2; continue; }
            if (s[i] === "[") cls = true; else if (s[i] === "]") cls = false;
            else if (s[i] === "/" && !cls) { o += " "; i++; while (i < n && /[a-z]/.test(s[i])) { o += " "; i++; } break; }
            if (s[i] === "\n") break;
            o += " "; i++;
          }
          continue;
        }
      }
      if (c === '"' || c === "'" || c === "`") {
        const q = c; o += " "; i++;
        while (i < n) { if (s[i] === "\\") { o += "  "; i += 2; continue; } if (s[i] === q) { o += " "; i++; break; } o += (s[i] === "\n" ? "\n" : " "); i++; }
        continue;
      }
      o += c; i++;
    }
    return o;
  }
  const S = strip(src);
  const GLOBALS = new Set(["Math","Date","JSON","Number","String","Array","Object","Boolean","Promise","Map","Set","WeakMap","RegExp","Error","TypeError","isFinite","isNaN","parseFloat","parseInt","console","undefined","NaN","Infinity","Response","Request","Headers","URL","URLSearchParams","TextEncoder","TextDecoder","crypto","fetch","atob","btoa","AbortController","setTimeout","clearTimeout","Symbol","BigInt","globalThis","structuredClone","encodeURIComponent","decodeURIComponent","Intl","arguments","this","AbortSignal","ReadableStream","Uint8Array","Float64Array","Int32Array","performance","caches","DataView","ArrayBuffer","URLPattern","WebSocket","FormData","Blob","EventTarget","queueMicrotask","process"]);
  const KW = new Set("if else for while do switch case default break continue return function async await var let const new typeof instanceof delete void in of try catch finally throw class extends super yield static get set true false null this import export from as".split(" "));
  
  // 선언 수집기(주어진 텍스트 범위에서)
  function collectDecls(text) {
    const d = new Set();
    // const/let/var 선언 — 깊이 0 의 세미콜론까지 스캔해 바인딩 이름만 수집.
    //   (초기화식 안에 함수본문·객체리터럴이 있어 세미콜론/줄바꿈이 섞여도 정확히 끝을 찾는다.)
    for (const m of text.matchAll(/\b(?:const|let|var)\s/g)) {
      let i = m.index + m[0].length, depth = 0, expectName = true;
      while (i < text.length) {
        const c = text[i];
        if (c === "(" || c === "[" || c === "{") {
          if (expectName && depth === 0) {           // 구조분해 바인딩 — 그룹 안 이름을 전부 수집
            let dd = 0, j = i;
            for (; j < text.length; j++) {
              if ("([{".indexOf(text[j]) >= 0) dd++;
              else if (")]}".indexOf(text[j]) >= 0) { dd--; if (dd === 0) break; }
            }
            for (const nm of text.slice(i, j + 1).matchAll(/([A-Za-z_$][\w$]*)/g)) d.add(nm[1]);
            i = j + 1; expectName = false; continue;
          }
          depth++; i++; continue;
        }
        if (c === ")" || c === "]" || c === "}") { depth--; if (depth < 0) break; i++; continue; }
        if (depth === 0) {
          if (c === ";") break;
          if (c === ",") { expectName = true; i++; continue; }
          if (c === "=") { expectName = false; i++; continue; }
          if (expectName && /[A-Za-z_$]/.test(c)) {
            const w = text.slice(i).match(/^([A-Za-z_$][\w$]*)/);
            d.add(w[1]); i += w[1].length; expectName = false; continue;
          }
        }
        i++;
      }
    }
    for (const m of text.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g)) d.add(m[1]);
    for (const m of text.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) d.add(m[1]);
    for (const m of text.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) d.add(m[1]);
    // 함수/화살표 파라미터
    for (const m of text.matchAll(/(?:function\s*\*?\s*[A-Za-z_$\w]*\s*)\(([^)]*)\)/g))
      for (const nm of m[1].matchAll(/([A-Za-z_$][\w$]*)/g)) d.add(nm[1]);
    for (const m of text.matchAll(/\(([^()]*)\)\s*=>/g))
      for (const nm of m[1].matchAll(/([A-Za-z_$][\w$]*)/g)) d.add(nm[1]);
    for (const m of text.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/gm)) d.add(m[1]);
    for (const m of text.matchAll(/\bfor\s*(?:await\s*)?\(\s*(?:const|let|var)?\s*([A-Za-z_$][\w$]*)/g)) d.add(m[1]);
    return d;
  }
  
  // 최상위 선언(들여쓰기 0~1)
  const TOP = new Set();
  src.split("\n").forEach((l) => {
    let m = l.match(/^\s{0,1}(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/); if (m) TOP.add(m[1]);
    m = l.match(/^\s{0,1}(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/); if (m) TOP.add(m[1]);
    m = l.match(/^\s{0,1}(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/); if (m) TOP.add(m[1]);
  });
  
  // 최상위 함수들을 순회
  const findings = [];
  const fnRe = /^(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/gm;
  let fm;
  while ((fm = fnRe.exec(S)) !== null) {
    const start = fm.index;
    let i = S.indexOf("{", fm.index), d = 0, end = -1;
    if (i < 0) continue;
    for (let k = i; k < S.length; k++) { if (S[k] === "{") d++; else if (S[k] === "}") { d--; if (d === 0) { end = k + 1; break; } } }
    if (end < 0) continue;
    const body = S.slice(start, end);
    const decls = collectDecls(body);
    const seen = new Map();
    // 식별자 참조 위치 — 프로퍼티 접근/객체키/선언 제외
    for (const m of body.matchAll(/([.?]\s*)?\b([A-Za-z_$][\w$]*)\b(\s*:)?/g)) {
      if (m[1]) continue;                       // .foo / ?.foo
      if (m[3]) continue;                       // { foo: ... } 객체키·라벨
      const nm = m[2];
      if (KW.has(nm) || GLOBALS.has(nm) || decls.has(nm) || TOP.has(nm)) continue;
      if (!seen.has(nm)) seen.set(nm, start + m.index);
    }
    for (const [nm, pos] of seen) findings.push({ fn: fm[1], name: nm, line: ln(pos) });
  }

  if (findings.length) {
    for (const f of findings) console.error(`  FAIL 미선언 참조: ${f.fn}() 안의 '${f.name}' @${f.line} — 실행 시 ReferenceError`);
    bad += findings.length;
  }

  // ══ [V33.131] ★블록 스코프 이탈 참조 검사★ ══
  //   위의 미선언 검사는 선언을 ★함수 단위로 평평하게★ 모은다. 그래서 안쪽 블록에서
  //   `let x` 를 선언하고 바깥에서 x 를 읽어도 "선언돼 있다"고 통과시킨다 — 실행하면
  //   ReferenceError 다. 실제로 이 구멍으로 `_md` 가 8곳에서 스코프 밖 참조 상태였고,
  //   프로덕션 로그에 "_md is not defined" 가 ★323건★ 찍힐 때까지 14개 게이트 전부가
  //   초록불이었다(2026-08-06~08). node --check 도 위 검사도 못 잡는 구멍이다.
  //
  //   오탐을 0으로 유지하는 보수적 규칙 — 확실한 것만 본다:
  //     · 함수 안에서 ★딱 한 번★ 선언된 단순 바인딩만 대상(섀도잉·구조분해·다중선언 제외)
  //     · 선언 블록 밖 참조 → ReferenceError 로 확정 신고
  //     · 같은 블록 안이지만 선언보다 ★앞선★ 참조 → TDZ. 단 중첩 함수 안(나중에 호출될 수
  //       있어 합법)이면 신고하지 않는다.
  {
    const scopeFind = [];
    const fnRe2 = /^(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/gm;
    let fm2;
    while ((fm2 = fnRe2.exec(S)) !== null) {
      const bOpen = S.indexOf("{", fm2.index);
      if (bOpen < 0) continue;
      let d0 = 0, bEnd = -1;
      for (let k = bOpen; k < S.length; k++) { if (S[k] === "{") d0++; else if (S[k] === "}") { d0--; if (d0 === 0) { bEnd = k; break; } } }
      if (bEnd < 0) continue;
      const body = S.slice(bOpen, bEnd + 1), base = bOpen;

      // 본문 내 brace 깊이 (body[i] 를 ★포함한 뒤★의 깊이)
      const dep = new Int32Array(body.length);
      { let d = 0; for (let i = 0; i < body.length; i++) { const c = body[i]; if (c === "{") d++; else if (c === "}") d--; dep[i] = d; } }

      // 중첩 함수 본문 범위 — TDZ 판정에서 제외하기 위해
      const fnRanges = [];
      for (const m of body.matchAll(/(?:\bfunction\b[^(){;]*\([^()]*\)|=>)\s*\{/g)) {
        const ob = m.index + m[0].length - 1;
        const dd = dep[ob];
        let ce = -1;
        for (let k = ob + 1; k < body.length; k++) if (dep[k] === dd - 1) { ce = k; break; }
        fnRanges.push([ob, ce < 0 ? body.length : ce]);
      }
      const inNestedFn = (p) => fnRanges.some(([a, b]) => p > a && p < b);

      // 단순 단일 바인딩 선언만 ★후보★로 삼는다: `let x =` / `let x;` / `const x =`
      const decls = new Map();   // name -> [pos...]
      for (const m of body.matchAll(/\b(?:let|const|var)\s+([A-Za-z_$][\w$]*)\s*(=[^=>]|;)/g)) {
        if (!decls.has(m[1])) decls.set(m[1], []);
        decls.get(m[1]).push(m.index + m[0].indexOf(m[1]));
      }
      // ★모든★ 선언 형태의 횟수 — 후보 자격 심사용.
      //   짧은 이름(c·k·q·m)은 형제 블록에서 `for (const k of …)` 로 몇 번씩 다시 선언된다.
      //   그런 이름은 어느 선언이 어느 참조에 붙는지 정적으로 못 가리므로 아예 대상에서 뺀다.
      const dcnt = new Map();
      const bump = (n) => dcnt.set(n, (dcnt.get(n) || 0) + 1);
      for (const m of body.matchAll(/\b(?:const|let|var)\s/g)) {
        let i = m.index + m[0].length, dpt = 0, expectName = true;
        while (i < body.length) {
          const c = body[i];
          if (c === "(" || c === "[" || c === "{") {
            if (expectName && dpt === 0) {
              let ddd = 0, j = i;
              for (; j < body.length; j++) { if ("([{".indexOf(body[j]) >= 0) ddd++; else if (")]}".indexOf(body[j]) >= 0) { ddd--; if (ddd === 0) break; } }
              for (const nm of body.slice(i, j + 1).matchAll(/([A-Za-z_$][\w$]*)/g)) bump(nm[1]);
              i = j + 1; expectName = false; continue;
            }
            dpt++; i++; continue;
          }
          if (c === ")" || c === "]" || c === "}") { dpt--; if (dpt < 0) break; i++; continue; }
          if (dpt === 0) {
            if (c === ";") break;
            if (c === ",") { expectName = true; i++; continue; }
            if (c === "=") { expectName = false; i++; continue; }
            if (expectName && /[A-Za-z_$]/.test(c)) { const w = body.slice(i).match(/^([A-Za-z_$][\w$]*)/); bump(w[1]); i += w[1].length; expectName = false; continue; }
          }
          i++;
        }
      }
      for (const m of body.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g)) bump(m[1]);
      for (const m of body.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) bump(m[1]);
      for (const m of body.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) bump(m[1]);
      for (const m of body.matchAll(/(?:function\s*\*?\s*[A-Za-z_$\w]*\s*)\(([^)]*)\)/g)) for (const nm of m[1].matchAll(/([A-Za-z_$][\w$]*)/g)) bump(nm[1]);
      for (const m of body.matchAll(/\(([^()]*)\)\s*=>/g)) for (const nm of m[1].matchAll(/([A-Za-z_$][\w$]*)/g)) bump(nm[1]);
      for (const m of body.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/gm)) bump(m[1]);

      for (const [name, poss] of decls) {
        if (poss.length !== 1) continue;                       // 섀도잉 가능 → 보수적으로 건너뜀
        if ((dcnt.get(name) || 0) !== 1) continue;             // 다른 형태로도 선언됨 → 판단 불가
        if (TOP.has(name) || GLOBALS.has(name) || KW.has(name)) continue;
        const declPos = poss[0];
        const dd = dep[declPos];
        if (dd <= 1) continue;                                  // 함수 본문 최상위 선언 → 전 범위 유효
        // 같은 이름이 다른 곳에서 함수/클래스/catch 로도 선언되면 제외
        if (new RegExp(`\\b(?:function\\s*\\*?\\s*${name}\\b|class\\s+${name}\\b|catch\\s*\\(\\s*${name}\\b)`).test(body)) continue;
        //   ※ 파라미터 여부는 위 dcnt 가 이미 센다. 여기서 `\(…name…\)\s*\{` 같은 느슨한
        //     패턴을 쓰면 `if (_md && _md.allow) {` 이 '파라미터 목록'으로 오인돼 검사가
        //     통째로 무력화된다 — 실제로 그 패턴 때문에 _md 8곳을 놓쳤다(주입시험으로 확인).

        let bs = declPos; while (bs > 0 && dep[bs - 1] >= dd) bs--;
        let be = declPos; while (be < body.length - 1 && dep[be + 1] >= dd) be++;

        for (const r of body.matchAll(new RegExp(`([.?]\\s*)?\\b${name}\\b(\\s*:)?`, "g"))) {
          if (r[1] || r[2]) continue;                           // .x / {x: ...}
          const p = r.index + (r[1] ? r[1].length : 0);
          if (p === declPos) continue;
          if (/\b(?:let|const|var)\s+$/.test(body.slice(Math.max(0, p - 8), p))) continue;
          if (p < bs || p > be) scopeFind.push({ fn: fm2[1], name, line: ln(base + p), why: "블록 밖" });
          else if (p < declPos && !inNestedFn(p)) scopeFind.push({ fn: fm2[1], name, line: ln(base + p), why: "선언 이전(TDZ)" });
        }
      }
    }
    if (scopeFind.length) {
      for (const f of scopeFind) console.error(`  FAIL 스코프 이탈: ${f.fn}() 의 '${f.name}' @${f.line} — ${f.why} 참조, 실행 시 ReferenceError`);
      bad += scopeFind.length;
    }
  }
}


// ══ [V33.94] ★배선 감사 — opts 키 오타로 기능이 조용히 죽는 것 방지★ ══
//   호출부가 넘기는 키를 함수가 안 읽으면 그 기능은 '있는데 안 도는' 상태가 된다.
//   V33.90~93 에서 opts 키를 10개 넘게 추가했다. 오타 하나면 전부 기본값으로 지나간다.
{
  const bodyOf = (sig) => {
    const s = src.indexOf(sig); if (s < 0) return null;
    let i = src.indexOf("{", s), d = 0, e = -1;
    for (let k = i; k < src.length; k++) { if (src[k] === "{") d++; else if (src[k] === "}") { d--; if (d === 0) { e = k + 1; break; } } }
    return src.slice(s, e);
  };
  const TARGETS = [
    ["async function mlDeepDecide(DB, featVec, opts) {", "opts", "mlDeepDecide("],
    ["async function riskPreTradeCheck(DB, o) {", "o", "riskPreTradeCheck("],
    ["async function icForwardCheck(DB, opts) {", "opts", "icForwardCheck("],
    ["async function _miniLogisticTrain(DB, opts) {", "opts", "_miniLogisticTrain("],
    ["async function portfolioStatistics(DB, opts) {", "opts", "portfolioStatistics("],
  ];
  for (const [sig, pname, callPat] of TARGETS) {
    const b = bodyOf(sig);
    if (!b) { console.error(`  FAIL 배선: 함수 시그니처 변경됨 — ${sig.slice(0, 46)}`); bad++; continue; }
    const fname = sig.match(/function (\w+)/)[1];
    const aliases = new Set([pname]);
    for (const m of b.matchAll(new RegExp("(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*" + pname + "\\s*(?:\\|\\||;|,)", "g"))) aliases.add(m[1]);
    const read = new Set();
    for (const a of aliases)
      for (const m of b.matchAll(new RegExp("\\b" + a.replace(/\$/g, "\\$") + "\\.([A-Za-z_$][\\w$]*)", "g"))) read.add(m[1]);
    for (const m of b.matchAll(new RegExp("\\{([^}]*)\\}\\s*=\\s*" + pname, "g")))
      for (const n of m[1].matchAll(/([A-Za-z_$][\w$]*)/g)) read.add(n[1]);
    let idx = -1;
    while ((idx = src.indexOf(callPat, idx + 1)) !== -1) {
      if (/function\s*$/.test(src.slice(Math.max(0, idx - 20), idx))) continue;
      let i = idx + callPat.length, d = 1, args = "";
      for (; i < src.length && d > 0; i++) { const c = src[i]; if (c === "(") d++; else if (c === ")") { d--; if (d === 0) break; } args += c; }
      const oi = args.indexOf("{"); if (oi < 0) continue;
      let dd = 0, seg = "";
      for (let k = oi; k < args.length; k++) { const c = args[k];
        if (c === "{" || c === "[" || c === "(") dd++;
        else if (c === "}" || c === "]" || c === ")") { dd--; if (dd === 0) { seg = args.slice(oi, k + 1); break; } } }
      if (!seg) continue;
      let dep = 0;
      for (let k = 1; k < seg.length; k++) {
        const c = seg[k];
        if (c === "{" || c === "[" || c === "(") dep++;
        else if (c === "}" || c === "]" || c === ")") dep--;
        else if (dep === 0) {
          const mm = seg.slice(k).match(/^([A-Za-z_$][\w$]*)\s*:/);
          if (mm && /[,{]\s*$/.test(seg.slice(0, k)) && !read.has(mm[1])) {
            console.error(`  FAIL 배선: ${fname}(@L${ln(idx)}) 에 '${mm[1]}' 를 넘기는데 함수는 읽지 않는다 — 오타 또는 죽은 인자`);
            bad++;
          }
        }
      }
    }
  }
}

// ══ [V33.94] ★한국 티커 접미사 계약★ (CLAUDE.md 규칙) ══
//   KOSPI = .KS / KOSDAQ = .KQ. 접미사가 틀리면 시세를 영영 못 받아오는데 조용히 실패한다.
//   DEFAULT_KR 의 모든 종목은 NAME_MAP·MCAP_RANK 에도 있어야 한다(운영 지침).
{
  const grabArr = (name) => {
    const s = src.indexOf(name); if (s < 0) return null;
    const o = src.indexOf("[", s); let d = 0, e = -1;
    for (let k = o; k < src.length; k++) { if (src[k] === "[") d++; else if (src[k] === "]") { d--; if (d === 0) { e = k + 1; break; } } }
    /* [V33.262] 블록주석(/* … *\/)을 안 지워서 V33.261 의 설명주석이 들어오자마자 파싱이 깨졌다.
       줄주석만 지우고 있었다. 블록주석을 먼저 지우고, 후행쉼표는 전역으로 지운다. */
    try {
      const raw = src.slice(o, e)
        .replace(/\/\*[\s\S]*?\*\//g, "")   // 블록주석
        .replace(/\/\/[^\n]*/g, "")          // 줄주석
        .replace(/,(\s*])/g, "$1")           // 후행쉼표(전역)
        .replace(/'/g, '"');
      return JSON.parse(raw);
    } catch (e2) { return null; }
  };
  const KR = grabArr("const DEFAULT_KR = [");
  const US = grabArr("const DEFAULT_US = [");
  /* ★읽지 못했으면 통과가 아니라 실패다.★ 종전엔 WARN 한 줄 찍고 접미사 검사를 통째로
     건너뛰었다 — 그러면 유니버스에 주석 한 줄만 넣어도 접미사 검사가 조용히 사라지고,
     화면은 계속 초록이다. 검사가 스스로 꺼지는 길을 열어두면 언젠가 반드시 꺼진 채로 간다.
     (이번에 실제로 그랬다: V33.261 의 블록주석이 들어오자 바로 이 상태가 됐다.) */
  if (!KR) { console.error("  FAIL 티커: DEFAULT_KR 을 파싱하지 못했다 — 접미사 검사를 할 수 없다(건너뛰지 않는다)"); bad++; }
  else {
    const badSfx = KR.filter((s) => !/\.(KS|KQ)$/.test(s));
    if (badSfx.length) { console.error(`  FAIL 티커: KR 접미사 규칙 위반(.KS/.KQ 아님) — ${badSfx.slice(0, 6).join(", ")}`); bad += badSfx.length; }
    if (US) {
      const mixed = US.filter((s) => /\.(KS|KQ)$/.test(s));
      if (mixed.length) { console.error(`  FAIL 티커: DEFAULT_US 안에 KR 접미사 — ${mixed.join(", ")}`); bad += mixed.length; }
      const dup = US.filter((s) => KR.indexOf(s) >= 0);
      if (dup.length) { console.error(`  FAIL 티커: US↔KR 중복 등재 — ${dup.join(", ")}`); bad += dup.length; }
    }
    for (const [nm, label] of [["const NAME_MAP = {", "NAME_MAP"], ["const MCAP_RANK = {", "MCAP_RANK"]]) {
      const s = src.indexOf(nm); if (s < 0) continue;
      const o = src.indexOf("{", s); let d = 0, e = -1;
      for (let k = o; k < src.length; k++) { if (src[k] === "{") d++; else if (src[k] === "}") { d--; if (d === 0) { e = k + 1; break; } } }
      const seg = src.slice(o, e);
      const missing = KR.filter((sym) => seg.indexOf('"' + sym + '"') < 0 && seg.indexOf("'" + sym + "'") < 0);
      if (missing.length) { console.error(`  FAIL 티커: ${label} 누락 ${missing.length}종목 — ${missing.slice(0, 6).join(", ")}`); bad += missing.length; }
    }
  }
}


// ══ [V33.101] ★괄호 균형 · 야간 등록 · state 키 정합★ ══
//   이번 세션에서 반복 확인된 패턴: "만들어 놓고 안 도는 코드".
//   중괄호는 check-syntax 가 보고, 여기서는 나머지 세 가지를 계약으로 못 박는다.
{
  const stripped = (function (s) {
    let o = "", i = 0, n = s.length, prev = "";
    while (i < n) {
      const c = s[i];
      if (c === "/" && s[i + 1] === "/") { const j = s.indexOf("\n", i); const t2 = j < 0 ? n : j; for (; i < t2; i++) o += " "; continue; }
      if (c === "/" && s[i + 1] === "*") { const j = s.indexOf("*/", i + 2); const t2 = j < 0 ? n : j + 2; for (; i < t2; i++) o += (s[i] === "\n" ? "\n" : " "); continue; }
      if (c === '"' || c === "'") { const q = c; o += " "; i++; while (i < n) { if (s[i] === "\\") { o += "  "; i += 2; continue; } if (s[i] === q) { o += " "; i++; break; } o += (s[i] === "\n" ? "\n" : " "); i++; } prev = "x"; continue; }
      if (c === "`") { o += " "; i++; let d = 0; while (i < n) { if (s[i] === "\\") { o += "  "; i += 2; continue; } if (s[i] === "$" && s[i + 1] === "{") { d++; o += "  "; i += 2; continue; } if (s[i] === "}" && d > 0) { d--; o += " "; i++; continue; } if (s[i] === "`" && d === 0) { o += " "; i++; break; } o += (s[i] === "\n" ? "\n" : " "); i++; } prev = "x"; continue; }
      if (c === "/") {
        const isDiv = ")]}".includes(prev) || (prev && /[\w$]/.test(prev));
        if (!isDiv) { o += " "; i++; let cls = false; while (i < n) { if (s[i] === "\\") { o += "  "; i += 2; continue; } if (s[i] === "[") cls = true; else if (s[i] === "]") cls = false; else if (s[i] === "/" && !cls) { o += " "; i++; while (i < n && /[a-z]/.test(s[i])) { o += " "; i++; } break; } else if (s[i] === "\n") break; o += " "; i++; } prev = "x"; continue; }
        o += c; prev = "/"; i++; continue;
      }
      o += c; if (!/\s/.test(c)) prev = c; i++;
    }
    return o;
  })(src);

  for (const [open, close, name] of [["(", ")", "소괄호"], ["[", "]", "대괄호"]]) {
    const st = []; let neg = null;
    for (let i = 0; i < stripped.length; i++) {
      if (stripped[i] === open) st.push(i);
      else if (stripped[i] === close) { if (!st.length) { neg = i; break; } st.pop(); }
    }
    if (neg != null) { console.error(`  FAIL ${name}: 여는 짝 없는 '${close}' @L${ln(neg)}`); bad++; }
    else if (st.length) { console.error(`  FAIL ${name}: 안 닫힌 '${open}' ${st.length}개 — 첫 줄 L${ln(st[0])}`); bad++; }
  }

  // 야간 학습·측정 함수는 반드시 크론 파이프라인에 등록돼야 한다.
  //   FLOW·XALPHA·STACK·DUAL 이 정의만 되고 크론에 없어 영영 학습 안 되던 사고(V33.90)의 재발 방지.
  {
    const defs = [...src.matchAll(/^async function (\w*(?:TrainNightly|FitNightly|PromoteNightly|Nightly))\s*\(/gm)].map((m) => m[1]);
    const reg = new Set();
    for (const m of src.matchAll(/_stg\(\s*"[a-z0-9]+"\s*,\s*async function \(\)\s*\{\s*return await (\w+)\(/g)) reg.add(m[1]);
    const missing = defs.filter((f) => !reg.has(f));
    if (missing.length) { console.error(`  FAIL 야간 미등록: ${missing.join(", ")} — 정의만 있고 크론이 안 돌린다`); bad += missing.length; }
  }

  // ══ [V33.103] ★모듈 스코프 계약★ ══════════════════════════════════════════
  //   실제 사고: 단타(STIN) 서브시스템 970줄이 mlEnsureTable() 안의
  //   `if (!_samplesTableReady) { … }` 블록 속에 통째로 들어가 있었다.
  //   ESM 은 strict 모드라 블록 안 function/let/const 는 블록 스코프다 →
  //   크론이 stinBackfill/stinObserve/mlScalpLoad 를 부를 때마다 ReferenceError,
  //   그게 전부 try/catch 에 삼켜져 "표본 0건" 이 몇 달간 원인 불명이었다.
  //   구문은 완벽히 유효해서 파서 게이트로는 절대 안 잡힌다.
  //   → 이 저장소 규약: 열 0 에서 시작하는 선언은 반드시 모듈 최상위(depth 0)여야 한다.
  //     들여쓴 선언(블록 안 지역 선언)은 종전대로 자유롭다.
  {
    const offend = [];
    let depth = 0, atLineStart = true;
    const lines = stripped.split("\n");
    // stripped 는 문자열·주석이 공백으로 치환돼 있어 중괄호만 정확히 남는다.
    for (let li = 0; li < lines.length; li++) {
      const raw = lines[li];
      if (depth > 0 && /^(async function|function|const|let|var|class)\s+[A-Za-z_$]/.test(raw)) {
        offend.push(`L${li + 1}: ${raw.slice(0, 60).trim()} (depth ${depth})`);
      }
      for (const ch of raw) { if (ch === "{") depth++; else if (ch === "}") depth--; }
    }
    if (offend.length) {
      console.error(`  FAIL 모듈 스코프 위반 ${offend.length}건 — 열 0 선언이 블록 안에 갇혀 있다(호출 시 ReferenceError):\n    ` +
        offend.slice(0, 8).join("\n    "));
      bad += offend.length;
    }
  }

  // setState 로 쓰기만 하고 아무도 안 읽는 키 = 죽은 기록.
  {
    const w = new Set(), r = new Set();
    for (const m of src.matchAll(/setState\([^,]+,\s*"([a-zA-Z0-9_:.]+)"/g)) w.add(m[1]);
    for (const m of src.matchAll(/getState\([^,]+,\s*"([a-zA-Z0-9_:.]+)"/g)) r.add(m[1]);
    for (const m of src.matchAll(/getStates\([^,]+,\s*\[([^\]]*)\]/g))
      for (const k of m[1].matchAll(/"([a-zA-Z0-9_:.]+)"/g)) r.add(k[1]);
    const skip = /^(cash_ckpt|last_|equity_peak|ai_picks|daily|quote|hist|index|twr|cooldown|r2_status)/;
    const dead = [...w].filter((k) => !r.has(k) && !skip.test(k));
    if (dead.length) { console.error(`  FAIL 죽은 state 기록(쓰기만 하고 아무도 안 읽음): ${dead.join(", ")}`); bad += dead.length; }
  }
}

if (bad) { console.error(`\n순서계약 위반 ${bad}건 — 배포 차단`); process.exit(1); }
console.log("  ok   순서계약 · 미선언 참조 · opts 배선 · 티커 접미사 · 괄호 · 야간등록 · state 정합 통과");
