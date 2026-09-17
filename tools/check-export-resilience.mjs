/* [V33.382] 표본 수집이 ★D1 한 번 삐끗에 50분을 날리지 않는가.★
 *
 *   ★왜★ 실측(run 35187993907, 2026-09-17 06:14):
 *       RuntimeError: export 500: {"error":"D1_ERROR: D1 DB exceeded its CPU time limit
 *                                  and was reset."}  at fetch_all()
 *   재시도는 ★이미 있었다★(5회·5/10/20/40초). 그런데 못 넘었다 — 당연하다.
 *   실패 원인이 "질의 하나가 너무 비싸다" 인데 ★똑같이 비싼 질의★ 를 다시 보냈기 때문이다.
 *   기다림은 일시적 혼잡에는 듣지만 ★질의 자체의 비용★ 에는 안 듣는다.
 *   그 결과 학습 회차가 표본 수집 단계에서 통째로 죽었다.
 *
 *   불변식: ★무거워서 실패했으면 다음 시도는 더 가벼워야 한다.★
 *   이 검사는 문자열을 세지 않는다 — `fetch_all` 의 재시도 루프를 ★떼어 내 실제로 돌려★
 *   가짜 서버가 500 을 주는 동안 페이지가 실제로 줄어드는지 본다.
 */
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "trainer/modal/modal_train.py");
const PY = readFileSync(SRC, "utf8");
let fail = 0, n = 0;
const ok = (c, m) => { n++; if (c) console.log("  ok   " + m); else { fail++; console.error("  ✗ FAIL " + m); } };

/* 재시도 루프를 시작·끝 표지로 떼어 온다(고정 길이로 자르지 않는다 — V33.289·377 의 교훈). */
const A = PY.indexOf("            j = None\n            for attempt in range(");
/* ★안전망 줄까지 포함해서 떼어 온다.★ 첫 판은 그 줄 ★앞에서★ 잘라, "재시도 소진 시
   빈 표본을 지어낸다" 로 바꿔도 못 잡았다(돌연변이 시험에서 실제로 빠져나갔다). */
const _b0 = PY.indexOf('            if j is None:', A);
const B = _b0 < 0 ? -1 : PY.indexOf("\n", PY.indexOf("export 재시도 소진", _b0)) + 1;
ok(A > 0 && B > A, "재시도 루프를 소스에서 떼어 왔다");
if (A < 0 || B < 0) { console.error("\n✗ 루프를 못 찾는다 — 검사가 헛돈다"); process.exit(1); }
const LOOP = PY.slice(A, B).split("\n").map((l) => l.replace(/^            /, "")).join("\n");

const script = `
import json, time
LOOP = ${JSON.stringify(LOOP)}

class _Resp:
    def __init__(self, code, text): self.status_code, self.text = code, text
    def json(self): return {"ok": True}

class _Req(Exception): pass

def run(fail_n, body, page0=20000):
    """가짜 서버가 처음 fail_n 번 500(body)을 주고 그 뒤 200 을 준다.
       돌려주는 것: (성공했나, 매 시도의 limit 목록, 마지막 page)"""
    seen = []
    state = {"i": 0}
    class _S:
        class RequestException(Exception): pass
        @staticmethod
        def get(url, params=None, headers=None, timeout=None):
            seen.append(int(params["limit"]))
            state["i"] += 1
            if state["i"] <= fail_n: return _Resp(500, body)
            return _Resp(200, "{}")
    g = {"requests": _S, "time": type("T", (), {"sleep": staticmethod(lambda s: None)}),
         "params": {"key": "k", "limit": page0}, "page": page0,
         "BASE": "http://x", "HDR": {}, "print": lambda *a, **k: None,
         "RuntimeError": RuntimeError}
    okrun, err = True, None
    try:
        exec(LOOP, g)
    except Exception as e:
        okrun, err = False, str(e)[:120]
    return {"ok": okrun, "limits": seen, "page": g.get("page"), "err": err}

CPU = '{"error":"D1_ERROR: D1 DB exceeded its CPU time limit and was reset."}'
out = {
  "clean":    run(0, CPU),          # 한 번에 성공 — 페이지를 줄이면 안 된다
  "one":      run(1, CPU),          # 한 번 실패 후 성공
  "three":    run(3, CPU),          # 세 번 실패 후 성공
  "always":   run(99, CPU),         # 계속 실패 — 죽어야 한다(조용히 넘어가면 안 된다)
  "other":    run(1, '{"error":"boom"}'),   # CPU 오류가 아닌 5xx 도 살아나야 한다
}
print(json.dumps(out))
`;
const tmp = join(tmpdir(), "expres-" + process.pid + ".py");
let R;
try { writeFileSync(tmp, script); R = JSON.parse(execFileSync("python3", [tmp], { encoding: "utf8", timeout: 120000 }).trim()); }
catch (e) { console.error("  ✗ FAIL 재시도 루프 실행 실패: " + String(e.stdout || e.message).slice(0, 400)); process.exit(1); }
finally { try { unlinkSync(tmp); } catch (e) {} }

console.log("");
for (const k of ["clean", "one", "three", "always", "other"]) {
  const r = R[k];
  console.log(`     ${k.padEnd(7)} 성공:${r.ok ? "O" : "X"}  요청한 limit: ${JSON.stringify(r.limits)}`);
}
console.log("");

ok(R.clean.ok && R.clean.limits.length === 1 && R.clean.limits[0] === 20000,
   "한 번에 성공하면 ★페이지를 안 건드린다★(무해성 — R2 스냅샷 정렬이 깨지지 않는다)");
ok(R.one.ok, "한 번 실패해도 회차가 죽지 않는다");
ok(R.three.ok, "세 번 실패해도 살아난다(옛 코드는 여기서 죽었다)");
ok(R.one.limits.length >= 2 && R.one.limits[1] < R.one.limits[0],
   `★무거워서 실패하면 다음 시도가 더 가볍다★ (${R.one.limits.join(" → ")})`);
ok(R.three.limits[R.three.limits.length - 1] <= R.three.limits[0] / 4,
   `연속 실패하면 계속 줄어든다 (${R.three.limits.join(" → ")})`);
ok(R.three.limits.every((v) => v >= 2000),
   `★바닥이 있다★ — 2,000행 밑으로는 안 내려간다(페이지가 1이 되면 수집이 영원히 안 끝난다)`);
ok(!R.always.ok, "★끝까지 실패하면 죽는다★ — 반쪽 표본으로 조용히 학습하지 않는다(시간 편향이 생긴다)");
ok(R.other.ok, "CPU 오류가 아닌 5xx 도 재시도로 살아난다");

/* 기다림만으로는 못 넘는다는 사실을 코드가 알고 있는가 — 축소 분기가 실제로 배선돼 있는지 */
ok(/page = max\(2000, page \/\/ 2\)/.test(PY), "축소 규칙이 반감(2,000 바닥)이다");
/* ★안전망: 재시도가 소진되면 ★던진다★ — 빈 표본을 지어내지 않는다.
   지금은 위 분기들이 먼저 던지므로 도달하지 않는 줄이지만, 그래서 더 지켜야 한다
   (도달 안 하는 줄은 지워도 티가 안 난다 — 이 저장소가 여러 번 겪은 모양이다). */
ok(/if j is None:\s*\n\s*raise RuntimeError\("export 재시도 소진"\)/.test(PY),
   "재시도가 소진되면 ★던진다★ — 빈 표본을 지어내 조용히 학습하지 않는다");
ok(/params\["limit"\] = page/.test(PY), "줄인 페이지가 ★실제 요청에 반영된다★(변수만 줄이고 안 보내면 무의미하다)");

if (fail) { console.error(`\n✗ 수집 복원력 계약 ${fail}건 실패 (총 ${n})`); process.exit(1); }
console.log(`\n✓ 수집 복원력 계약 통과 (${n}개 단언) — ★무거워서 실패하면 더 가볍게 다시 묻는다★`);
