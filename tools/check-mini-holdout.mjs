/* [V33.326] 공용 미니 트레이너(flow·xalpha·stack·이중헤드)의 ★달력 홀드아웃★ 계약.
 *
 *   왜 게이트인가 — 이건 "고쳤다" 로 끝낼 수 없는 종류의 버그였다.
 *   운영 실측(2026-09-09 프로브)에서 이 트레이너를 쓰는 위원이 ★전원★ 같은 자리에 걸려 있었다:
 *     FLOW 홀드아웃 21일=관측 2개(t 5.46) · XALPHA 24일=2개(t 2.94) · STACK 38일=3개
 *     · 이중헤드 강세/약세 25일=2개(t 2.57 / 4.92)  → 전부 tier=pending, mult=0
 *   t 는 충분히 유의한데 기간이 모자라 ★판정 자체가 보류★ 됐다. 원인은 홀드아웃을
 *   '행의 마지막 20%' 로 자른 것이다 — 수확이 한 날짜에 전 종목을 쌓으므로 8,000행이 21일밖에
 *   안 되고, 라벨 지평 10일 기준 겹치지 않는 관측은 2개뿐이었다(필요 5개).
 *
 *   V33.303 이 MEMO 에 대해 똑같은 진단을 하고 달력 고정으로 고쳤는데, 그 수정이 MEMOML
 *   안에만 들어가 같은 병을 앓는 나머지 넷은 그대로 남았다. ★같은 사고가 반쪽만 고쳐진 채
 *   반년을 갔다.★ 그래서 문장이 아니라 산수로 못박는다.
 *
 *   검사하는 것은 '설정이 목적을 달성하는가' 다 — 지평이나 minBlocks 가 바뀌는 날
 *   MINIHOLD.days() 가 따라오지 않으면 여기서 즉시 걸린다.
 */
import { readFileSync } from "node:fs";
import { MINIHOLD, ICGATE, AI_PARAMS, _effBlocks } from "../src/index.js";

let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { fails++; console.error("  FAIL " + m); };

const H = Number(AI_PARAMS.predictionHorizonDays) || 10;
const MINB = Number(ICGATE.minBlocks) || 5;
const DAYS = MINIHOLD.days();
const BUCKETS = Number(MINIHOLD.holdBuckets) || 12;

// ── ① 목표 기간이 필요 관측 수를 채우는가 ────────────────────────────────
{
  const eff = _effBlocks(DAYS, H * 86400000);
  if (eff >= MINB) ok(`목표 홀드아웃 ${DAYS}일 → 겹치지 않는 관측 ${eff}개 ≥ 필요 ${MINB}개 (지평 ${H}일)`);
  else bad(`목표 홀드아웃 ${DAYS}일 → 관측 ${eff}개 < 필요 ${MINB}개 — 이 설정으로는 위원이 영영 '아직 못 쟀다' 다`);
}

// ── ② ★칸 가장자리 손실을 견디는가★ ─────────────────────────────────────
//   칸별 균등추출은 각 칸에서 '최신 _per 행' 만 뽑으므로 가장 오래된 칸에서 최대 한 칸 폭만큼
//   기간이 깎인다. 목표 기간이 아니라 ★깎인 뒤의 기간★ 이 문턱을 넘어야 실제로 통과한다.
//   (실측 시뮬레이션: 60일 목표는 행/일 380~4000 에서 55~58일로 떨어져 관측이 정확히 5개였다.)
//   ★문턱에 '딱 맞는' 것은 통과로 치지 않는다★ — 관측이 정확히 minBlocks 면 하루만 밀려도
//   다시 판정불가다. 실제로 60일 설정이 그랬다(실측 55~58일 → 관측 정확히 5개).
//   그래서 여유 1개(minBlocks+1)를 요구한다. 코드 주석이 "여유를 둔다" 고 적은 것을
//   숫자로 강제하는 자리다 — 주석만 있고 검사가 없으면 다음 사람이 조용히 되돌린다.
{
  const worst = Math.floor(DAYS - (DAYS / BUCKETS));
  const eff = _effBlocks(worst, H * 86400000);
  if (eff >= MINB + 1) ok(`최악(가장 오래된 칸 한 폭 손실) ${worst}일 → 관측 ${eff}개 ≥ ${MINB + 1}개 — 여유 1개 확보`);
  else bad(`칸 손실을 빼면 ${worst}일 → 관측 ${eff}개 (여유 없음, 필요 ${MINB + 1}개) — 문턱에 걸쳐 하루만 밀려도 판정불가로 돌아간다`);
}

// ── ③ 학습이 굶지 않는가 ────────────────────────────────────────────────
{
  const need = DAYS + H + Number(MINIHOLD.minTrainDays || 0);
  if (Number(MINIHOLD.minTrainDays) > 0 && need > DAYS + H) {
    ok(`이력 요구치 ${need}일 = 홀드아웃 ${DAYS} + 엠바고 ${H} + 학습 ${MINIHOLD.minTrainDays} — 짧으면 종전 방식으로 물러선다`);
  } else {
    bad("홀드아웃·엠바고를 뗀 뒤 학습 몫(minTrainDays)이 없다 — 잣대를 고치려다 모델을 굶긴다");
  }
}

// ── ④ 공용 트레이너가 실제로 달력 분할을 하고 있는가(조용한 되돌림 방지) ──
{
  const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("async function _miniLogisticTrain"),
                       src.indexOf("async function flowTrainNightly"));
  const hasCal = /MINIHOLD\.days\(\)/.test(fn) && /ORDER BY ts DESC LIMIT \?"\s*\n?\s*\)\.bind\(opts\.featVer, _a, _z, _per\)|_a, _z, _per/.test(fn);
  const hasTsBoundary = /T\[i\], 0\) >= _holdFrom/.test(fn);
  const hasFallback = /if \(!raw\.length\) \{/.test(fn);
  if (hasCal && hasTsBoundary && hasFallback)
    ok("공용 트레이너가 달력으로 홀드아웃을 떼고, 경계를 시각으로 잡고, 짧은 이력에선 물러선다");
  else
    bad(`공용 트레이너의 달력 분할이 사라졌다(칸추출 ${hasCal} · 시각경계 ${hasTsBoundary} · 폴백 ${hasFallback})`);
}

// ── ⑤ MEMO 와 같은 뜻의 설정이 갈라지지 않았는가 ────────────────────────
//   V33.303 이 MEMO 만 고쳐 두어 나머지가 반년을 방치됐다. 두 설정이 같은 목적을 갖는다는
//   사실을 검사로 남겨, 한쪽만 고치는 일이 다시 일어나면 눈에 띄게 한다.
{
  const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const memoDays = Number((/holdDays:\s*(\d+)/.exec(src) || [])[1] || 0);
  if (memoDays > 0 && _effBlocks(memoDays - memoDays / BUCKETS, H * 86400000) >= MINB)
    ok(`MEMO(holdDays ${memoDays}일)와 공용 트레이너(${DAYS}일) 모두 관측 ${MINB}개 요건을 만족한다`);
  else
    bad(`MEMO holdDays ${memoDays}일은 칸 손실을 빼면 관측 ${MINB}개에 못 미친다 — 한쪽만 고쳐진 상태다`);
}

if (fails) { console.error(`\n✗ 달력 홀드아웃 계약 ${fails}건 실패`); process.exit(1); }
console.log("\n✓ 달력 홀드아웃 계약 통과 — 신규 위원이 기간 부족으로 영구 대기하지 않는다");
