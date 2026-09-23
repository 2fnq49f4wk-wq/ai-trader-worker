// [V33.396] ★보내는 쪽과 쓰는 쪽이 다른 값을 믿고 있지 않은가★ — 건너간 설정이 실제로 쓰이는가
//
//   check-dead-knobs 는 "정의는 있는데 읽는 코드가 없다" 를 잡는다. 그런데 이 저장소가
//   반복해 당한 것은 한 겹 더 안쪽이다: ★읽기는 하는데 그 값이 버려진다.★
//     V33.260  dropout·l2   워커가 보낸 값을 트레이너의 손글씨 사다리가 매번 덮어썼다
//     V33.341  liveSrcWeight 워커 다섯 곳이 쓰는데 트레이너로 내려가지도 않았다
//     V33.396  seeds        `SEEDS_OVERRIDE or cfg.get("seeds",4)` — 상수가 항상 참이라
//                           오른쪽은 ★평가조차 안 됐다.★ 그런데 화면은 그 죽은 값으로
//                           파라미터 수를 그려 ★실제의 2/3★ 을 적고 있었다.
//   셋 다 "값을 바꿔도 아무 일이 없는" 상태였고, 셋 다 사고가 난 뒤에 발견됐다.
//   → 워커가 보내는 키를 전수로 뽑아 트레이너가 읽는지 대조하고, 단락(短絡) 모양을 금지한다.
import fs from "node:fs";
const S = fs.readFileSync("src/index.js", "utf8");
const PY = fs.readFileSync("trainer/modal/modal_train.py", "utf8");
let bad = 0;
const ok = (m) => console.log("  ok   " + m);
const no = (m) => { console.error("  FAIL " + m); bad++; };

// ── 워커가 보내는 최상위 키를 뽑는다 ────────────────────────────────────────────
const i0 = S.indexOf("function _mlExportConfig(arch) {");
const i1 = S.indexOf("\n}", i0);
if (i0 < 0 || i1 < 0) { no("설정배선: _mlExportConfig 를 못 찾겠다"); process.exit(1); }
/* ★주석을 먼저 걷어낸다★ — 이 블록의 주석에 `trainer: \`np.where(...)\`` 같은 인용이 있어
   그대로 키로 잡혔다(첫 실행에서 실제로 걸렸다). 키는 코드에서만 센다. */
const blk = S.slice(i0, i1)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
const keys = [...new Set([...blk.matchAll(/(?:^|[,{(]\s*|\s{10,})([A-Za-z_][\w]*)\s*:/gm)].map((m) => m[1]))];

/* 중첩 객체 안쪽 키 — 트레이너는 바깥 객체를 통째로 받아 다르게 판다. 여기서 따로 안 센다. */
const NESTED = new Set(["target", "horizonDays", "enabled", "L", "d", "heads", "layers", "ffMult"]);
/* ★정보용으로만 보내는 키 — 이유를 적는다.★ 이유 없이 목록에 넣으면 이 목록이 쓰레기통이 된다. */
const INFO_ONLY = new Map([
  ["archMeasured", "워커가 '이 구조는 잰 값이다' 를 알려 주는 표식. 트레이너 동작은 안 바뀐다(스윕 여부는 archSweep 이 정한다)"],
  ["trustTemp", "워커의 소프트맥스 온도 — 승격 판정은 워커가 한다. 트레이너가 쓰면 두 곳에서 같은 판정을 하게 된다"],
  ["trustMargin", "trustTemp 와 같은 이유 — 워커 승격 판정 전용 상수다. 트레이너가 읽어 같은 판정을 또 하면 두 곳이 언젠가 갈라진다"],
]);

const reads = (k) => [`get("${k}"`, `get('${k}'`, `["${k}"]`, `['${k}']`].some((pat) => PY.includes(pat));
{
  const miss = keys.filter((k) => !NESTED.has(k) && !INFO_ONLY.has(k) && !reads(k));
  if (miss.length)
    no("설정배선: 워커가 보내는데 트레이너가 안 읽는 키 — " + miss.join("·") +
       " (쓰거나, 이유를 적어 INFO_ONLY 에 넣어야 한다)");
  else ok(`워커가 보내는 최상위 키 ${keys.length - NESTED.size}종을 트레이너가 전부 읽거나 사유가 적혀 있다`);
  for (const [k, why] of INFO_ONLY) {
    if (!keys.includes(k)) no(`설정배선: INFO_ONLY 의 ${k} 를 워커가 이제 안 보낸다 — 목록이 낡았다`);
    if (!why || why.length < 20) no(`설정배선: ${k} 의 사유가 너무 짧다 — 이유 없이 넣으면 목록이 쓰레기통이 된다`);
    if (reads(k)) no(`설정배선: ${k} 가 '정보용' 목록에 있는데 트레이너가 실제로 읽는다 — 목록을 줄여야 한다`);
  }
  ok(`정보용 ${INFO_ONLY.size}종은 사유가 적혀 있고 실제로도 안 읽힌다(목록이 낡지 않았다)`);
}

// ── ★단락(短絡) 금지★ — `CONST or cfg.get(...)` 는 오른쪽을 평가조차 안 한다 ──────
{
  const short = [...PY.matchAll(/^\s*\w+\s*=\s*([A-Z_][A-Z_0-9]{2,})\s+or\s+cfg\.get\(/gm)].map((m) => m[1]);
  if (short.length)
    no("설정배선: `" + short.join("·") + " or cfg.get(...)` — 상수가 참이면 설정은 ★평가조차 안 된다★(V33.396 의 seeds 가 그것이다)");
  else ok("`상수 or cfg.get(...)` 단락 모양이 없다 — 설정이 조용히 죽는 자리");
  // seeds 는 그 사고의 당사자다. 지금 모양을 못 박는다: 설정이 먼저, 상수는 폴백.
  if (!/K = _k_cfg or SEEDS_OVERRIDE/.test(PY))
    no("설정배선: 시드가 '설정 우선 · 상수 폴백' 이 아니다 — 다시 상수가 이기면 화면과 실제가 또 갈린다");
  else ok("시드는 설정이 먼저, 상수는 폴백");
  if (!/시드 \{K\}개 — 출처/.test(PY))
    no("설정배선: 시드를 어느 쪽에서 가져왔는지 로그가 말하지 않는다");
  else ok("시드 출처를 로그가 말한다(설정인지 상수인지)");
}

// ── 화면이 적는 시드와 ★실제로 도는 시드★ 가 같은가 ────────────────────────────
{
  const M = await import("../src/index.js");
  const so = PY.match(/SEEDS_OVERRIDE = (\d+)/);
  const ws = M.DNN && M.DNN.seeds;
  if (!so) no("설정배선: SEEDS_OVERRIDE 를 못 찾겠다");
  else if (ws !== parseInt(so[1], 10))
    no(`설정배선: 워커 DNN.seeds(${ws}) ≠ 트레이너 폴백 SEEDS_OVERRIDE(${so[1]}) — 화면은 워커 값으로 파라미터를 그린다(실제와 어긋난다)`);
  else ok(`DNN.seeds(${ws}) = SEEDS_OVERRIDE(${so[1]}) — 보내는 값·도는 값·화면 값이 같다`);
  /* [V33.422] DNN 퇴역 — 구조 관측에 DNN 파라미터 칸이 없어졌다(mlDNNVizData 삭제).
     위의 "보내는 값 = 도는 값" 계약은 트레이너가 아직 DNN 을 학습하는 동안 그대로 유효하다. */
}

// ── 승격 문턱을 받아 ★쓰는가★ — 같은 회차 안에서 통과/미달을 말해야 한다 ──────
{
  if (!/\[승격예고\] 하한 /.test(PY))
    no("설정배선: 트레이너가 승격 문턱을 받아 놓고 안 쓴다 — 통과인지 미달인지 워커 로그를 따로 봐야 한다");
  else ok("트레이너가 문턱을 읽어 같은 회차 로그에 통과/미달을 예고한다");
  if (!/최종 판정은 워커가 한다/.test(PY))
    no("설정배선: 예고를 판정처럼 적는다 — 판정 주체가 둘이 되면 언젠가 갈라진다");
  else ok("예고일 뿐 판정은 워커가 한다고 로그가 스스로 말한다");
}

console.log(bad ? `\n설정배선 게이트 실패 ${bad}건` : "\n설정배선 게이트 통과");
process.exit(bad ? 1 : 0);
