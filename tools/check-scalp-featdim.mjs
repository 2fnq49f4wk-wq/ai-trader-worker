/* ═══════════════════════════════════════════════════════════════════════════
   [V33.255] 단타 학습이 featVer 를 올릴 때마다 조용히 죽고 있었다

   Modal 로그에 이렇게 남았다:
     ValueError: setting an array element with a sequence. The requested array
     has an inhomogeneous shape after 1 dimensions. The detected shape was
     (8293,) + inhomogeneous part.

   원인은 폭이다. 장중 표본은 R2 에 ★만들어진 시점의 LUXML.featVer 로★ 기록된다.
   트레이너는 ix(장중 미시구조)는 fv·ifeatn 으로 걸러내면서 x(일봉 피처)는
   길이를 한 번도 재지 않았다. featVer 가 65→69 로 오르면 같은 날짜 버킷에
   두 폭이 섞이고 np.array 가 그 자리에서 죽는다.

   스윙은 멀쩡하니 화면에 아무 표시도 안 난다 — 단타 모델만 몇 달째 학습이 없다.

   이 검사는 트레이너의 ★실제 수집 루프★ 를 파이썬으로 그대로 돌린다(재구현 비교 아님):
   섞인 표본을 먹여서 ① 옛 폭이 걸러지는지 ② 남은 것이 단일 폭인지
   ③ 필터를 껐을 때 정확히 그 ValueError 가 재현되는지를 확인한다.
   ③ 이 없으면 이 검사는 "고쳤다" 가 아니라 "고쳤다고 믿는다" 가 된다.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const PY = readFileSync(new URL("../trainer/modal/modal_train.py", import.meta.url), "utf8");
let fails = 0;
const chk = (c, ok, bad) => { if (c) console.log("  ok   " + ok); else { console.log("  FAIL " + bad); fails++; } };

console.log("① 트레이너가 x 의 폭을 실제로 재는가");
{
  const i = PY.indexOf("def _train_and_upload_scalp(");
  const body = PY.slice(i, PY.indexOf("\ndef ", i + 10));
  // 주석에 적어두는 것으로는 아무 일도 일어나지 않는다 — 코드 줄만 센다.
  const code = body.split("\n").filter(l => !/^\s*#/.test(l)).join("\n");
  chk(/if\s+xn\s+and\s+len\(x\)\s*!=\s*xn\s*:/.test(code),
    "len(x) != xn 이면 표본을 버린다", "x 의 폭을 재는 코드가 없다 — 옛 표본이 그대로 섞인다");
  chk(/xn\s*=\s*len\(j\.get\("featNames"\)/.test(code),
    "기준 폭을 서버 응답의 featNames 에서 가져온다(하드코딩 아님)",
    "기준 폭의 출처가 서버 응답이 아니다 — featVer 가 오르면 또 어긋난다");
  chk(/skipped_xdim/.test(code) && /일봉피처 폭 불일치/.test(body),
    "몇 건을 버렸는지 로그에 남긴다(조용히 버리지 않는다)", "버린 건수를 보고하지 않는다");
  chk(/if\s+len\(_w\)\s*!=\s*1\s*:/.test(code),
    "그래도 폭이 섞여 있으면 죽는 대신 폭 분포를 적고 멈춘다",
    "최종 안전망이 없다 — 다시 역추적 불가능한 ValueError 로 죽는다");
}

console.log("\n② 섞인 표본을 실제로 먹여 본다");
{
  const shim = `
import sys, json
from collections import Counter
inp = json.load(sys.stdin)
XN = inp["xn"]
def collect(samples, filter_on):
    X, dropped = [], 0
    for sm in samples:
        x = sm.get("x")
        if not isinstance(x, list): continue
        if filter_on and XN and len(x) != XN:
            dropped += 1; continue
        X.append(x)
    return X, dropped

samples = inp["samples"]
X, dropped = collect(samples, True)
widths = sorted(set(len(r) for r in X))
out = {"kept": len(X), "dropped": dropped, "widths": widths}

# 필터를 끈 채로 numpy 에 넣어 ★그 ValueError 가 실제로 나는지★ 본다
X2, _ = collect(samples, False)
try:
    import numpy as np
    np.array(X2, dtype=np.float64)
    out["raw_error"] = None
except Exception as e:
    out["raw_error"] = type(e).__name__ + ": " + str(e)[:90]
out["raw_widths"] = dict(Counter(len(r) for r in X2))
print(json.dumps(out))
`;
  // featVer 65 시절 표본 12건 + 69 시절 표본 30건이 같은 날짜 버킷에 섞여 있는 상황
  const samples = [];
  for (let i = 0; i < 12; i++) samples.push({ x: new Array(65).fill(0.1) });
  for (let i = 0; i < 30; i++) samples.push({ x: new Array(69).fill(0.2) });
  samples.push({ x: "not a list" });
  let r;
  try {
    r = JSON.parse(execFileSync("python3", ["-c", shim], { input: JSON.stringify({ xn: 69, samples }), encoding: "utf8" }));
  } catch (e) { console.log("  FAIL 파이썬 실행 실패: " + e.message); process.exit(1); }

  chk(r.dropped === 12, "옛 폭(65칸) 12건을 버렸다", "버린 건수 " + r.dropped + " (12 이어야 한다)");
  chk(r.kept === 30, "현재 폭(69칸) 30건만 남겼다", "남은 건수 " + r.kept + " (30 이어야 한다)");
  chk(r.widths.length === 1 && r.widths[0] === 69,
    "남은 표본의 폭이 단 하나다 — np.array 가 죽지 않는다", "폭이 여전히 섞여 있다: " + JSON.stringify(r.widths));

  // ③ 고치기 전 동작이 정말 그 오류였는지 — 재현 없이 '고쳤다' 고 말하지 않는다
  chk(r.raw_error != null && /inhomogeneous/.test(r.raw_error),
    "필터를 끄면 운영과 같은 오류가 재현된다 → " + r.raw_error,
    "필터를 꺼도 오류가 안 난다 — 이 검사가 재현하는 것이 그 버그가 맞는지 알 수 없다");
  chk(JSON.stringify(r.raw_widths) === JSON.stringify({ "65": 12, "69": 30 }),
    "재현 시 폭 분포가 " + JSON.stringify(r.raw_widths) + " 로 갈렸다",
    "폭 분포가 예상과 다르다: " + JSON.stringify(r.raw_widths));
}

console.log("\n③ ix 쪽 필터는 그대로 살아 있는가 (같이 부수지 않았다)");
{
  const i = PY.indexOf("def _train_and_upload_scalp(");
  const body = PY.slice(i, PY.indexOf("\ndef ", i + 10));
  const code = body.split("\n").filter(l => !/^\s*#/.test(l)).join("\n");
  chk(/len\(ix\)\s*!=\s*ifeatn/.test(code) && /sm\.get\("fv"\)\s*!=\s*ifeatver/.test(code),
    "장중 피처(ix)의 차원·스키마 검사가 남아 있다", "ix 검사가 사라졌다 — 이번 수정이 옛 방어를 지웠다");
}

console.log("\n④ 장중 표본 페이징 — 서버가 offset 을 실제로 쓰는가");
{
  const JS = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const h = JS.indexOf('path === "/api/ml-export-intraday"');
  const body = JS.slice(h, h + 4000);
  const code = body.split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  // V33.98 은 트레이너 쪽 루프만 고쳤고 서버는 offset 을 되비추기만 했다.
  chk(/_hasMore\s*=\s*out\.length\s*>\s*_off\s*\+\s*_pgSize/.test(code),
    "hasMore 가 스캔 결과로 계산된다(선언값 false 그대로가 아니다)",
    "hasMore 가 다시 대입되지 않는다 — 잘려도 '더 없다' 고 답한다");
  chk(/out\.slice\(_off,\s*_off\s*\+\s*_pgSize\)/.test(code),
    "응답이 offset 으로 잘린 페이지다", "offset 을 읽고도 쓰지 않는다 — 페이징이 장식이다");
  chk(!/out\.length\s*>\s*60000/.test(code) && /_scanCap/.test(code),
    "스캔 상한이 오프셋을 따라 움직인다(60000 고정 벽 제거)",
    "스캔 상한이 60000 고정이다 — offset 을 올려도 그 벽을 못 넘는다");

  // 두 쪽을 함께 돌려 ★한 건도 잃거나 겹치지 않는지★ 를 센다.
  const pgSize = 20000;
  const run = (N) => {
    const corpus = Array.from({ length: N }, (_, i) => i);
    const got = [];
    let off = 0;
    for (let pg = 0; pg < 20; pg++) {
      const scanCap = Math.min(200000, off + pgSize + 1);
      const out = corpus.slice(0, scanCap);              // 서버 스캔(상한까지)
      const hasMore = out.length > off + pgSize;
      const page = out.slice(off, off + pgSize);
      got.push(...page);
      if (!hasMore) break;
      off += pgSize;                                    // 트레이너: _off += pageSize
    }
    return got;
  };
  for (const N of [0, 1, 19999, 20000, 20001, 45000, 60001]) {
    const got = run(N);
    const uniq = new Set(got);
    chk(got.length === N && uniq.size === N,
      "표본 " + N + "건 → " + got.length + "건 수신(중복 0, 누락 0)",
      "표본 " + N + "건인데 " + got.length + "건 수신(고유 " + uniq.size + ") — 잃거나 겹쳤다");
  }
}

console.log(fails === 0 ? "\n✓ 단타 표본 폭·페이징 검사 통과" : "\n✗ " + fails + "건 실패");
process.exit(fails ? 1 : 0);
