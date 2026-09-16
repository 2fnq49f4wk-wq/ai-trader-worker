/* [V33.366] 블록 IC 유의성의 ★정직성★ 계약
 *
 *   ★발견★ `_calc_ic_blocks` 의 블록 수 규칙은 `max(K, min(12, n//200))` 로 ★표본 수★ 만 본다.
 *   시간을 안 보므로, 홀드아웃이 짧으면 블록 하나가 라벨 지평보다 짧아진다. 그러면 인접
 *   블록이 같은 라벨 구간을 나눠 갖고, 블록 IC 끼리 상관이 생겨 t 가 부풀려진다.
 *   운영 실측이 바로 그 구간이다 — 홀드아웃 70일 · K=12 → 블록 5.8일(0.58×지평).
 *
 *   ★방향을 분명히 해 둔다★ 이 발견은 게이트를 ★더 엄격하게★ 만드는 쪽이다. 그래서
 *   승격 판정은 건드리지 않았다 — 위원을 빼는 판단은 사람의 몫이다(G-2). 기록만 한다.
 *
 *   ★이 게이트는 그 주장을 매번 다시 측정한다★ — 실력을 정확히 0 으로 둔 모의에서
 *   오통과율이 명목값의 몇 배인지 직접 잰다. 주장이 틀리면 여기서 깨진다.
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PY = readFileSync("trainer/modal/modal_train.py", "utf8");
let fail = 0, n = 0;
const ok = (c, m) => { n++; if (c) console.log("  ok   " + m); else { fail++; console.log("  ✗ FAIL " + m); } };

// ── ① 앵커 ────────────────────────────────────────────────────────────────────
ok(/def _calc_ic_blocks_time\(pred, y, ts, horizon_ms, mkt=None, blk_mult=2\.0\)/.test(PY),
   "시간 기준 블록 계산이 있다");
ok(/hi = lo \+ blk - float\(horizon_ms\)\s*#/.test(PY), "★블록 경계에서 지평만큼 버린다★(겹친 라벨 제거)");
ok(/blk = max\(float\(blk_mult\) \* float\(horizon_ms\), 1\.0\)/.test(PY), "블록 길이가 지평의 배수로 정해진다");
ok(/out\["valICtGap"\]/.test(PY), "게이트가 보는 t 와 정직한 t 의 ★차이★ 를 적는다");
/* [V33.376] 이 진단은 _split_ts 안으로 옮겼다 — 기간을 ★정하는 곳★ 과 ★재는 곳★ 이
   갈리면 두 숫자가 어긋난다. 앵커도 글자가 아니라 뜻으로 옮긴다(V33.370 과 같은 이유). */
ok(/\[홀드아웃\][^\n]*spanDays/.test(PY), "분할이 ★홀드아웃 달력 기간★ 을 말한다(행 수가 아니라)");
ok(/정직한 블록 /.test(PY) && /목표 \{_hi\['target'\]\}개/.test(PY),
   "잰 블록 수와 ★목표★ 를 같이 말한다 — 모자란지를 사람이 세지 않아도 된다");
ok(/구조적으로 불리하다|여기서 멈췄다|행 상한/.test(PY),
   "블록이 모자라면 ★왜 거기서 멈췄는지★ 를 말한다(기간 부족인지 상한인지)");
ok(/K = max\(K, min\(12, n \/\/ 200\)\)/.test(PY),
   "★승격 판정용 계산은 그대로다★ — 이번 판은 기록만 한다(위원을 빼는 건 사람의 결정)");
{ /* 네 학습기 모두 같은 자로 기록해야 비교가 된다.
     ※ 정규식 `[^)]*` 로 세면 `_mkt_of_X(Xva)` 의 닫는 괄호에 걸려 2곳으로 샌다 —
       호출 블록을 통째로 떠서 그 안에 ts= 가 있는지로 센다. */
  const calls = [...PY.matchAll(/_ic_block_fields\(/g)]
    .map(m => ({ head: PY.slice(Math.max(0, m.index - 4), m.index), body: PY.slice(m.index, m.index + 260) }))
    .filter(c => !/def $/.test(c.head));                    // 정의는 호출이 아니다
  const wired = calls.filter(c => /\bts=/.test(c.body.split("\n").slice(0, 3).join("\n"))).length;
  ok(calls.length > 0 && wired === calls.length,
     `★호출부 ${calls.length}곳 전부★ 가 ts 를 넘긴다(지금 ${wired}곳) — 한 곳이라도 빠지면 위원끼리 다른 자로 재게 된다`);
}

// ── ② 실측: 주장이 지금도 사실인가 ────────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), "icb-"));
const py = join(dir, "mc.py");
writeFileSync(py, `
import numpy as np, math, json, sys
src = open("trainer/modal/modal_train.py", encoding="utf-8").read()
ns = {}
for fn in ("_demean_by", "_calc_ic_blocks_time"):
    i = src.index("def %s(" % fn); j = src.index("\\ndef ", i + 10)
    exec(src[i:j], ns)
honest = ns["_calc_ic_blocks_time"]

RNG = np.random.default_rng(97)
HOR_D, SYMS, TRIALS, HD = 10, 220, 260, 70   # ★운영 실측: 홀드아웃 70일★
DAY = 86400000.0
def t_sf(x, df):
    f = lambda u: (1 + u*u/df) ** (-(df+1)/2)
    lo, hi, N = x, x+50.0, 6000; h=(hi-lo)/N
    s_ = 0.5*(f(lo)+f(hi)) + sum(f(lo+i*h) for i in range(1, N))
    lg = math.lgamma((df+1)/2)-math.lgamma(df/2)-0.5*math.log(df*math.pi)
    return math.exp(lg)*s_*h

def sample(persist):
    """★실력 정확히 0★ — 예측은 라벨과 무관한 지속성 요인, 라벨은 10일 겹침.

    ★날짜별 표본 수를 일부러 들쭉날쭉하게 둔다.★ 실제 풀이 그렇다(수확은 몰아서 들어오고
    실거래는 띄엄띄엄이다). 균일하게 두면 '인덱스로 자른 블록' 과 '시간으로 자른 블록' 이
    같아져서, 시간 기준이 정말 시간을 보는지 시험할 수 없다 —
    이 게이트의 첫 판이 그래서 '인덱스로 자르기' 돌연변이를 놓쳤다."""
    shock = RNG.standard_normal((SYMS, HD+HOR_D))
    rho = math.exp(-1.0/persist)
    f = np.zeros((SYMS, HD)); e = RNG.standard_normal((SYMS, HD)); f[:,0]=e[:,0]
    for d in range(1, HD): f[:,d] = rho*f[:,d-1] + math.sqrt(1-rho*rho)*e[:,d]
    dens = RNG.integers(max(4, SYMS//12), SYMS, size=HD)     # 날짜마다 표본 수가 다르다
    y, p, ts = [], [], []
    for d in range(HD):
        k = int(dens[d])
        y.append((shock[:k, d:d+HOR_D].sum(axis=1) > 0).astype(float))
        p.append(f[:k, d]); ts.append(np.full(k, d*DAY))
    return np.concatenate(p), np.concatenate(y), np.concatenate(ts)

def legacy(p, y, K):
    nn = len(p); bs = nn//K; ics=[]
    for k in range(K):
        a, b = p[k*bs:(k+1)*bs], y[k*bs:(k+1)*bs]
        if a.std()<1e-12 or b.std()<1e-12: continue
        c = float(np.corrcoef(a,b)[0,1])
        if np.isfinite(c): ics.append(c)
    if len(ics)<2: return None, 0
    arr=np.asarray(ics); sd=arr.std(ddof=1)
    return (arr.mean()/sd if sd>1e-9 else 0.0)*len(ics)**0.5, len(ics)

# ★결정적 성질★ — 시간으로 자른 블록은 ★행 순서와 무관★ 해야 한다.
#   인덱스로 자르면 순서를 섞는 순간 결과가 달라진다. 오탐이 없는 판별이다.
p0, y0, t0 = sample(20)
perm = RNG.permutation(len(p0))
a = honest(p0, y0, t0, HOR_D*DAY, None)
b = honest(p0[perm], y0[perm], t0[perm], HOR_D*DAY, None)
orderInvariant = bool(a and b and a.get("valICtHonest") is not None
                      and abs(a["valICtHonest"] - b.get("valICtHonest", -999)) < 1e-6
                      and a.get("valICKHonest") == b.get("valICKHonest"))

res = {"_orderInvariant": orderInvariant}
for persist in (5, 60):
    lh = lt = hh = ht = 0; Kl = Kh = 0
    for _ in range(TRIALS):
        p, y, ts = sample(persist)
        t, k = legacy(p, y, 12)                    # 현재 규칙(짧은 홀드아웃을 흉내: 블록<지평)
        if t is not None: lt += 1; lh += (t >= 1.65); Kl = k
        o = honest(p, y, ts, HOR_D*DAY, None)      # ★소스의 실제 함수★
        if o and "valICtHonest" in o:
            ht += 1; hh += (o["valICtHonest"] >= 1.65); Kh = o["valICKHonest"]
    res[persist] = {
        "legacyRate": lh/max(1,lt), "legacyNom": t_sf(1.65, max(1,Kl-1)), "legacyK": Kl,
        "honestRate": hh/max(1,ht), "honestNom": t_sf(1.65, max(1,Kh-1)), "honestK": Kh,
    }
print(json.dumps(res))
`);
let R;
try { R = JSON.parse(execFileSync("python3", [py], { encoding: "utf8", timeout: 600000 }).trim()); }
catch (e) { console.log("  ✗ FAIL 모의 실행 실패: " + String(e.message).slice(0, 200)); process.exit(1); }

ok(R._orderInvariant === true,
   "★블록이 행 순서와 무관하다★ — 시간으로 자른다는 뜻이다(인덱스로 자르면 섞을 때 값이 바뀐다)");
ok(/m = \(tv >= lo\) & \(tv < hi\)/.test(PY), "블록 선택이 ★시각(tv)★ 으로 이뤄진다");
console.log("\n  — 실력을 0 으로 두고 오통과율을 직접 잰 결과 —");
for (const k of Object.keys(R).filter(x => !x.startsWith("_"))) {
  const r = R[k];
  const lx = r.legacyRate / r.legacyNom, hx = r.honestRate / r.honestNom;
  console.log(`     예측 지속성 ${k}일`);
  console.log(`       현재 규칙(블록<지평, K=${r.legacyK}) : ${(r.legacyRate*100).toFixed(1)}% vs 명목 ${(r.legacyNom*100).toFixed(1)}% → ${lx.toFixed(2)}배`);
  console.log(`       ★정직한 블록★ (K=${r.honestK})        : ${(r.honestRate*100).toFixed(1)}% vs 명목 ${(r.honestNom*100).toFixed(1)}% → ${hx.toFixed(2)}배`);
  ok(hx < lx, `지속성 ${k}일 — 정직한 블록이 현재 규칙보다 ★덜 부풀려진다★`);
  ok(hx <= 1.6, `지속성 ${k}일 — 정직한 블록의 오통과율이 명목의 1.6배 이내다(${hx.toFixed(2)})`);
}
{
  const x = R["60"].legacyRate / R["60"].legacyNom;
  ok(x > 1.4, `★현재 규칙은 블록이 지평보다 짧을 때 실제로 부풀려진다★ — 실측 ${x.toFixed(2)}배` +
              " (이 게이트가 그 주장을 매번 재측정한다)");
}
/* ★정직해진 대신 검정력이 떨어진다 — 이것도 말해 둔다.★
   홀드아웃 70일에 2×지평 블록이면 K=3 뿐이고, df=2 에서 t 1.65 의 명목 상측확률은 12% 다.
   즉 ★70일 홀드아웃으로는 잘 보정된 블록 IC 검정을 할 수 없다★ — 부풀린 자를 쓰거나
   검정력이 없거나 둘 중 하나다. 진짜 해법은 ★홀드아웃 기간을 늘리는 것★ 이다(G-2 가
   "늘려야 할 것은 관측 기간이거나 진짜 실력이지 잣대가 아니다" 라고 적은 그 자리다). */
ok(R["60"].honestK <= 4,
   `홀드아웃 70일에서는 정직한 블록이 ${R["60"].honestK}개뿐이다 — ★자를 고쳐도 기간이 짧으면 검정력이 없다★`);

console.log(fail ? `\n✗ IC 유의성 정직성 계약 ${fail}건 실패 (총 ${n})`
                 : `\n✓ IC 유의성 정직성 계약 통과 (${n}개 단언)`);
process.exit(fail ? 1 : 0);
